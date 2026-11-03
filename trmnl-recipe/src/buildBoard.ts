/**
 * Turning one user's settings into the rows their panel shows.
 *
 * This is the recipe's whole data path: fetch the feeds the chosen stops need,
 * decode them, resolve names, drop what cannot be reached in the walk time,
 * and describe what is left. Everything here reuses the dashboard's own
 * modules — the logic is shared, not reimplemented.
 *
 * Two rules carried over from the dashboard and not negotiable:
 *
 * - **Per-card errors.** A failing stop fails its own card; the rest render.
 * - **Empty is not an error.** A card with nothing due says so. The app does
 *   not guess whether that means service ended, the stop is peak-only, or
 *   everything is inside the walk time.
 */

import {
  fetchMultipleTrainLines,
  getUpcomingTrainsAtStation,
} from "../../EInk-NYC-Home-Dashboard/src/utils/subway";
import {
  fetchMultipleRailroads,
  getUpcomingTrainsAtStation as getRailroadTrainsAtStation,
} from "../../EInk-NYC-Home-Dashboard/src/utils/railroad";
import {
  getUpcomingBusesAtStop,
  BusStopError,
} from "../../EInk-NYC-Home-Dashboard/src/utils/bus";
import { fetchBusStopNames } from "./pickers";
import {
  fetchFerryData,
  extractFerryDataByStop,
  getFerryStopName,
} from "../../EInk-NYC-Home-Dashboard/src/utils/ferry";
import {
  trainRows,
  busRows,
  liveFerryRows,
  type DepartureRowData,
  type RowOptions,
} from "../../EInk-NYC-Home-Dashboard/src/utils/departureRows";
import {
  isBoardable,
  formatClockTime,
} from "../../EInk-NYC-Home-Dashboard/src/utils/departures";
import {
  getStationName,
  getSubwayRoutes,
  getDirectionLabels,
  isKnownStop,
} from "../../EInk-NYC-Home-Dashboard/src/utils/stationLookup";
import { mergeSorted, stopTimeOf } from "../../EInk-NYC-Home-Dashboard/src/utils/multiStop";
import {
  subwayRouteIds,
  subwayRouteMatches,
} from "../../EInk-NYC-Home-Dashboard/src/utils/subway/routeLabel";
import { subwayFeedKey } from "../../EInk-NYC-Home-Dashboard/src/utils/subway/feedLookup";
import type { BoardSettings, CardSettings, TransitType } from "./settings";

/**
 * One column of departures within a card.
 *
 * Subway cards have two (by direction); bus cards one per stop ID; railroad
 * and ferry a single list.
 */
export interface BoardColumn {
  /** Column heading, empty when the card needs none. */
  h: string;
  /** Rows, minus the React-only `key`. */
  r: BoardRow[];
}

/** A row as it crosses the wire: positional, to stay inside the payload cap. */
/**
 * A row on the wire: positional, to stay inside the payload cap.
 *
 * `direction` is appended rather than inserted so a row stays readable as
 * `[badge, destination, time, urgent]` — it is absent on most rows, and
 * trailing `undefined` serialises to nothing in JSON.
 *
 * `1` is toward the city and `-1` away from it, as `isCityBound()` decides.
 * `0` or absent means the direction is unknown, which is the honest answer
 * for a train terminating here and for every transit type but the railroads.
 */
export type BoardRow = [
  badge: string,
  destination: string,
  time: string,
  urgent: 0 | 1,
  direction?: 1 | -1 | 0,
];

export interface BoardCard {
  /** Slot number, which fixes the card's place in the grid. */
  s: number;
  /** Transit type. */
  y: string;
  /** Card heading. */
  n: string;
  /**
   * The marks beside the card's heading.
   *
   * Subway cards carry their route bullets; every other type carries a
   * single tag naming the network. One field rather than two, so the
   * templates render the heading with one rule instead of branching per
   * transit type four times over.
   */
  b?: string[];
  /** Columns of departures. Absent when the card failed. */
  k?: BoardColumn[];
  /** Error message, when this card's fetch failed. */
  e?: string;
}

export interface Board {
  /** Generation time, ISO 8601. */
  t: string;
  /**
   * Generation time as the panel shows it: New York local, formatted to the
   * user's clock preference.
   *
   * Separate from `t` because Liquid cannot convert a timezone, and a board
   * that is hours stale should say so in the zone its departures are in.
   *
   * Optional: the handler's last-resort error board has no departures to be
   * stale relative to, and formatting a time there would be noise.
   */
  a?: string;
  /**
   * Destination type size, as a multiplier the layouts apply.
   *
   * Carried on the board rather than read from the form, because a Liquid
   * layout cannot see custom fields — it only gets what this payload
   * holds. Omitted at the default, so the common board costs no bytes for
   * a setting nobody changed.
   */
  ds?: number;
  c: BoardCard[];
  /** Present and true when this is the demo board, not a configured one. */
  d?: true;
}

/** Environment the Worker supplies. */
export interface BuildEnv {
  /** SIRI key for the bus API. The GTFS-RT feeds need none. */
  MTA_API_KEY?: string;
}

/** Row options plus the per-stop fetch limit the feeds that take one need. */
type SharedOptions = Omit<RowOptions, "walkTime"> & { fetchLimit: number };

/**
 * One decoded feed per family, shared across every card in a request.
 *
 * Decoding is the CPU cost that decides which Cloudflare plan this runs on —
 * the `a_division` subway feed alone is ~4ms — so two subway cards must not
 * decode the same 215KB twice. The dashboard avoids this by collecting every
 * stop before fetching (`loadTransitData.ts`); a Worker builds cards
 * concurrently, so the sharing is a promise each card awaits.
 *
 * Keyed by feed family rather than by card: the promise is created on first
 * use and reused, so a board with no railroad card never fetches one.
 */
/**
 * The shapes the two fetchers return, derived rather than redeclared so they
 * cannot drift from the dashboard modules that produce them.
 */
type SubwayFeed = Awaited<ReturnType<typeof fetchMultipleTrainLines>>;
type RailroadFeed = Awaited<ReturnType<typeof fetchMultipleRailroads>>;
type FerryFeed = Awaited<ReturnType<typeof fetchFerryData>>;

interface FeedCache {
  /** Keyed by the sorted line set a card needs, since lines share feeds. */
  subway: Map<string, Promise<SubwayFeed>>;
  /** Keyed by railroad: LIRR and Metro-North are separate endpoints. */
  railroad: Map<string, Promise<RailroadFeed>>;
  /** One feed covers every ferry route, so the key is constant. */
  ferry: Map<string, Promise<FerryFeed>>;
}

const emptyFeedCache = (): FeedCache => ({
  subway: new Map(),
  railroad: new Map(),
  ferry: new Map(),
});

/**
 * Fetch a feed once per request, however many cards need it.
 *
 * Typed per family rather than through one `Map<string, Promise<unknown>>`:
 * that needed an unchecked `as Promise<T>` on the hit path, so two callers
 * using one key with different types would have compiled and failed at
 * runtime. Nothing enforced the key namespacing that kept it safe — it was a
 * convention in two string literals forty lines apart.
 */
function sharedFeed<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>
): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;
  const created = load();
  cache.set(key, created);
  return created;
}

const toMessage = (err: unknown) =>
  err instanceof Error ? err.message : "Failed to load";

/** Strip the React key and compact the row for the wire. */
const toBoardRow = (row: DepartureRowData): BoardRow => {
  const base: BoardRow = [
    row.badge,
    row.destination ?? "",
    row.time,
    row.urgent ? 1 : 0,
  ];

  // Only the railroads know their direction — `trainRows` sets `point` from
  // isCityBound(), which checks the trip's destination against a terminal
  // list. Omitted entirely when unknown, so no row pays for a field it has
  // nothing to put in.
  if (row.point === "left") base.push(1);
  else if (row.point === "right") base.push(-1);

  return base;
};

/**
 * How many rows a card gets.
 *
 * Deliberately generous, and deliberately *not* derived from card height the
 * way the dashboard's `cardCapacity.ts` is. The TRMNL framework's Content
 * Limiter measures the rendered height in the browser and trims what does not
 * fit, so the panel decides — which means the backend does not have to know
 * the layout at all, and a card that gets more room (alone in its column, or
 * on a larger device) fills it without a round trip.
 *
 * Measured: a full-height column fits ~15 rows at 800x480, a split one ~7.
 * Sending 16 covers the largest case with a little slack, and the payload
 * stays well inside TRMNL's 5KB cap.
 */
const ROWS_PER_COLUMN = 16;

/**
 * Rows per column on the demo board.
 *
 * The demo fills all six slots so the preview shows the layout at full
 * density, and six busy cards at the usual 16 rows run past TRMNL's 5KB
 * store — measured at 90.0% of cap, with the trimmer cutting every column to
 * 15. Trimming is correct behaviour but the wrong thing to depend on for the
 * one board every new installer and the public directory listing sees.
 *
 * Six, measured: at 16 the board sits at 90.0% of cap with every column
 * trimmed, at 8 it is still 90%, and at 6 it drops to 71.2%. The three
 * railroad cards are what dominate — each is one full-height list and takes
 * `limit * 2` — so the demo's budget moves faster than the number suggests.
 *
 * Six costs the preview nothing visible. A split card draws about seven rows
 * before the Content Limiter cuts, so the panel was never going to show the
 * rest; this stops sending rows that are discarded twice.
 */
const DEMO_ROWS_PER_COLUMN = 6;

/**
 * How long one card may spend waiting on upstream feeds.
 *
 * Cloudflare puts no timeout on `fetch`, and the MTA is a third party we do
 * not control. Without a deadline a single stalled feed holds the whole
 * request open until the platform kills it, and the panel renders nothing —
 * the one outcome the per-card error handling exists to prevent.
 *
 * Cards run concurrently, so this is a per-card wall clock, not a budget
 * divided among them. Ten seconds is far longer than a healthy feed takes
 * (the measured fetches are well under one) and far shorter than a refresh
 * interval, so a timed-out card reports itself and its neighbours still
 * render.
 */
const CARD_DEADLINE_MS = 10_000;

/**
 * Reject if `work` has not settled within the card deadline.
 *
 * The timer is always cleared, including on the success path: a pending
 * timer would keep the Worker's event loop alive after the response is sent.
 */
function withDeadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${CARD_DEADLINE_MS / 1000}s`)),
      CARD_DEADLINE_MS
    );
  });

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Whether ferry cards may render.
 *
 * On since 2026-10-29, when NYC Ferry's own GTFS-realtime feed replaced the
 * static timetable. It was off while the ferry was schedule-based, because
 * this board reports what live feeds say and a printed schedule can only
 * claim a departure rather than observe one.
 */
const FERRY_ENABLED = true;

/**
 * Which protobuf feeds a set of subway stops needs.
 *
 * The form deliberately does not ask: in `displayConfig.ts` the equivalent
 * `lines` field selects *feeds*, not routes, and choosing wrong yields a
 * silently empty card — the sharpest edge in that format. Here the routes
 * serving each stop come from the station table, so the feed set is derived
 * rather than configured.
 */
/**
 * Whether a train belongs on a card that asked for particular routes.
 *
 * Matched on the label a rider reads, not the feed's route id, so "7" catches
 * the 7X running express and "S" catches GS, FS and H. Asking for the 7 and
 * being shown no express trains would be a surprising kind of correct.
 */
function routeFilterFor(routes: string[] | undefined) {
  if (!routes || routes.length === 0) return undefined;
  return (stop: { routeId?: string }): boolean =>
    subwayRouteMatches(stop.routeId ?? "", routes);
}

/**
 * Whether a row belongs on a card that asked for particular routes.
 *
 * The non-subway version, matched on the badge the row actually shows — a
 * railroad branch ("Babylon"), a bus route ("M42"), a ferry route ("ER").
 * The subway needs its own rule because its badge is a *label* that several
 * feed ids map onto; everywhere else the badge is the name.
 *
 * Matched loosely on purpose. A rider types what they read, and these labels
 * are long enough to invite near-misses: "babylon" for Babylon, "far
 * rockaway" for the Far Rockaway branch. Case is ignored and a prefix
 * counts, so a partial name narrows the card rather than silently emptying
 * it.
 */
/** Apply a card's route filter to built rows, or pass them through. */
/**
 * Keep only the direction a card asked for.
 *
 * Two shapes, because the networks differ. A subway or bus card is two
 * columns and the direction *is* the column, so one is dropped. A
 * railroad card is a single list and direction rides on each row — `r[4]`
 * is 1 city-bound, -1 outbound, 0 unknown — so the rows are filtered and
 * the column stays.
 *
 * A train whose direction is unknown is kept either way. The feed not
 * saying is not the same as the train going the other way, and dropping
 * it would silently hide departures a rider can take.
 */
function keepDirection<T>(items: T[], direction: 1 | 2 | undefined): T[] {
  if (!direction || items.length < 2) return items;
  return [items[direction - 1]!].filter(Boolean);
}

/** Rows of a single-column card, narrowed to one direction. */
function rowsInDirection(
  rows: BoardRow[],
  direction: 1 | 2 | undefined
): BoardRow[] {
  if (!direction) return rows;
  const wanted = direction === 1 ? 1 : -1;
  // Keep 0 — unknown — for the reason above.
  return rows.filter((row) => row[4] === wanted || !row[4]);
}

function filterRows(
  rows: DepartureRowData[],
  routes: string[] | undefined
): DepartureRowData[] {
  const keep = rowFilterFor(routes);
  return keep ? rows.filter(keep) : rows;
}

function rowFilterFor(routes: string[] | undefined) {
  if (!routes || routes.length === 0) return undefined;
  const wanted = routes.map((route) => route.trim().toUpperCase());

  return (row: DepartureRowData): boolean => {
    const badge = row.badge.toUpperCase();
    return wanted.some(
      (route) => badge === route || badge.startsWith(route)
    );
  };
}

/**
 * The routes a card's stops carry, as the station table signs them.
 *
 * These are rider-facing — `S` for every shuttle, `SIR` for the railway — and
 * are what the card's heading bullets show.
 */
function subwayRoutesFor(stopIds: string[]): string[] {
  const routes = new Set<string>();
  for (const stopId of stopIds) {
    for (const route of getSubwayRoutes(stopId)) routes.add(route);
  }
  return [...routes];
}

/**
 * The feed route ids to fetch for those routes.
 *
 * The station table never uses the names the feeds report: every shuttle in
 * it is `S` and the railway is `SIR`. Expanding each label to the ids behind
 * it is what sends a Franklin Av card to the bdfm feed instead of
 * a_division, where its trains do not exist.
 *
 * **Deliberately wider than what runs.** The express rule derives `1X` from
 * `1` because the trailing X is the rule, not a list to maintain, so this
 * yields ids for expresses that do not exist. They map to no feed and are
 * skipped at fetch. They must never reach the panel — these are internal
 * names, and a diamond `1` is a train nobody can board.
 */
function subwayLinesFor(routes: string[]): string[] {
  const ids = new Set<string>();
  for (const route of routes) {
    for (const id of subwayRouteIds(route)) ids.add(id);
  }
  return [...ids];
}

/**
 * The tag a non-subway card shows beside its heading.
 *
 * A subway card is identified by its route bullets, and before this the
 * other types showed nothing at all — a Metro-North card and an LIRR card
 * were distinguishable only by their station names, which assumes the
 * reader knows which railroad serves where.
 *
 */
const TYPE_TAGS: Record<string, string> = {
  "railroad-lirr": "LIRR",
  "railroad-mtn": "Metro North",
  bus: "Bus",
  ferry: "Ferry",
};

/**
 * The bullets a card shows in its heading.
 *
 * A card narrowed to the 1/2/3 should not head itself with all twelve routes
 * at Times Square — the heading would contradict every row beneath it.
 */
function bulletsFor(card: CardSettings, routes: string[]): string[] {
  if (!card.routes || card.routes.length === 0) return routes;
  const wanted = new Set(card.routes.map((route) => route.toUpperCase()));
  const shown = routes.filter((route) => wanted.has(route.toUpperCase()));
  // A route the station table does not list is still what the user asked
  // for, so show it rather than an empty heading.
  return shown.length > 0 ? shown : card.routes;
}


/**
 * Whether a stop ID appears in the lookup for its transit type.
 *
 * Bus always passes. Its stops live in the MTA's remote dataset rather than
 * a bundled table, so an unknown ID can only be found by asking — and the
 * per-card error handling already reports that answer honestly.
 */
export function knownStop(stopId: string, transitType: TransitType): boolean {
  if (transitType === "bus") return true;
  if (transitType === "ferry") return getFerryStopName(stopId) !== undefined;
  return isKnownStop(stopId, transitType);
}

/** Build the two direction columns of a subway card. */
async function subwayCard(
  card: CardSettings,
  rowOptions: SharedOptions,
  feeds: FeedCache
): Promise<BoardCard> {
  // Two different vocabularies, and keeping them apart is load-bearing. The
  // bullets are what a rider reads; the lines are internal feed ids and are
  // deliberately wider, including expresses that do not run.
  const routes = subwayRoutesFor(card.stopIds);
  const lines = subwayLinesFor(routes);

  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n: card.title ?? getStationName(card.stopIds[0], "subway"),
    b: bulletsFor(card, routes),
  };

  try {
    // Keyed by the *feeds* these lines resolve to, not by the lines
    // themselves. Decode is the Worker's dominant CPU cost — a_division alone
    // measured 3.95ms warm against a 10ms budget — and distinct line sets
    // routinely share a feed: 1/2/3, 4/5/6 and 7 are all a_division. Keying on
    // the lines fetched and decoded it once per card instead of once per feed.
    const feed = await sharedFeed(feeds.subway, subwayFeedKey(lines), () =>
      fetchMultipleTrainLines(lines)
    );
    const labels = getDirectionLabels(card.stopIds[0]);

    // South first, matching the dashboard's column order so the two surfaces
    // render the same board side by side.
    const keep = routeFilterFor(card.routes);

    const directions = (["S", "N"] as const).map((direction) => {
      const all = mergeSorted(
        card.stopIds.map((stopId) =>
          getUpcomingTrainsAtStation(feed.feedMessage, stopId, direction)
        ),
        stopTimeOf
      );
      const trains = keep ? all.filter(keep) : all;

      const heading =
        direction === "N"
          ? (labels?.northbound ?? "Northbound")
          : (labels?.southbound ?? "Southbound");

      return {
        // Whether this direction runs at all, which is a different question
        // from whether anything is currently reachable.
        runs: trains.some(isBoardable),
        column: {
          h: heading,
          r: trainRows(trains, { ...rowOptions, walkTime: card.walkTime }).map(
            toBoardRow
          ),
        },
      };
    });

    // At a terminal every train in one direction terminates there, so that
    // direction has nothing boardable and is dropped — letting the live one
    // run full width instead of half the card reading "No upcoming trains".
    //
    // The test is boardability, *not* whether any rows survived: a direction
    // whose trains are all inside the walk time still runs, and dropping it
    // would tell the rider that direction does not exist. That is the
    // "empty is not an error" rule — an empty column is a fact about now,
    // a missing column is a claim about the service.
    const live = directions.filter((d) => d.runs);
    const shown = live.length > 0 ? live : directions;

    // The user's choice applies to the card's own two directions, before
    // the terminal rule above has removed any — picking "direction 2" at
    // a terminal must mean that direction, not whichever single column
    // happened to survive.
    const picked = card.direction ? keepDirection(directions, card.direction) : shown;
    return { ...base, k: picked.map((d) => d.column) };
  } catch (err) {
    return { ...base, e: toMessage(err) };
  }
}

/** Build a railroad card: one list, both railroads sharing a feed fetch. */
async function railroadCard(
  card: CardSettings,
  rowOptions: SharedOptions,
  feeds: FeedCache
): Promise<BoardCard> {
  const railroad = card.transitType === "railroad-lirr" ? "lirr" : "mtn";
  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n: card.title ?? getStationName(card.stopIds[0], card.transitType),
    b: [TYPE_TAGS[card.transitType]],
  };

  try {
    const feed = await sharedFeed(feeds.railroad, railroad, () =>
      fetchMultipleRailroads([railroad])
    );

    const trains = mergeSorted(
      card.stopIds.map((stopId) =>
        getRailroadTrainsAtStation(
          feed.feedMessage,
          stopId,
          undefined, // no route filter
          railroad // LIRR and MTN reuse stop IDs, so this must be set
        )
      ),
      stopTimeOf
    );

    return {
      ...base,
      k: [
        {
          h: "",
          // A railroad card is one list, so direction filters the rows
          // rather than dropping a column — `isCityBound()` has already
          // decided it per trip.
          r: rowsInDirection(
            filterRows(
              trainRows(trains, {
                ...rowOptions,
                walkTime: card.walkTime,
                // One full-height list, not two columns.
                limit: rowOptions.limit * 2,
              }),
              card.routes
            ).map(toBoardRow),
            card.direction
          ),
        },
      ],
    };
  } catch (err) {
    return { ...base, e: toMessage(err) };
  }
}

/**
 * Build a bus card: one column per stop ID, since a stop is one direction.
 *
 * Each stop is fetched and caught **individually**. A corner is always two
 * IDs, and the MTA retires them one at a time, so a shared `Promise.all`
 * rejection would let one dead direction discard the live one's departures —
 * the whole card failing when half of it works. The card only reports an error
 * when every one of its stops failed.
 */
async function busCard(
  card: CardSettings,
  rowOptions: SharedOptions,
  env: BuildEnv
): Promise<BoardCard | undefined> {
  // Bus is the one network whose stop names are not bundled, so the heading
  // is fetched rather than looked up — see `fetchBusStopNames`. Started
  // alongside the departures rather than before them, so it costs no wall
  // time: the SIRI calls are slower and the name lands while they run.
  //
  // Skipped entirely when the user set a title, since nothing would use it.
  const namesPromise = card.title
    ? Promise.resolve(new Map<string, string>())
    : fetchBusStopNames(card.stopIds);

  const results = await Promise.all(
    card.stopIds.map(async (stopId) => {
      try {
        const buses = await getUpcomingBusesAtStop(
          stopId,
          rowOptions.fetchLimit,
          env.MTA_API_KEY
        );
        return {
          column: {
            h: "",
            r: filterRows(
              busRows(buses, { ...rowOptions, walkTime: card.walkTime }),
              card.routes
            ).map(toBoardRow),
          },
        };
      } catch (err) {
        return {
          error: toMessage(err),
          // A stop the MTA has never heard of is the user's to fix, and no
          // amount of retrying changes the answer — so the card is dropped
          // rather than rendered as a permanent error. Distinguished from a
          // transient failure, which must stay visible.
          missing: err instanceof BusStopError && err.noSuchStop,
        };
      }
    })
  );

  const columns = keepDirection(
    results
      .map((result) => result.column)
      .filter((column): column is BoardColumn => column !== undefined),
    card.direction
  );

  // The card is named for its first stop, as every other type is. A corner's
  // two IDs share a `stop_name` — both sides of W 42 St/5 Av are "W 42 ST/5
  // AV" — which is why they belong on one card to begin with.
  const names = await namesPromise;
  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n:
      card.title ??
      names.get(card.stopIds[0]) ??
      getStationName(card.stopIds[0], "bus"),
    b: [TYPE_TAGS[card.transitType]],
  };

  // Every stop failed. If the MTA says none of them exist, the card cannot
  // ever work and is dropped; anything else is transient and must say so.
  if (columns.length === 0) {
    if (results.every((result) => result.missing)) return undefined;

    const firstError = results.find((result) => result.error)?.error;
    return { ...base, e: firstError ?? "Failed to load" };
  }

  return { ...base, k: columns };
}

/**
 * Build a ferry card: one list of sailings from the landing.
 *
 * NYC Ferry's own GTFS-realtime feed, joined against the static package for
 * the route name and headsign the feed itself omits.
 */
async function ferryCard(
  card: CardSettings,
  rowOptions: SharedOptions,
  feeds: FeedCache
): Promise<BoardCard> {
  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n: card.title ?? getFerryStopName(card.stopIds[0]) ?? card.stopIds[0],
    b: [TYPE_TAGS[card.transitType]],
  };

  if (!FERRY_ENABLED) {
    return {
      ...base,
      e: "Ferry is not available yet — it is still schedule-based, and this board shows live data only.",
    };
  }

  try {
    // One feed covers the whole system, so every ferry card on a board
    // shares a single fetch and decode. The key is constant for that reason.
    const feed = await sharedFeed(feeds.ferry, "ferry", fetchFerryData);

    // One list, not two direction columns. The feed names no uptown or
    // downtown — the Rockaway route runs south and east — so splitting it
    // would mean inventing labels the operator does not use. Each row names
    // where its boat is going instead.
    const sailings = mergeSorted(
      card.stopIds.map((stopId) => extractFerryDataByStop(feed, stopId)),
      stopTimeOf
    );

    return {
      ...base,
      k: [
        {
          h: "",
          r: filterRows(
            liveFerryRows(sailings, {
              ...rowOptions,
              walkTime: card.walkTime,
            }),
            card.routes
          ).map(toBoardRow),
        },
      ],
    };
  } catch (err) {
    return { ...base, e: toMessage(err) };
  }
}

/**
 * Build a whole board.
 *
 * Cards are built concurrently and each catches its own failures, so one dead
 * stop costs only its own card. Nothing here rejects.
 */
export async function buildBoard(
  settings: BoardSettings,
  env: BuildEnv
): Promise<Board> {
  const shared: SharedOptions = {
    limit: settings.isDemo ? DEMO_ROWS_PER_COLUMN : ROWS_PER_COLUMN,
    showLeaveIn: settings.showLeaveIn,
    fetchLimit: settings.fetchDepartures,
    settings: {
      use24HourTime: settings.use24HourTime,
      urgentThresholdMinutes: settings.urgentThresholdMinutes,
    },
  };

  // Shared per request, so concurrent cards reuse one decode per feed.
  const feeds = emptyFeedCache();

  // A slot naming no real stop is not a card. Dropping it here rather than
  // in each of the four builders is what keeps the rule in one place, and
  // the slot parser cannot do it: "Bus:6:" is *well-formed* — type `bus`,
  // stop `6` — so it parsed, built, and rendered as a card headed "Bus Stop
  // 6" whose only content was a SIRI error. A station value stored before
  // the picker returned {id, name} decays into exactly that shape.
  //
  // "Empty is not an error" still holds: this drops slots whose ID resolves
  // to nothing, never a card whose feed happens to be quiet.
  const resolvable = settings.cards.filter((card) =>
    card.stopIds.some((stopId) => knownStop(stopId, card.transitType))
  );

  // A builder may return undefined for a card that cannot ever work — see
  // busCard, the one case a stop's non-existence is only discoverable by
  // asking. Those are dropped below rather than rendered as an error.
  const built = await Promise.all(
    resolvable.map(async (card): Promise<BoardCard | undefined> => {
      try {
        switch (card.transitType) {
          case "subway":
            return await withDeadline(
              subwayCard(card, shared, feeds),
              "Subway feed"
            );
          case "railroad-lirr":
          case "railroad-mtn":
            return await withDeadline(
              railroadCard(card, shared, feeds),
              "Railroad feed"
            );
          case "bus":
            return await withDeadline(busCard(card, shared, env), "Bus feed");
          case "ferry":
            return await withDeadline(
              ferryCard(card, shared, feeds),
              "Ferry feed"
            );
        }
      } catch (err) {
        // A card type's own handler should have caught this; reaching here
        // means something unexpected, and it still must not blank the board.
        return {
          s: card.slot,
          y: card.transitType,
          n: card.title ?? card.stopIds[0],
          e: toMessage(err),
        };
      }
    })
  );

  const cards = built.filter((card): card is BoardCard => card !== undefined);

  const generatedAt = new Date();
  const board: Board = {
    t: generatedAt.toISOString(),
    // Pre-formatted in New York time, because Liquid has no timezone
    // support and the panel runs wherever the user is. The Worker already
    // pins this zone for every departure — see `formatClockTime` — so the
    // footer agrees with the rows above it.
    a: formatClockTime(generatedAt, {
      use24HourTime: settings.use24HourTime,
      urgentThresholdMinutes: settings.urgentThresholdMinutes,
    }),
    c: cards.sort((a, b) => a.s - b.s),
  };
  // Only when it differs from the default, so an unchanged setting costs
  // nothing against the 5KB payload cap.
  if (settings.destinationScale !== 1) board.ds = settings.destinationScale;
  // The panel says so, so a new installer knows these are not their stations.
  if (settings.isDemo) board.d = true;
  return board;
}
