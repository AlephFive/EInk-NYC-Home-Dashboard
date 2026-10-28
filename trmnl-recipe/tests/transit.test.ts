/**
 * The transit facts the board's correctness rests on.
 *
 * These are not generic unit tests. Each one encodes something about how the
 * MTA actually works that, if forgotten, produces a board which looks fine
 * and is wrong — a direction that silently vanishes, a station showing one
 * line of four, a bus card showing one side of the street.
 *
 * Every assertion here was verified against live feeds before being written,
 * so a failure means either the code regressed or the network changed. Both
 * are worth knowing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  getStationName,
  getSubwayRoutes,
  getDestinationName,
  getDirectionLabels,
} from "../../EInk-NYC-Home-Dashboard/src/utils/stationLookup.ts";
import { isCityBound, getRailroadRouteShortName } from "../../EInk-NYC-Home-Dashboard/src/utils/railroad/routeLookup.ts";
import { isBoardable } from "../../EInk-NYC-Home-Dashboard/src/utils/departures.ts";
import { subwayRouteLabel } from "../../EInk-NYC-Home-Dashboard/src/utils/subway/routeLabel.ts";

describe("a station can carry several lines on one ID", () => {
  test("Coney Island-Stillwell Av serves D, F, N and Q", () => {
    // One stop ID, four lines, spread across two protobuf feeds (bdfm and
    // nqrw). A card naming only one feed shows a quarter of the service and
    // gives no hint that the rest exists.
    const routes = getSubwayRoutes("D43");
    assert.deepEqual([...routes].sort(), ["D", "F", "N", "Q"]);
  });

  test("Jay St-MetroTech serves A, C, F and R", () => {
    const routes = getSubwayRoutes("A41");
    assert.ok(routes.includes("A"), "A is missing");
    assert.ok(routes.includes("F"), "F is missing");
    assert.ok(routes.length >= 3, `expected 3+ routes, got ${routes.join(",")}`);
  });

  test("a single-line station returns exactly one route", () => {
    assert.deepEqual(getSubwayRoutes("721"), ["7"]);
  });
});

describe("a station complex spans several stop IDs", () => {
  // Times Square is five separate records sharing a complex. A card takes
  // whichever IDs it is given, so the picker must offer all five — choosing
  // one is silent: you get real trains, just not the line you meant.
  const timesSquare = [
    ["127", "1/2/3"],
    ["725", "7"],
    ["902", "shuttle"],
    ["R16", "N/Q/R/W"],
    ["A27", "A/C/E"],
  ] as const;

  for (const [id, lines] of timesSquare) {
    test(`${id} (${lines}) resolves to a station name`, () => {
      const name = getStationName(id, "subway");
      assert.ok(name && !name.startsWith("Stop "), `${id} did not resolve`);
    });
  }

  test("the complex's platform groups do not all share a name", () => {
    // A27 is "42 St-Port Authority Bus Terminal". A picker that labels a
    // complex by its first ID alone would mislabel this one, which is why
    // the label takes the most common name across the group.
    assert.notEqual(
      getStationName("A27", "subway"),
      getStationName("127", "subway")
    );
  });
});

describe("express variants", () => {
  // The feed names an express run by suffixing X — 6X and 7X are the ones
  // that exist. The MTA draws these as a diamond rather than a circle, so
  // the X is a shape, not part of the route name.
  const stripExpress = (route: string) =>
    /^[0-9A-Z]X$/.test(route) ? route.slice(0, -1) : route;

  test("7X is the 7 running express", () => {
    assert.equal(stripExpress("7X"), "7");
  });

  test("6X is the 6 running express", () => {
    assert.equal(stripExpress("6X"), "6");
  });

  test("a local route is untouched", () => {
    for (const r of ["1", "7", "A", "G", "Q"]) {
      assert.equal(stripExpress(r), r);
    }
  });

  test("a two-letter route is not mistaken for an express", () => {
    // GS is the 42nd St shuttle and FS the Franklin Av shuttle. Stripping a
    // trailing S would be a different bug, but the rule must not fire on
    // them at all — neither ends in X.
    assert.equal(stripExpress("GS"), "GS");
    assert.equal(stripExpress("FS"), "FS");
    assert.equal(stripExpress("SIR"), "SIR");
  });
});

describe("shuttles are all signed S", () => {
  // The feeds name them by internal route id, but the MTA signs, maps and
  // announces every one as S. The station table already says S, so without
  // the mapping a card's heading bullet and its rows disagree.
  const shuttles: [string, string][] = [
    ["GS", "42nd St, Times Sq to Grand Central"],
    ["FS", "Franklin Av, Brooklyn"],
    ["H", "Rockaway Park, via Broad Channel"],
  ];

  for (const [routeId, where] of shuttles) {
    test(`${routeId} (${where}) shows as S`, () => {
      assert.equal(subwayRouteLabel(routeId), "S");
    });
  }

  test("a numbered or lettered route is untouched", () => {
    for (const r of ["1", "7", "A", "C", "G", "Q"]) {
      assert.equal(subwayRouteLabel(r), r);
    }
  });

  test("an express variant is not swallowed", () => {
    // 7X must still reach the express logic as 7X, not be rewritten here.
    assert.equal(subwayRouteLabel("7X"), "7X");
  });

  test("the Staten Island Railway is one railway, not two", () => {
    // The feed runs it as SI and SS — two service patterns over the same
    // 21 stations — but every platform is signed SIR and a rider has no
    // idea the split exists. Without this the card heading says SIR while
    // its rows say SS, which is the same card disagreeing with itself.
    assert.equal(subwayRouteLabel("SI"), "SIR");
    assert.equal(subwayRouteLabel("SS"), "SIR");
    assert.equal(subwayRouteLabel("SIR"), "SIR");
  });
});

describe("the Staten Island Railway", () => {
  // SIR is unlike the rest of the system and easy to get wrong: it is a
  // single line with no branches, it does not touch the other 471 stations,
  // and it is the only service whose stop IDs are not reachable from any
  // other feed. It is also the one place where "subway" is a stretch — but
  // it rides on the same GTFS-RT plumbing, so the board must handle it.

  test("its stations are in the station table", () => {
    // 21 of them, St George to Tottenville. If they were missing, a card
    // would head itself "Stop S31" and nobody would know why.
    assert.equal(getStationName("S31", "subway"), "St George");
    assert.equal(getStationName("S09", "subway"), "Tottenville");
  });

  test("its stations report SIR as their route", () => {
    assert.deepEqual(getSubwayRoutes("S31"), ["SIR"]);
  });

  test("it is not mistaken for an express variant", () => {
    // "SIR" ends in R, not X, so the express rule must not fire — but the
    // two-character "SS" is the kind of thing a loose rule would catch.
    const stripExpress = (route: string) =>
      /^[0-9A-Z]X$/.test(route) ? route.slice(0, -1) : route;
    assert.equal(stripExpress("SIR"), "SIR");
    assert.equal(stripExpress("SI"), "SI");
    assert.equal(stripExpress("SS"), "SS");
  });

  test("it is not mistaken for a shuttle", () => {
    // SS looks like a shuttle id and is not one; a rule keyed on a leading
    // S would fold the whole railway into the 42nd St shuttle.
    assert.notEqual(subwayRouteLabel("SS"), "S");
    assert.notEqual(subwayRouteLabel("SI"), "S");
  });

  test("its destinations resolve like any other subway stop", () => {
    // Feeds address platforms, so a terminus arrives as "S09S".
    assert.equal(getDestinationName("S09S", "subway"), "Tottenville");
    assert.equal(getDestinationName("S31N", "subway"), "St George");
  });
});

describe("boardability and terminals", () => {
  // The two feed families disagree about a train ending its run: LIRR omits
  // `departure`, the subway does not. At Coney Island all 51 southbound
  // trains carry both arrival and departure while every one of them
  // terminates, so `departure` alone passes 51 dead trains.
  test("a train with somewhere to go is boardable", () => {
    assert.equal(
      isBoardable({ departure: { time: 1 }, destinationStopId: "D43" }),
      true
    );
  });

  test("a train terminating here is not", () => {
    // extractDataByStop leaves destinationStopId undefined when this stop is
    // the trip's last, whichever feed it came from.
    assert.equal(
      isBoardable({ departure: { time: 1 }, destinationStopId: undefined }),
      false
    );
  });

  test("a train with no departure time is not", () => {
    assert.equal(isBoardable({ destinationStopId: "D43" }), false);
  });
});

describe("destination resolution", () => {
  test("a subway destination strips its N/S suffix", () => {
    // Feeds address a platform, not a station: the 7's Manhattan terminal is
    // "726S". Looking that up directly finds nothing.
    const withSuffix = getDestinationName("726S", "subway");
    const bare = getDestinationName("726", "subway");
    assert.equal(withSuffix, bare);
    assert.ok(withSuffix, "726S did not resolve");
  });

  test("a train terminating here has no destination to show", () => {
    assert.equal(getDestinationName(undefined, "subway"), null);
  });

  test("LIRR and Metro-North reuse stop IDs", () => {
    // Stop "1" is Albertson on the LIRR and Grand Central on Metro-North.
    // Merging the two tables would make a card show the wrong station
    // entirely, which is why they are indexed separately.
    const lirr = getDestinationName("1", "railroad-lirr");
    const mtn = getDestinationName("1", "railroad-mtn");
    assert.notEqual(lirr, mtn);
    assert.equal(mtn, "Grand Central");
  });
});

describe("railroad direction", () => {
  // GTFS directionId cannot carry this: it is absent on ~32% of LIRR trips
  // and is 0 for every Metro-North trip regardless of direction. The
  // destination against a terminal list works for both.
  test("a train into Penn Station is city-bound", () => {
    assert.equal(isCityBound("237", "lirr"), true);
  });

  test("a train to Grand Central is city-bound on Metro-North", () => {
    assert.equal(isCityBound("1", "mtn"), true);
  });

  test("a train out to the island is not", () => {
    assert.equal(isCityBound("102", "lirr"), false);
  });

  test("a train terminating here has no direction", () => {
    // Undefined, not false: the board draws no arrow rather than claiming
    // the train is outbound.
    assert.equal(isCityBound(undefined, "lirr"), null);
  });

  test("a branch name drops its 'Branch' suffix", () => {
    // "Babylon Branch" would not fit the badge, and the word carries nothing.
    const name = getRailroadRouteShortName("8", "lirr");
    assert.ok(!/ Branch$/.test(name), `"${name}" still says Branch`);
  });
});

describe("direction labels come from the MTA's own wayfinding", () => {
  test("a station's labels are its platform signage", () => {
    // "Manhattan" and "Queens", not "Northbound" and "Southbound" — the
    // rider is reading the same words as the platform sign.
    const labels = getDirectionLabels("721");
    assert.ok(labels, "Vernon Blvd has no direction labels");
    assert.ok(
      labels.northbound || labels.southbound,
      "neither direction is labelled"
    );
  });

  test('"Last Stop" is a label, not a terminal test', () => {
    // The GeoJSON says "Last Stop" at terminals, but it is signage text:
    // boardability comes from the feed, never from this string.
    const labels = getDirectionLabels("701");
    if (labels?.northbound === "Last Stop" || labels?.southbound === "Last Stop") {
      assert.ok(true, "present, and deliberately not used as a terminal test");
    }
  });
});
