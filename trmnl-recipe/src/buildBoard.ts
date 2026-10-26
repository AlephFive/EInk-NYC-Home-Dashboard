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
}

/** Environment the Worker supplies. */
export interface BuildEnv {
  /** SIRI key for the bus API. The GTFS-RT feeds need none. */
  MTA_API_KEY?: string;
}

/** Row options plus the per-stop fetch limit the feeds that take one need. */
type SharedOptions = Omit<RowOptions, "walkTime"> & { fetchLimit: number };

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
 * Deliberately a flat constant for now rather than the dashboard's
 * height-derived `cardCapacity.ts`: the TRMNL design framework measures
 * rendered height at runtime, so the final number is a phase 2 decision (see
 * the spec's §3.2). This value matches what a card sharing a column fits
 * today, so the payload measured in phase 1 stays representative.
 */
const ROWS_PER_COLUMN = 5;

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
  rowOptions: SharedOptions
): Promise<BoardCard> {
  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n: card.title ?? getStationName(card.stopIds[0], "subway"),
    b: subwayLinesFor(card.stopIds),
  };

  try {
    const feed = await fetchMultipleTrainLines(subwayLinesFor(card.stopIds));
    const labels = getDirectionLabels(card.stopIds[0]);

    const columns: BoardColumn[] = (["N", "S"] as const).map((direction) => {
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
        h: heading,
        r: trainRows(trains, { ...rowOptions, walkTime: card.walkTime }).map(
          toBoardRow
        ),
      };
    });

    // At a terminal one direction has nothing boardable; drop it so the live
    // one can run full width rather than half the card reading "No trains".
    const live = columns.filter((column) => column.r.length > 0);
    return { ...base, k: live.length > 0 ? live : columns };
  } catch (err) {
    return { ...base, e: toMessage(err) };
  }
}

/** Build a railroad card: one list, both railroads sharing a feed fetch. */
async function railroadCard(
  card: CardSettings,
  rowOptions: SharedOptions
): Promise<BoardCard> {
  const railroad = card.transitType === "railroad-lirr" ? "lirr" : "mtn";
  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n: card.title ?? getStationName(card.stopIds[0], card.transitType),
  };

  try {
    const feed = await fetchMultipleRailroads([railroad]);
    const failure = feed.failures?.[railroad];
    if (failure) return { ...base, e: failure };

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

/** Build a bus card: one column per stop ID, since a stop is one direction. */
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

  const columns = await Promise.all(
    card.stopIds.map(async (stopId) => {
      const buses = await getUpcomingBusesAtStop(
        stopId,
        rowOptions.fetchLimit,
        env.MTA_API_KEY
      );
      return {
        h: "",
        r: busRows(buses, { ...rowOptions, walkTime: card.walkTime }).map(
          toBoardRow
        ),
      };
    })
  ).catch((err: unknown) => toMessage(err));

  return typeof columns === "string"
    ? { ...base, e: columns }
    : { ...base, k: columns };
}

/** Build a ferry card: uptown and downtown columns. */
function ferryCard(
  card: CardSettings,
  rowOptions: SharedOptions
): BoardCard {
  const base: BoardCard = {
    s: card.slot,
    y: card.transitType,
    n: card.title ?? card.stopIds[0],
  };

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

  const cards = await Promise.all(
    settings.cards.map(async (card): Promise<BoardCard> => {
      try {
        switch (card.transitType) {
          case "subway":
            return await subwayCard(card, shared);
          case "railroad-lirr":
          case "railroad-mtn":
            return await railroadCard(card, shared);
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

  return { t: new Date().toISOString(), c: cards.sort((a, b) => a.s - b.s) };
}
