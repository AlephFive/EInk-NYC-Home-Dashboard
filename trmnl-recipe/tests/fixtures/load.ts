/**
 * Captured feeds, with their timestamps rebased to now.
 *
 * A fixture is a real feed response pruned to the trips calling at one stop
 * — see `scripts/captureFixture.mjs`. It exists because the card builders
 * are otherwise untestable: building a card needs a decoded feed, and the
 * generated protobuf declares TypeScript enums that the test loader refuses,
 * so a test importing the decoder cannot even load.
 *
 * **Every fixture is stale the moment it is written.** A departure captured
 * at 11:45 is in the past by the time the test runs, and the walk-time
 * filter drops past departures — so a fixture used as-is yields an empty
 * card and a test that passes by asserting nothing. That is not a
 * hypothetical: it is exactly how the ferry card rendered zero rows while
 * the feed was healthy.
 *
 * So times are shifted on load by `(now - capturedAt)`, which makes the feed
 * read as though it had just arrived. The *shape* is what the fixtures pin —
 * which trips exist, where they stop, which carry a departure and which only
 * an arrival — and that shape is preserved exactly. Relative gaps between
 * departures are preserved too, so "the next three trains" stays meaningful.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** A stop time, carrying whichever of the two times the feed supplied. */
export interface FixtureStopTime {
  stopId: string;
  arrival?: { time: number };
  departure?: { time: number };
}

export interface FixtureTrip {
  tripUpdate: {
    trip: { tripId?: string; routeId?: string };
    stopTimeUpdate: FixtureStopTime[];
  };
}

export interface Fixture {
  capturedAt: string;
  feed: string;
  stopIds: string[];
  entity: FixtureTrip[];
}

/** Shift every time in a trip by `offsetSeconds`. */
function rebaseTrip(trip: FixtureTrip, offsetSeconds: number): FixtureTrip {
  return {
    tripUpdate: {
      trip: { ...trip.tripUpdate.trip },
      stopTimeUpdate: trip.tripUpdate.stopTimeUpdate.map((stopTime) => {
        const shifted: FixtureStopTime = { stopId: stopTime.stopId };
        if (stopTime.arrival) {
          shifted.arrival = { time: stopTime.arrival.time + offsetSeconds };
        }
        if (stopTime.departure) {
          shifted.departure = { time: stopTime.departure.time + offsetSeconds };
        }
        return shifted;
      }),
    },
  };
}

/**
 * Load a fixture with its times rebased so it reads as captured now.
 *
 * @param name - File stem under `tests/fixtures`, e.g. "subway-vernon".
 * @param options.at - Treat this as the current time instead of `Date.now()`,
 *   for a test that needs a departure at a known offset.
 */
export function loadFixture(
  name: string,
  options: { at?: Date } = {}
): Fixture {
  const path = resolve(here, `${name}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Fixture;

  const capturedAt = new Date(raw.capturedAt).getTime();
  const now = (options.at ?? new Date()).getTime();
  const offsetSeconds = Math.round((now - capturedAt) / 1000);

  return {
    ...raw,
    entity: raw.entity.map((trip) => rebaseTrip(trip, offsetSeconds)),
  };
}

/**
 * A fixture shaped as the decoder would return it.
 *
 * The extractors take a `FeedMessage`, of which they read only `entity` —
 * so a fixture stands in without the decoder being involved at all.
 */
export function loadFeed(name: string, options: { at?: Date } = {}) {
  return { entity: loadFixture(name, options).entity };
}

/**
 * Edit a loaded fixture, for cases the network did not happen to produce.
 *
 * The captured feed is whatever the MTA was running that minute; a test
 * often needs something rarer — a train terminating here, a trip with no
 * departure time, an express that is not running today. Rather than wait for
 * the network to oblige, change the one field that matters and say so.
 *
 * @example
 * // Make every train terminate at this stop.
 * const feed = editFeed(loadFeed("subway-vernon"), (trip) => {
 *   trip.tripUpdate.stopTimeUpdate = trip.tripUpdate.stopTimeUpdate.slice(0, 1);
 * });
 */
export function editFeed(
  feed: { entity: FixtureTrip[] },
  edit: (trip: FixtureTrip, index: number) => void
): { entity: FixtureTrip[] } {
  const copy = JSON.parse(JSON.stringify(feed)) as { entity: FixtureTrip[] };
  copy.entity.forEach(edit);
  return copy;
}
