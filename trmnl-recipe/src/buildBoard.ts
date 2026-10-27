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
import { getUpcomingBusesAtStop } from "../../EInk-NYC-Home-Dashboard/src/utils/bus";
import { getUpcomingFerryDepartures } from "../../EInk-NYC-Home-Dashboard/src/utils/ferry";
import {
  trainRows,
  busRows,
  ferryRows,
  type DepartureRowData,
  type RowOptions,
} from "../../EInk-NYC-Home-Dashboard/src/utils/departureRows";
import { isBoardable } from "../../EInk-NYC-Home-Dashboard/src/utils/departures";
import {
  getStationName,
  getSubwayRoutes,
  getDirectionLabels,
} from "../../EInk-NYC-Home-Dashboard/src/utils/stationLookup";
import { mergeSorted, stopTimeOf } from "../../EInk-NYC-Home-Dashboard/src/utils/multiStop";
import type { BoardSettings, CardSettings } from "./settings";

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
export type BoardRow = [badge: string, destination: string, time: string, urgent: 0 | 1];

export interface BoardCard {
  /** Slot number, which fixes the card's place in the grid. */
  s: number;
  /** Transit type. */
  y: string;
  /** Card heading. */
  n: string;
  /** Subway route bullets; absent for other types. */
  b?: string[];
  /** Columns of departures. Absent when the card failed. */
  k?: BoardColumn[];
  /** Error message, when this card's fetch failed. */
  e?: string;
}

export interface Board {
  /** Generation time, ISO 8601. */
  t: string;
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
type FeedCache = Map<string, Promise<unknown>>;

function sharedFeed<T>(
  cache: FeedCache,
  key: string,
  load: () => Promise<T>
): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing as Promise<T>;
  const created = load();
  cache.set(key, created);
  return created;
}

const toMessage = (err: unknown) =>
  err instanceof Error ? err.message : "Failed to load";

/** Strip the React key and compact the row for the wire. */
const toBoardRow = (row: DepartureRowData): BoardRow => [
  row.badge,
  row.destination ?? "",
  row.time,
  row.urgent ? 1 : 0,
];

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
 * Whether ferry cards may render.
 *
 * Off: the ferry is schedule-based, and this board reports what live feeds
 * say. Flip it when `getFerrySchedule.ts` is replaced by a real feed — see
 * the spec's open questions.
 */
const FERRY_ENABLED = false;

/**
 * Which protobuf feeds a set of subway stops needs.
 *
 * The form deliberately does not ask: in `displayConfig.ts` the equivalent
 * `lines` field selects *feeds*, not routes, and choosing wrong yields a
 * silently empty card — the sharpest edge in that format. Here the routes
 * serving each stop come from the station table, so the feed set is derived
 * rather than configured.
 */
function subwayLinesFor(stopIds: string[]): string[] {
  const routes = new Set<string>();
  for (const stopId of stopIds) {
    for (const route of getSubwayRoutes(stopId)) routes.add(route);
  }
  return [...routes];
}

/** Build the two direction columns of a subway card. */
async function subwayCard(
  card: CardSettings,
  rowOptions: SharedOptions,
  feeds: FeedCache
): Promise<BoardCard> {
  // Walks every stop's route list, so computed once and reused for both the
  // card's bullets and its feed set.
  const lines = subwayLinesFor(card.stopIds);

  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n: card.title ?? getStationName(card.stopIds[0], "subway"),
    b: lines,
  };

  try {
    // Keyed by the feed set this card needs, so two cards on the same lines
    // share one fetch and one decode while cards on different lines do not.
    const feed = await sharedFeed(feeds, `subway:${[...lines].sort().join(",")}`, () =>
      fetchMultipleTrainLines(lines)
    );
    const labels = getDirectionLabels(card.stopIds[0]);

    // South first, matching the dashboard's column order so the two surfaces
    // render the same board side by side.
    const directions = (["S", "N"] as const).map((direction) => {
      const trains = mergeSorted(
        card.stopIds.map((stopId) =>
          getUpcomingTrainsAtStation(feed.feedMessage, stopId, direction)
        ),
        stopTimeOf
      );

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
    return { ...base, k: shown.map((d) => d.column) };
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
  };

  try {
    const feed = await sharedFeed(feeds, `railroad:${railroad}`, () =>
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
          r: trainRows(trains, {
            ...rowOptions,
            walkTime: card.walkTime,
            // A railroad card is one full-height list, not two columns.
            limit: rowOptions.limit * 2,
          }).map(toBoardRow),
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
): Promise<BoardCard> {
  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n: card.title ?? getStationName(card.stopIds[0], "bus"),
  };

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
            r: busRows(buses, { ...rowOptions, walkTime: card.walkTime }).map(
              toBoardRow
            ),
          },
        };
      } catch (err) {
        return { error: toMessage(err) };
      }
    })
  );

  const columns = results
    .map((result) => result.column)
    .filter((column): column is BoardColumn => column !== undefined);

  // Every stop failed: there is nothing to show, so the card reports why.
  if (columns.length === 0) {
    const firstError = results.find((result) => result.error)?.error;
    return { ...base, e: firstError ?? "Failed to load" };
  }

  return { ...base, k: columns };
}

/**
 * Build a ferry card: uptown and downtown columns.
 *
 * **Not reachable from the form, deliberately.** The ferry is still
 * schedule-based (`getFerrySchedule.ts`), which conflicts with the project's
 * live-data-only rule, so the form offers no Ferry option and the picker
 * returns nothing for it. The path is kept because the schedule lookup works
 * and `loadFerries` in the dashboard already has the per-stop shape a live
 * feed would need — but a hand-written ferry slot says so rather than
 * rendering a silently empty card that looks like "no boats due".
 */
function ferryCard(
  card: CardSettings,
  rowOptions: SharedOptions
): BoardCard {
  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n: card.title ?? card.stopIds[0],
  };

  if (!FERRY_ENABLED) {
    return {
      ...base,
      e: "Ferry is not available yet — it is still schedule-based, and this board shows live data only.",
    };
  }

  try {
    const columns: BoardColumn[] = (["uptown", "downTown"] as const).map(
      (direction) => ({
        h: direction === "uptown" ? "Uptown" : "Downtown",
        r: ferryRows(
          getUpcomingFerryDepartures(
            "ER",
            card.stopIds[0],
            direction,
            undefined,
            rowOptions.fetchLimit
          ),
          { ...rowOptions, walkTime: card.walkTime }
        ).map(toBoardRow),
      })
    );
    return { ...base, k: columns };
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
    limit: ROWS_PER_COLUMN,
    showLeaveIn: settings.showLeaveIn,
    fetchLimit: settings.fetchDepartures,
    settings: {
      use24HourTime: settings.use24HourTime,
      urgentThresholdMinutes: settings.urgentThresholdMinutes,
    },
  };

  // Shared per request, so concurrent cards reuse one decode per feed.
  const feeds: FeedCache = new Map();

  const cards = await Promise.all(
    settings.cards.map(async (card): Promise<BoardCard> => {
      try {
        switch (card.transitType) {
          case "subway":
            return await subwayCard(card, shared, feeds);
          case "railroad-lirr":
          case "railroad-mtn":
            return await railroadCard(card, shared, feeds);
          case "bus":
            return await busCard(card, shared, env);
          case "ferry":
            return ferryCard(card, shared);
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

  const board: Board = {
    t: new Date().toISOString(),
    c: cards.sort((a, b) => a.s - b.s),
  };
  // The panel says so, so a new installer knows these are not their stations.
  if (settings.isDemo) board.d = true;
  return board;
}
