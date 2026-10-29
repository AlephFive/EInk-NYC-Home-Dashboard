/**
 * Pulling departures out of a feed, against captured responses.
 *
 * Everything here runs on fixtures — real feed data, pruned to the trips
 * calling at one stop and rebased to now on load. See `fixtures/load.ts`.
 *
 * This is the layer that had no tests at all. The extractors take a decoded
 * feed, and importing the decoder breaks the test loader outright, so until
 * the fixtures existed the only way to exercise them was to deploy and look.
 * Every defect found by hand this session lived here:
 *
 * - a crash on a route id that maps to no feed
 * - internal feed ids reaching the card's heading
 * - a ferry card rendering nothing because its trips report one leg
 *
 * The fixtures do not pin *values* — the 7 runs on its own schedule and
 * times shift on every capture. They pin **shape**: which trips exist, where
 * they stop, which carry a departure and which only an arrival, and which
 * one is last in the sequence.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { extractDataByStop } from "../../EInk-NYC-Home-Dashboard/src/utils/subway/fetchTrainData.ts";
import { extractFerryDataByStop } from "../../EInk-NYC-Home-Dashboard/src/utils/ferry/fetchFerryData.ts";
import { isBoardable } from "../../EInk-NYC-Home-Dashboard/src/utils/departures.ts";
import { loadFeed, loadFixture, editFeed } from "./fixtures/load.ts";

describe("a subway stop, from a captured feed", () => {
  // Vernon Blvd-Jackson Av: the 7 only, one route, both directions. The
  // simplest real case, and the one that hid two bugs precisely because it
  // is simple — a single-route station never exercises the route expansion
  // that crashed on multi-route complexes.
  const feed = loadFeed("subway-vernon");

  test("the feed carries trips in both directions", () => {
    // Platforms, not stations: the feed addresses "721N" and "721S".
    const northbound = extractDataByStop(feed as never, "721N");
    const southbound = extractDataByStop(feed as never, "721S");
    assert.ok(northbound.length > 0, "no northbound trains");
    assert.ok(southbound.length > 0, "no southbound trains");
  });

  test("a stop ID matches its own platform only", () => {
    const northbound = extractDataByStop(feed as never, "721N");
    for (const stop of northbound) {
      assert.equal(stop.stopId, "721N");
    }
  });

  test("every extracted stop time knows its route", () => {
    // The badge comes from this. An empty routeId renders a blank bullet.
    for (const stop of extractDataByStop(feed as never, "721N")) {
      assert.ok(stop.routeId, `trip ${stop.tripId} has no routeId`);
    }
  });

  test("a train passing through has somewhere to go", () => {
    // destinationStopId is the trip's last stop, and is what makes a train
    // boardable. At a through station most trains have one.
    const stops = extractDataByStop(feed as never, "721N");
    const withDestination = stops.filter((s) => s.destinationStopId);
    assert.ok(
      withDestination.length > 0,
      "no train at a through station had a destination"
    );
  });

  test("rebasing moves the feed forward to now", () => {
    // The point of the loader, asserted as the property rather than as "some
    // departure is in the future" — a fixture captured minutes ago satisfies
    // that by accident, and would go on satisfying it until it did not.
    //
    // Loading the same fixture at two different "now"s must shift every time
    // by exactly the difference between them.
    const hour = 60 * 60 * 1000;
    const early = loadFeed("subway-vernon", { at: new Date(1_700_000_000_000) });
    const later = loadFeed("subway-vernon", {
      at: new Date(1_700_000_000_000 + hour),
    });

    const timeOf = (f: typeof early) =>
      Number(f.entity[0].tripUpdate.stopTimeUpdate[0].departure?.time ?? 0);

    assert.ok(timeOf(early) > 0, "the fixture's first stop has no departure");
    assert.equal(
      timeOf(later) - timeOf(early),
      3600,
      "an hour later should shift every departure by an hour"
    );
  });

  test("an old fixture still reads as current", () => {
    // Why the loader exists, stated as the thing that actually decays. A
    // fixture captured minutes ago has departures in the future by luck; one
    // captured a year ago has none, the walk-time filter drops everything,
    // and the test then passes by asserting on an empty card — which is how
    // the ferry shipped rendering nothing while its feed was healthy.
    //
    // Rebasing means age cannot do that: loaded a year on, the feed still
    // reads as though it had just arrived.
    const aYearOn = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const feed = loadFeed("subway-vernon", { at: aYearOn });

    const cutoff = aYearOn.getTime() / 1000;
    const upcoming = feed.entity.filter((trip) =>
      trip.tripUpdate.stopTimeUpdate.some(
        (s) => Number(s.departure?.time ?? 0) > cutoff
      )
    );
    assert.ok(
      upcoming.length > 0,
      "a year-old fixture had no future departures even after rebasing"
    );
  });
});

describe("a terminating train is not boardable", () => {
  // The rule that separates a train you can catch from one ending its run,
  // and the one place the two feed families genuinely disagree: the LIRR
  // omits `departure` on a terminating train, the subway does not. So
  // boardability keys on the destination, which works for both.
  const feed = loadFeed("subway-vernon");

  test("a train whose last stop is this one has no destination", () => {
    // Synthesised: Vernon Blvd is a through station, so the captured feed
    // has no terminating train. Truncating each trip's sequence at this stop
    // produces one, which is cheaper and more reliable than waiting for the
    // network to supply a terminal.
    const terminating = editFeed(feed, (trip) => {
      const stops = trip.tripUpdate.stopTimeUpdate;
      const index = stops.findIndex((s) => s.stopId === "721N");
      if (index >= 0) trip.tripUpdate.stopTimeUpdate = stops.slice(0, index + 1);
    });

    const stops = extractDataByStop(terminating as never, "721N");
    assert.ok(stops.length > 0, "the edit removed every trip");
    for (const stop of stops) {
      assert.equal(
        stop.destinationStopId,
        undefined,
        "a train ending here still reports a destination"
      );
      assert.equal(isBoardable(stop), false);
    }
  });

  test("the same trains are boardable before the edit", () => {
    // The control. Without it the test above would pass just as well on a
    // feed the extractor had failed to read at all.
    const stops = extractDataByStop(feed as never, "721N");
    assert.ok(
      stops.some(isBoardable),
      "nothing was boardable even before truncating"
    );
  });
});

describe("a branching station, from a captured feed", () => {
  // Jay St-MetroTech: A, C and F southbound, with five distinct terminals.
  // This is the station that disproved hoisting the destination into the
  // column heading — a rule built against Vernon Blvd, where every train
  // goes to the same place.
  const feed = loadFeed("subway-jay-st");

  test("one stop carries several routes", () => {
    const routes = new Set(
      extractDataByStop(feed as never, "A41S").map((s) => s.routeId)
    );
    assert.ok(
      routes.size > 1,
      `expected several routes at Jay St, got ${[...routes].join(",")}`
    );
  });

  test("trains at one stop go to different places", () => {
    // Why every row keeps its own destination. If this ever returns one,
    // the fixture is from a night when only one line was running.
    const destinations = new Set(
      extractDataByStop(feed as never, "A41S")
        .map((s) => s.destinationStopId)
        .filter(Boolean)
    );
    assert.ok(
      destinations.size > 1,
      `expected several destinations, got ${destinations.size}`
    );
  });
});

describe("the ferry, from a captured feed", () => {
  // The feed that broke two assumptions the MTA feeds had made safe.
  const feed = loadFeed("ferry-wall-st");

  test("a sailing is extracted with a route and a headsign", () => {
    // Neither comes from the feed: routeId is empty on every ferry trip, so
    // both are joined from the static package at extraction time.
    const sailings = extractFerryDataByStop(feed as never, "87");
    assert.ok(sailings.length > 0, "no sailings at Wall St/Pier 11");

    for (const sailing of sailings) {
      assert.ok(sailing.routeId, "a sailing has no route");
      assert.ok(sailing.headsign, "a sailing has no headsign");
    }
  });

  test("a departing boat is boardable despite reporting one leg", () => {
    // The bug this guards. A ferry trip carries a single departure/arrival
    // pair, so "this stop is the last entry" — which marks a terminus on
    // every MTA feed — is true of every sailing. Inferring from the stop
    // sequence discarded all 11 real departures; the destination comes from
    // the headsign instead.
    const leaving = extractFerryDataByStop(feed as never, "87").filter(
      (sailing) => sailing.departure?.time
    );
    assert.ok(leaving.length > 0, "no boat is leaving in the fixture");
    for (const sailing of leaving) {
      assert.equal(
        isBoardable(sailing),
        true,
        `${sailing.routeId} has a departure time but is not boardable`
      );
    }
  });

  test("an arriving boat with no departure is not boardable", () => {
    const arriving = editFeed(feed, (trip) => {
      for (const stopTime of trip.tripUpdate.stopTimeUpdate) {
        delete stopTime.departure;
      }
    });

    for (const sailing of extractFerryDataByStop(arriving as never, "87")) {
      assert.equal(isBoardable(sailing), false);
    }
  });
});
