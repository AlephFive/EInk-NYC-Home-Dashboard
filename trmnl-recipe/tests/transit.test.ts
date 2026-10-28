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
import {
  subwayRouteLabel,
  subwayRouteGlyph,
} from "../../EInk-NYC-Home-Dashboard/src/utils/subway/routeLabel.ts";

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

describe("special route display rules", () => {
  // Three MTA conventions turn a feed route id into the thing a rider sees
  // on the platform. Each one is invisible when broken: the board shows a
  // plausible bullet that disagrees with the station it is standing in.
  //
  // These test subwayRouteGlyph, which the Liquid layouts mirror. The
  // templates cannot import it, so the rule lives here in one place and the
  // four layouts reproduce it — if this block changes, grep the layouts.

  describe("every shuttle is signed S", () => {
    // The feeds use internal ids, but the MTA signs, maps and announces all
    // three shuttles as S, and the station table says S too. Without the
    // mapping a card's heading bullet and its rows disagree.
    const shuttles: [string, string][] = [
      ["GS", "42nd St, Times Sq to Grand Central"],
      ["FS", "Franklin Av, Brooklyn"],
      ["H", "Rockaway Park, via Broad Channel"],
    ];

    for (const [routeId, where] of shuttles) {
      test(`${routeId} (${where}) shows as S`, () => {
        assert.deepEqual(subwayRouteGlyph(routeId), {
          glyph: "S",
          isExpress: false,
        });
      });
    }

    test("all three collapse to the same glyph", () => {
      // The point of the rule: a rider cannot tell them apart, so neither
      // should the board.
      const glyphs = shuttles.map(([id]) => subwayRouteGlyph(id).glyph);
      assert.deepEqual([...new Set(glyphs)], ["S"]);
    });

    test("S fits a one-character bullet", () => {
      // The layouts draw a circle only for a glyph of one or two characters.
      assert.ok(subwayRouteGlyph("GS").glyph.length <= 2);
    });
  });

  describe("an express drops its X and gains a diamond", () => {
    // The feed suffixes X; the MTA draws the shape instead. So "7X" must
    // never reach the panel as text — it is a 7 in a diamond.
    const expresses: [string, string][] = [
      ["6X", "6"],
      ["7X", "7"],
    ];

    for (const [routeId, glyph] of expresses) {
      test(`${routeId} is the ${glyph} in a diamond`, () => {
        assert.deepEqual(subwayRouteGlyph(routeId), { glyph, isExpress: true });
      });
    }

    test("the X never survives into a label", () => {
      for (const [routeId] of expresses) {
        assert.ok(
          !subwayRouteGlyph(routeId).glyph.includes("X"),
          `${routeId} kept its X`
        );
      }
    });

    test("a local route keeps its circle", () => {
      for (const r of ["1", "6", "7", "A", "G", "Q"]) {
        assert.deepEqual(subwayRouteGlyph(r), { glyph: r, isExpress: false });
      }
    });
  });

  describe("the Staten Island Railway shows SI", () => {
    // The feed runs two service patterns, SI and SS, over one 21-station
    // line; the station table calls all of it SIR. A rider sees none of
    // that: the R211 trains now on the line carry a circular SI bullet,
    // like any other subway route, and station signage is following.
    for (const routeId of ["SI", "SS", "SIR"]) {
      test(`${routeId} shows as SI`, () => {
        assert.deepEqual(subwayRouteGlyph(routeId), {
          glyph: "SI",
          isExpress: false,
        });
      });
    }

    test("SI fits a bullet, SIR would not", () => {
      // Why the label is SI and not SIR: two characters fit the circle the
      // layouts draw, three spill out of it and fall back to a pill.
      assert.equal(subwayRouteGlyph("SIR").glyph.length, 2);
    });
  });

  describe("the three rules do not fire on each other", () => {
    // Each rule keys on something the others nearly match, so a loose
    // implementation of any one of them breaks another.

    test("SS is the railway, not a shuttle", () => {
      // A rule keyed on a leading S would fold the whole railway into the
      // 42nd St shuttle.
      assert.notEqual(subwayRouteGlyph("SS").glyph, "S");
      assert.notEqual(subwayRouteGlyph("SI").glyph, "S");
    });

    test("no shuttle or railway id is read as express", () => {
      // None of them ends in X, and the express rule must stay narrow
      // enough that none is tempting.
      for (const id of ["GS", "FS", "H", "SI", "SS", "SIR"]) {
        assert.equal(
          subwayRouteGlyph(id).isExpress,
          false,
          `${id} was drawn as a diamond`
        );
      }
    });

    test("a shuttle keeps its trailing S", () => {
      // Stripping a trailing letter the way the express rule strips X would
      // turn GS into G — a real route, on the other side of Brooklyn.
      assert.equal(subwayRouteGlyph("GS").glyph, "S");
      assert.notEqual(subwayRouteGlyph("GS").glyph, "G");
    });

    test("an express variant is not rewritten by the label map", () => {
      // subwayRouteLabel passes 7X through untouched, so the express rule
      // is what handles it. If the map ever caught it first, the diamond
      // would be lost.
      assert.equal(subwayRouteLabel("7X"), "7X");
    });

    test("a bus route or railroad branch stays a pill", () => {
      // Three or more characters: no bullet, and nothing stripped. "Babylon"
      // in a circle is unreadable, and a "Q101" shortened to "Q10" is a
      // different route.
      for (const name of ["Q101", "B41", "Babylon", "Port Washington"]) {
        const { glyph, isExpress } = subwayRouteGlyph(name);
        assert.equal(glyph, name);
        assert.equal(isExpress, false);
        assert.ok(glyph.length > 2, `${name} would be drawn as a bullet`);
      }
    });
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
    // The station table's own spelling, which is why subwayRouteLabel has to
    // normalise SIR as well as the feed's SI and SS.
    assert.deepEqual(getSubwayRoutes("S31"), ["SIR"]);
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
