/**
 * NYC Ferry departures, from the operator's live GTFS-realtime feed.
 *
 * This replaces the static timetable the ferry card used to read. The project
 * reports what the feeds actually say, and a printed schedule cannot know a
 * boat is late — so the schedule could only ever claim a departure, never
 * observe one.
 *
 * **The feed leaves `routeId` empty.** Every ferry trip arrives identified
 * only by `tripId`, with stops as bare numeric ids. Which route a boat is,
 * where it is heading, and what a landing is called all come from the static
 * GTFS package instead, pruned at build time into `trips.json` and
 * `stops.json` — see `scripts/buildFerryLookups.mjs`. Verified against the
 * live feed on 2026-10-29: 28 trips, zero unresolved ids on either side.
 *
 * Two further differences from the subway feeds, both already familiar:
 *
 * - **It is served over HTTP, not HTTPS.** Connexionz publishes no TLS
 *   endpoint. Nothing secret crosses it — public sailing times — but it is
 *   worth knowing, and it is why the URL below looks wrong at a glance.
 * - **A terminating boat carries `arrival` and no `departure`**, the LIRR
 *   pattern rather than the subway's.
 *
 * **Each trip reports one leg, not a whole run.** A subway or LIRR trip
 * arrives as the full sequence of stops ahead of it, so the last entry is the
 * terminus and "this stop is the last entry" means the train ends here. NYC
 * Ferry publishes a single departure/arrival pair per leg instead, which
 * makes *every* departure look like a terminus under that rule — and
 * `isBoardable()`, which rejects a stop time with no onward destination,
 * then discards every boat in the feed. Measured: 11 real future departures,
 * 0 surviving.
 *
 * So the destination comes from the operator's headsign, which is present on
 * every trip and is what the boat itself is signed as. A sailing is
 * boardable when it has a departure time, the question the leg shape can
 * actually answer.
 */

import { FeedMessage } from "../../protocol/proto/generated/gtfs-realtime";
import apis from "../../staticData/ferry/apis.json";
import tripLookup from "../../staticData/ferry/trips.json";
import stopLookup from "../../staticData/ferry/stops.json";

/** What the static package knows about one trip. */
interface TripInfo {
  /** Route short name, as a rider reads it: "ER", "RS". */
  r: string;
  /** Where the boat is going. */
  h: string;
}

const trips = tripLookup as Record<string, TripInfo | undefined>;
const stops = stopLookup as Record<string, string | undefined>;

/**
 * One upcoming sailing from a landing.
 *
 * Shaped to match the railroad's `EnrichedStopTimeUpdate` closely enough that
 * `ferryRows` can treat them alike: a badge, a destination, and a time.
 */
export interface EnrichedFerryStopTime {
  /** The landing this sailing departs from. */
  stopId: string;
  /** Route short name, for the row's badge. */
  routeId: string;
  /** Trip id, kept so a row has a stable key. */
  tripId: string;
  departure?: { time: number };
  arrival?: { time: number };
  /**
   * Where the boat ends up.
   *
   * Taken from the headsign rather than inferred from the stop sequence —
   * see the note on legs above. Set on every sailing that has one, so
   * `isBoardable()` accepts a boat that is genuinely leaving.
   */
  destinationStopId?: string;
  /** The operator's own headsign, preferred over the terminus's name. */
  headsign?: string;
}

/** The landing name a rider reads, or undefined for an id not in the table. */
export function getFerryStopName(stopId: string): string | undefined {
  return stops[stopId];
}

/** Every landing, for the station picker. */
export function getFerryStops(): { id: string; name: string }[] {
  return Object.entries(stops)
    .filter(([, name]) => Boolean(name))
    .map(([id, name]) => ({ id, name: name as string }));
}

/** Fetch and decode the live trip updates. */
export async function fetchFerryData(): Promise<FeedMessage> {
  const response = await fetch(apis.apiUrl.tripUpdates);

  if (!response.ok) {
    throw new Error(
      `Ferry feed failed: ${response.status} ${response.statusText}`
    );
  }

  const buffer = await response.arrayBuffer();
  return FeedMessage.decode(new Uint8Array(buffer));
}

/**
 * Pull every sailing calling at one landing out of a decoded feed.
 *
 * Mirrors the railroad's `extractDataByStop` in shape, but not in how it
 * decides a destination — see the note on legs at the top of this file.
 */
export function extractFerryDataByStop(
  feed: FeedMessage,
  stopId: string
): EnrichedFerryStopTime[] {
  const sailings: EnrichedFerryStopTime[] = [];

  for (const entity of feed.entity) {
    const update = entity.tripUpdate;
    const tripId = update?.trip?.tripId;
    if (!update || !tripId) continue;

    const stopTimes = update.stopTimeUpdate ?? [];
    const info = trips[tripId];

    for (const stopTime of stopTimes) {
      if (stopTime.stopId !== stopId) continue;

      // A leg, not a run: the stop sequence cannot say whether the boat
      // continues, so a departure time is what marks it boardable. The
      // headsign names where it goes.
      const leaving = Boolean(stopTime.departure?.time);
      const terminus = leaving ? (info?.h ?? tripId) : undefined;

      sailings.push({
        stopId,
        // The feed sends no routeId, so the badge comes from the static join.
        // Falling back to the trip id keeps a row legible rather than blank
        // if a new trip appears before the lookups are regenerated.
        routeId: info?.r ?? tripId,
        tripId,
        departure: stopTime.departure?.time
          ? { time: Number(stopTime.departure.time) }
          : undefined,
        arrival: stopTime.arrival?.time
          ? { time: Number(stopTime.arrival.time) }
          : undefined,
        destinationStopId: terminus,
        headsign: info?.h,
      });
    }
  }

  return sailings;
}

/**
 * The destination to show for a sailing.
 *
 * The operator's headsign, which NYC Ferry sets to the place a rider is
 * going — "Rockaway" where the landing is named "Beach 108th St".
 */
export function getFerryDestination(
  sailing: EnrichedFerryStopTime
): string | null {
  return sailing.headsign ?? null;
}

/** Upcoming sailings from one landing, soonest first. */
export async function getUpcomingFerriesAtStop(
  stopId: string
): Promise<EnrichedFerryStopTime[]> {
  const feed = await fetchFerryData();
  return extractFerryDataByStop(feed, stopId).sort(
    (a, b) =>
      (a.departure?.time ?? a.arrival?.time ?? 0) -
      (b.departure?.time ?? b.arrival?.time ?? 0)
  );
}
