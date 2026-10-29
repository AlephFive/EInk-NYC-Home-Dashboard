/**
 * The ferry, which is shaped unlike every other feed on this board.
 *
 * Its own file because almost nothing carries over from the MTA feeds. Two
 * assumptions that hold for the subway, the railroads and the bus are false
 * here, and each produced a card that was *empty* rather than broken — the
 * hardest kind to notice, since "no boats due" is a legitimate answer:
 *
 * 1. **`routeId` is empty on every trip.** The MTA feeds name their routes.
 *    NYC Ferry identifies a trip only by `tripId` and a stop by a bare
 *    number, so the route, headsign and landing name all come from the static
 *    GTFS package joined at build time.
 * 2. **A trip reports one leg, not a whole run.** The MTA feeds send every
 *    stop ahead of a vehicle, so the last entry is the terminus and "this
 *    stop is the last entry" means it ends here. NYC Ferry sends a single
 *    departure/arrival pair, so that rule marks *every* sailing terminal.
 *
 * The lookups are imported directly rather than through `utils/ferry`, which
 * pulls in the generated protobuf decoder — whose TypeScript enums the test
 * loader cannot parse. See `tests/resolve-ts.mjs`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import ferryStops from "../../EInk-NYC-Home-Dashboard/src/staticData/ferry/stops.json" with { type: "json" };
import ferryTrips from "../../EInk-NYC-Home-Dashboard/src/staticData/ferry/trips.json" with { type: "json" };
import ferryApis from "../../EInk-NYC-Home-Dashboard/src/staticData/ferry/apis.json" with { type: "json" };
import { isBoardable } from "../../EInk-NYC-Home-Dashboard/src/utils/departures.ts";

const landings = ferryStops as Record<string, string>;
const trips = ferryTrips as Record<string, { r: string; h: string }>;

describe("the landing table", () => {
  test("a landing resolves to the name on the pier", () => {
    assert.equal(landings["87"], "Wall St/Pier 11");
    assert.equal(landings["4"], "Hunters Point South");
  });

  test("an unknown landing resolves to nothing, not a guess", () => {
    assert.equal(landings["99999"], undefined);
  });

  test("every landing has a name", () => {
    // The picker offers these by name, so a blank one is unpickable.
    for (const [id, name] of Object.entries(landings)) {
      assert.ok(name.trim().length > 0, `landing ${id} has no name`);
    }
  });

  test("the whole system is present", () => {
    // Guards the generated lookups: a truncated regeneration would shrink
    // the picker silently rather than fail.
    assert.equal(Object.keys(landings).length, 51);
  });
});

describe("the trip table supplies what the feed omits", () => {
  // This is the join the whole card depends on. The feed sends a tripId and
  // nothing else identifying; without this table a row has no badge and no
  // destination.

  test("all seven routes are covered", () => {
    const routes = new Set(Object.values(trips).map((t) => t.r));
    assert.deepEqual(
      [...routes].sort(),
      ["AS", "ER", "RES", "RS", "RWS", "SB", "SG"]
    );
  });

  test("every trip carries a route and a headsign", () => {
    for (const [tripId, info] of Object.entries(trips)) {
      assert.ok(info.r, `trip ${tripId} has no route`);
      assert.ok(info.h, `trip ${tripId} has no headsign`);
    }
  });

  test("route names are short enough for a badge", () => {
    // Badges are capped at 76px; "RWS" is the longest and fits. A full route
    // name would crowd out the destination beside it.
    for (const info of Object.values(trips)) {
      assert.ok(
        info.r.length <= 3,
        `"${info.r}" is too long for a ferry badge`
      );
    }
  });

  test("a headsign names a place, not a route", () => {
    // NYC Ferry signs boats for where a rider is going — "Rockaway", where
    // the landing itself is "Beach 108th St". A headsign that merely echoed
    // the route code would leave the destination column saying nothing.
    const echoes = Object.values(trips).filter((t) => t.h === t.r);
    assert.equal(echoes.length, 0, `${echoes.length} headsigns echo the route`);
  });
});

describe("a sailing is boardable when it is leaving", () => {
  // The leg-shape consequence, stated as a rule. `isBoardable()` rejects a
  // stop time with no onward destination, so the ferry extractor sets one
  // from the headsign whenever a departure time is present — rather than
  // inferring a terminus from the stop sequence, which for this feed is
  // always "yes" and discarded all 11 real departures when measured.

  const sailing = (over: Record<string, unknown> = {}) => ({
    departure: { time: 1_793_285_172 },
    destinationStopId: "Rockaway",
    ...over,
  });

  test("a boat with a departure time and a headsign is boardable", () => {
    assert.equal(isBoardable(sailing()), true);
  });

  test("a boat arriving and going no further is not", () => {
    // The end of a run: an arrival, no departure. The LIRR shape.
    assert.equal(
      isBoardable({ arrival: { time: 1 }, destinationStopId: undefined }),
      false
    );
  });

  test("a departure with no destination is not boardable", () => {
    // Guards the extractor's own contract: if the headsign join ever fails,
    // the row must drop out rather than render blank.
    assert.equal(isBoardable(sailing({ destinationStopId: undefined })), false);
  });
});

describe("the feed endpoint", () => {
  test("is the operator's realtime feed, not a timetable", () => {
    // The project reports what live feeds say. A schedule can only claim a
    // departure, never observe one, which is why the static timetable was
    // replaced rather than kept as a fallback.
    assert.match(ferryApis.apiUrl.tripUpdates, /gtfsrealtime/);
  });

  test("is HTTP, deliberately", () => {
    // Connexionz publishes no TLS endpoint. Nothing secret crosses it —
    // public sailing times — but a reader seeing http:// should find this
    // test rather than assume a mistake.
    assert.match(ferryApis.apiUrl.tripUpdates, /^http:\/\//);
  });

  test("the static package is recorded for regeneration", () => {
    // trips.json is a schedule snapshot. When NYC Ferry changes schedules,
    // trip ids shift and unknown trips fall back to showing a raw id as the
    // badge, so the source has to stay findable.
    assert.match(ferryApis.staticGtfs, /^https?:\/\//);
  });
});
