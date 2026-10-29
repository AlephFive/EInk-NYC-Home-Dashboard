/**
 * Capture a live feed, pruned to the trips calling at one stop.
 *
 * The card builders have never been under test. They cannot be: building a
 * card needs a decoded feed, and the generated protobuf declares TypeScript
 * enums that `--experimental-strip-types` refuses outright — so a test that
 * imports the decoder cannot load at all. Every defect found by hand this
 * session lived in exactly that gap: a crash on an unmapped route id, feed
 * ids leaking into the heading bullets, and a ferry card that rendered
 * nothing because its trips report one leg rather than a whole run.
 *
 * A captured feed closes it. Decoding happens here, at capture time, and the
 * fixture is plain JSON the tests can import without the decoder.
 *
 * **Pruned, not whole.** A raw a_division capture is 184KB of 416 trips, of
 * which 24 touch any given station. Keeping only those makes a fixture small
 * enough to read in a diff and to edit by hand when a test needs a case the
 * network did not happen to produce — a terminating train, a delay, an
 * express that is not running today.
 *
 * Usage:
 *   node scripts/captureFixture.mjs <name> <feed> <stopId> [stopId...]
 *
 *   node scripts/captureFixture.mjs subway-vernon a_division 721
 *   node scripts/captureFixture.mjs lirr-jamaica lirr 102
 *   node scripts/captureFixture.mjs ferry-wall-st ferry 87
 *
 * Subway stop IDs match by prefix, because the feeds address a platform
 * ("721N", "721S") where a card names the station.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FeedMessage } from "../../EInk-NYC-Home-Dashboard/src/protocol/proto/generated/gtfs-realtime.ts";
import subwayApis from "../../EInk-NYC-Home-Dashboard/src/staticData/subway/apis.json" with { type: "json" };
import railroadApis from "../../EInk-NYC-Home-Dashboard/src/staticData/railroad/apis.json" with { type: "json" };
import ferryApis from "../../EInk-NYC-Home-Dashboard/src/staticData/ferry/apis.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, "../tests/fixtures");

const [name, feed, ...stopIds] = process.argv.slice(2);

if (!name || !feed || stopIds.length === 0) {
  console.error(
    "Usage: node scripts/captureFixture.mjs <name> <feed> <stopId> [stopId...]"
  );
  console.error("  feed: a subway feed key, 'lirr', 'mtn', or 'ferry'");
  process.exit(1);
}

/** The URL for a feed key, whichever network it belongs to. */
function feedUrl(key) {
  if (key === "ferry") return ferryApis.apiUrl.tripUpdates;
  if (key === "lirr" || key === "mtn") return railroadApis.apiUrl[key];
  const url = subwayApis.apiUrl[key];
  if (!url) {
    throw new Error(
      `Unknown feed "${key}". Subway feeds: ${Object.keys(subwayApis.apiUrl).join(", ")}`
    );
  }
  return url;
}

const url = feedUrl(feed);
console.log(`fetching ${feed}\n  ${url}`);

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`${feed} returned ${response.status} ${response.statusText}`);
}

const raw = new Uint8Array(await response.arrayBuffer());
const decoded = FeedMessage.decode(raw);

/** Whether a stop time belongs to a stop this fixture is about. */
const wanted = (stopId) =>
  stopId !== undefined &&
  stopIds.some((id) => stopId === id || stopId.startsWith(id));

/**
 * Keep a trip only if it calls at one of the named stops, and keep the
 * trip's *whole* stop sequence when it does.
 *
 * Trimming to the matching stop alone would destroy the thing most worth
 * testing: the last entry in the sequence is how a terminus is recognised,
 * and dropping it would make every train look like it terminates here —
 * which is precisely the bug the ferry feed's leg shape caused for real.
 */
const matching = decoded.entity.filter((entity) =>
  (entity.tripUpdate?.stopTimeUpdate ?? []).some((stopTime) =>
    wanted(stopTime.stopId)
  )
);

/**
 * How many trips a fixture keeps.
 *
 * Jamaica matched 96 trips and Jay St 50, which is more of the same thing at
 * the cost of a file nobody will read — 130KB for Jay St before this cap.
 * Twenty covers both directions and every branch at the stations captured so
 * far, with room to spare.
 *
 * Earliest first, so the kept trips are the ones a card would actually show.
 */
const MAX_TRIPS = 20;

const departureTime = (entity) => {
  const times = (entity.tripUpdate?.stopTimeUpdate ?? [])
    .filter((stopTime) => wanted(stopTime.stopId))
    .map((stopTime) =>
      Number(stopTime.departure?.time ?? stopTime.arrival?.time ?? 0)
    )
    .filter(Boolean);
  return times.length > 0 ? Math.min(...times) : Infinity;
};

const entities = [...matching]
  .sort((a, b) => departureTime(a) - departureTime(b))
  .slice(0, MAX_TRIPS);

/**
 * Keep only the fields the code actually reads.
 *
 * Protobuf decodes every absent field to its zero value, so a raw capture
 * carries `delay: 0`, `uncertainty: 0` and `scheduledTime: 0` on every stop
 * time — 100KB for 24 trips, unreadable in a diff. Grepping the extractors
 * for what they consume gives six fields: stopId, the two times, routeId,
 * tripId, and the trip's stop sequence.
 *
 * Narrow by design. A fixture carrying fields nothing reads invites a test
 * to assert on them, and then the fixture is pinning the MTA's defaults
 * rather than our behaviour.
 */
function pruneTrip(entity) {
  const update = entity.tripUpdate;
  const time = (t) =>
    t?.time ? { time: Number(t.time) } : undefined;

  return {
    tripUpdate: {
      trip: {
        tripId: update.trip?.tripId,
        // Empty on the ferry feed, which is why the ferry joins against the
        // static package instead. Kept so a fixture shows that honestly.
        routeId: update.trip?.routeId || undefined,
      },
      stopTimeUpdate: (update.stopTimeUpdate ?? []).map((stopTime) => {
        const pruned = { stopId: stopTime.stopId };
        const arrival = time(stopTime.arrival);
        const departure = time(stopTime.departure);
        if (arrival) pruned.arrival = arrival;
        if (departure) pruned.departure = departure;
        return pruned;
      }),
    },
  };
}

const fixture = {
  _comment:
    `Captured from the ${feed} feed, pruned to trips calling at ` +
    `${stopIds.join(", ")}. Times are rebased on load — see tests/fixtures/load.ts. ` +
    `Regenerate with: node scripts/captureFixture.mjs ${name} ${feed} ${stopIds.join(" ")}`,
  capturedAt: new Date().toISOString(),
  feed,
  stopIds,
  entity: entities.map(pruneTrip),
};

mkdirSync(FIXTURE_DIR, { recursive: true });
const out = resolve(FIXTURE_DIR, `${name}.json`);
writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n", "utf8");

const bytes = JSON.stringify(fixture).length;
console.log(
  `\n${decoded.entity.length} trips in the feed, ${entities.length} calling at ${stopIds.join(", ")}`
);
console.log(`wrote tests/fixtures/${name}.json  (${(bytes / 1024).toFixed(1)}KB)`);

if (entities.length === 0) {
  console.warn(
    "\nNothing matched. Check the stop ID, or capture during service hours."
  );
}
