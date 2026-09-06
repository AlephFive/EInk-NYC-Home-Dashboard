import {
  fetchMultipleTrainLines,
  getUpcomingTrainsAtStation,
} from "./subway";
import {
  fetchMultipleRailroads,
  getUpcomingTrainsAtStation as getRailroadTrainsAtStation,
} from "./railroad";
import { getUpcomingBusesAtStop } from "./bus";
import { getUpcomingFerryDepartures } from "./ferry";
import displayConfig from "../displayConfig";
import type { TransitData, TransitErrors } from "../types/transitData";

/**
 * Fetching every stop the board displays, independent of React.
 *
 * The guiding rule is that **no single failure may blank the board**. Feeds
 * fail routinely — a stop ID is retired, one railroad's endpoint is down — and
 * an unattended panel showing nothing is worse than one showing four cards and
 * an error. So each transit type catches its own failures and records them per
 * stop, and the caller renders whatever arrived.
 */

/** Everything one pass fetched, plus whatever failed while fetching it. */
export interface TransitLoadResult {
  data: TransitData;
  errors: TransitErrors;
  /** Feed timestamp for the "last updated" line; absent if no subway ran. */
  lastUpdate?: string;
}

/** The stops one board needs, grouped by which feed answers for them. */
interface StopsToFetch {
  subway: Set<string>;
  subwayLines: Set<string>;
  lirr: Set<string>;
  mtn: Set<string>;
  bus: Set<string>;
  ferry: Set<string>;
}

const railroadsToFetch = ["lirr", "mtn"];

const toMessage = (err: unknown) =>
  err instanceof Error ? err.message : "Failed to load";

function emptyBuckets<T>(make: () => T) {
  return {
    subway: make(),
    "railroad-lirr": make(),
    "railroad-mtn": make(),
    bus: make(),
    ferry: make(),
  };
}

/**
 * Walk the configured cards and collect the stops to fetch.
 *
 * A card may name several stop IDs, and several cards may name the same stop,
 * so these are sets: each stop is fetched once however many cards show it.
 */
function collectStops(): StopsToFetch {
  const stops: StopsToFetch = {
    subway: new Set(),
    subwayLines: new Set(),
    lirr: new Set(),
    mtn: new Set(),
    bus: new Set(),
    ferry: new Set(),
  };

  for (const column of displayConfig.columnDisplay) {
    for (const card of column) {
      for (const stopId of card.stopIds) {
        if (card.transitType === "subway") stops.subway.add(stopId);
        else if (card.transitType === "railroad-lirr") stops.lirr.add(stopId);
        else if (card.transitType === "railroad-mtn") stops.mtn.add(stopId);
        else if (card.transitType === "bus") stops.bus.add(stopId);
        else if (card.transitType === "ferry") stops.ferry.add(stopId);
      }

      // `lines` selects which protobuf feed to download, not which routes to
      // show — the MTA splits the subway across several endpoints.
      if (card.transitType === "subway") {
        card.lines?.forEach((line) => stops.subwayLines.add(line));
      }
    }
  }

  return stops;
}

/**
 * Subway: every card shares one feed fetch, so there is no per-stop request to
 * isolate. A feed failure is therefore attributed to every subway card.
 */
async function loadSubway(
  stops: StopsToFetch,
  result: TransitLoadResult
): Promise<void> {
  if (stops.subway.size === 0) return;

  try {
    const feed = await fetchMultipleTrainLines(Array.from(stops.subwayLines));

    for (const stopId of stops.subway) {
      result.data.subway![stopId] = {
        southbound: getUpcomingTrainsAtStation(feed.feedMessage, stopId, "S"),
        northbound: getUpcomingTrainsAtStation(feed.feedMessage, stopId, "N"),
      };
    }

    result.lastUpdate = feed.metadata.timestamp;
  } catch (err) {
    console.error("Error fetching subway data:", err);
    for (const stopId of stops.subway) {
      result.data.subway![stopId] = { southbound: [], northbound: [] };
      result.errors.subway![stopId] = toMessage(err);
    }
  }
}

/**
 * Railroad: `fetchMultipleRailroads` settles per railroad and reports which
 * failed, so a Metro-North outage leaves LIRR cards working.
 */
async function loadRailroads(
  stops: StopsToFetch,
  result: TransitLoadResult
): Promise<void> {
  if (stops.lirr.size === 0 && stops.mtn.size === 0) return;

  const railroads = [
    { key: "railroad-lirr" as const, railroad: "lirr", stops: stops.lirr },
    { key: "railroad-mtn" as const, railroad: "mtn", stops: stops.mtn },
  ];

  try {
    const feed = await fetchMultipleRailroads(railroadsToFetch);

    for (const { key, railroad, stops: railroadStops } of railroads) {
      const failure = feed.failures?.[railroad];

      for (const stopId of railroadStops) {
        if (failure) {
          result.data[key]![stopId] = [];
          result.errors[key]![stopId] = failure;
          continue;
        }

        result.data[key]![stopId] = getRailroadTrainsAtStation(
          feed.feedMessage,
          stopId,
          undefined, // routeId — no route filter
          railroad // LIRR and MTN reuse stop IDs, so this must be set
        );
      }
    }
  } catch (err) {
    console.error("Error fetching railroad data:", err);
    for (const { key, stops: railroadStops } of railroads) {
      for (const stopId of railroadStops) {
        result.data[key]![stopId] = [];
        result.errors[key]![stopId] = toMessage(err);
      }
    }
  }
}

/** Bus: one request per stop, so a retired stop ID only breaks its own card. */
async function loadBuses(
  stops: StopsToFetch,
  result: TransitLoadResult,
  fetchLimit: number
): Promise<void> {
  await Promise.all(
    Array.from(stops.bus).map(async (stopId) => {
      try {
        result.data.bus![stopId] = await getUpcomingBusesAtStop(
          stopId,
          fetchLimit
        );
      } catch (err) {
        console.error(`Error fetching bus stop ${stopId}:`, err);
        result.data.bus![stopId] = [];
        result.errors.bus![stopId] = toMessage(err);
      }
    })
  );
}

/**
 * Ferry: schedule-based today, so nothing here can fail. The per-stop error
 * handling matches the other types anyway, so moving to a live feed needs no
 * change to this shape.
 */
async function loadFerries(
  stops: StopsToFetch,
  result: TransitLoadResult,
  fetchLimit: number
): Promise<void> {
  await Promise.all(
    Array.from(stops.ferry).map(async (stopName) => {
      try {
        result.data.ferry![stopName] = {
          uptown: getUpcomingFerryDepartures(
            "ER",
            stopName,
            "uptown",
            undefined,
            fetchLimit
          ),
          downTown: getUpcomingFerryDepartures(
            "ER",
            stopName,
            "downTown",
            undefined,
            fetchLimit
          ),
        };
      } catch (err) {
        console.error(`Error fetching ferry stop ${stopName}:`, err);
        result.data.ferry![stopName] = { uptown: [], downTown: [] };
        result.errors.ferry![stopName] = toMessage(err);
      }
    })
  );
}

/**
 * Fetch every stop the configured board displays.
 *
 * Never rejects for a per-type failure: those are recorded in `errors` against
 * the stops they affect, and `data` still carries whatever loaded. Only an
 * unexpected fault escapes, and even then the caller keeps the partial result.
 */
export async function loadTransitData(): Promise<TransitLoadResult> {
  const stops = collectStops();
  const result: TransitLoadResult = {
    data: emptyBuckets(() => ({})),
    errors: emptyBuckets(() => ({})),
  };

  // Fetch more than is displayed: departures inside the walk time are dropped
  // afterwards, so an exact-size fetch leaves cards short.
  const fetchLimit = displayConfig.fetchDepartures ?? 8;

  await loadSubway(stops, result);
  await loadRailroads(stops, result);
  await loadBuses(stops, result, fetchLimit);
  await loadFerries(stops, result, fetchLimit);

  return result;
}
