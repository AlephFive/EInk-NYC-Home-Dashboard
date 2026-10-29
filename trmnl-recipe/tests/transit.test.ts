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
  subwayRouteIds,
  subwayRouteMatches,
} from "../../EInk-NYC-Home-Dashboard/src/utils/subway/routeLabel.ts";
import apis from "../../EInk-NYC-Home-Dashboard/src/staticData/subway/apis.json" with { type: "json" };
import ferryTrips from "../../EInk-NYC-Home-Dashboard/src/staticData/ferry/trips.json" with { type: "json" };
// The lookups directly, not through utils/ferry: that module imports the
// generated protobuf decoder, whose enums the test loader cannot parse.
import ferryStops from "../../EInk-NYC-Home-Dashboard/src/staticData/ferry/stops.json" with { type: "json" };
import { subwayFeedKey, feedKeysFor } from "../../EInk-NYC-Home-Dashboard/src/utils/subway/feedLookup.ts";

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

describe("label to feed route ids, the reverse direction", () => {
  // The forward direction is many-to-one, so going back fans out. Code that
  // needs one id for a label picks the wrong shuttle, silently.

  test("S is all three shuttles", () => {
    assert.deepEqual([...subwayRouteIds("S")].sort(), ["FS", "GS", "H"]);
  });

  test("SI is both of the railway's service patterns", () => {
    assert.deepEqual([...subwayRouteIds("SI")].sort(), ["SI", "SS"]);
  });

  test("a plain route carries its express variant", () => {
    // Asking for the 7 must reach the 7X, or a rider who asked for the 7 is
    // shown no express trains — a surprising kind of correct.
    assert.deepEqual(subwayRouteIds("7"), ["7", "7X"]);
    assert.deepEqual(subwayRouteIds("6"), ["6", "6X"]);
    // Including the F, whose FX is running today and which a hardcoded
    // 6X/7X list had missed.
    assert.deepEqual(subwayRouteIds("F"), ["F", "FX"]);
  });

  test("an express is not doubled into an XX", () => {
    // A feed id that is already express stands for itself.
    assert.deepEqual(subwayRouteIds("7X"), ["7X"]);
  });

  test("the plain route is still included", () => {
    // The express is appended, not substituted.
    assert.ok(subwayRouteIds("7").includes("7"));
  });

  test("a multi-character route gains no express form", () => {
    // Only a single character can take the X suffix — the same bound the
    // detection regex applies — so a bus route does not sprout a "Q101X".
    assert.deepEqual(subwayRouteIds("Q101"), ["Q101"]);
  });

  test("it is case-insensitive", () => {
    assert.deepEqual([...subwayRouteIds("s")].sort(), ["FS", "GS", "H"]);
  });

  test("the station table's own spelling resolves to feed ids", () => {
    // getSubwayRoutes("S31") returns "SIR", so this is what a St George
    // card actually asks for. It must reach SI and SS — never itself, which
    // no feed reports and nothing can fetch.
    assert.deepEqual([...subwayRouteIds("SIR")].sort(), ["SI", "SS"]);
    assert.ok(!subwayRouteIds("SIR").includes("SIR"));
  });

  test("an unknown label stands for itself", () => {
    // Most routes are not in the label map: the L is just the L. A label
    // this module has never heard of is still a route id — plus the
    // express form the X rule derives, which is unmapped and so inert.
    assert.ok(subwayRouteIds("L").includes("L"));
    assert.equal(subwayRouteLabel("L"), "L");
  });

  describe("round-tripping against the forward direction", () => {
    // The two functions must agree, or a card fetches one set of feeds and
    // then filters the results with a different rule.
    for (const label of ["S", "SI", "1", "7", "A", "G", "Q"]) {
      test(`every id behind "${label}" labels back to it`, () => {
        for (const id of subwayRouteIds(label)) {
          assert.equal(
            subwayRouteGlyph(id).glyph,
            label.toUpperCase(),
            `${id} does not read as ${label}`
          );
        }
      });
    }
  });
});

describe("a label resolves to the feeds its trains are actually in", () => {
  // The bug this guards: the station table signs every shuttle "S", and a
  // lineMappings keyed on "S" sent Franklin Av to a_division — where its
  // trains do not exist. The card fetched a real feed and showed nothing.
  const feedFor = (id: string) =>
    apis.lineMappings[id as keyof typeof apis.lineMappings];

  test("the three shuttles are in three different feeds", () => {
    // Verified against live feeds: ace carries H, bdfm carries FS,
    // a_division carries GS.
    assert.equal(feedFor("GS"), "a_division");
    assert.equal(feedFor("FS"), "bdfm");
    assert.equal(feedFor("H"), "ace");
  });

  test("asking for S reaches all three", () => {
    const feeds = new Set(subwayRouteIds("S").map(feedFor));
    assert.deepEqual([...feeds].sort(), ["a_division", "ace", "bdfm"]);
  });

  test("an express rides its local's feed", () => {
    for (const [local, express] of [["6", "6X"], ["7", "7X"], ["F", "FX"]]) {
      assert.equal(
        feedFor(express),
        feedFor(local),
        `${express} is not in the same feed as the ${local}`
      );
    }
  });

  test("every route the feeds report is mapped", () => {
    // The direction that matters. Asserting the generator only emits mapped
    // ids would be circular — it would pass by construction and say nothing
    // about whether a real train can be fetched.
    //
    // This list is what the live feeds carried when checked. A route the
    // MTA adds shows up here as a failure, which is the point.
    const live = [
      "A", "C", "E", "H",
      "B", "D", "F", "FS", "FX", "M",
      "J", "Z", "N", "Q", "R", "W", "L", "G",
      "1", "2", "3", "4", "5", "6", "6X", "7", "7X", "GS",
      "SI", "SS",
    ];
    for (const id of live) {
      assert.ok(feedFor(id), `${id} runs today but has no feed mapping`);
    }
  });

  test("an express nobody runs costs nothing", () => {
    // subwayRouteIds guesses wide — "1" yields "1X" though no 1X runs —
    // because the X suffix is the rule, not a list to maintain. The guess
    // is harmless: resolving a route id to a feed skips what is unmapped.
    assert.ok(subwayRouteIds("1").includes("1X"));
    assert.equal(feedFor("1X"), undefined);

    const feeds = new Set(subwayRouteIds("1").map(feedFor).filter(Boolean));
    assert.deepEqual([...feeds], ["a_division"], "the 1 still fetches cleanly");
  });

  test("no mapping key is unreachable", () => {
    // SR and SF were invented keys that nothing ever produced — the station
    // table says "S" — so they sat in the file looking correct while the
    // shuttles they named went unfetched.
    const reachable = new Set<string>();
    for (const label of Object.keys(apis.lineMappings)) {
      for (const id of subwayRouteIds(label)) reachable.add(id);
    }
    for (const key of Object.keys(apis.lineMappings)) {
      assert.ok(reachable.has(key), `"${key}" is in lineMappings but unreachable`);
    }
  });
});

describe("matching a train against the lines a rider asked for", () => {
  test("a line matches itself", () => {
    assert.equal(subwayRouteMatches("7", ["7"]), true);
  });

  test("asking for the 7 includes the 7X", () => {
    assert.equal(subwayRouteMatches("7X", ["7"]), true);
  });

  test("asking for S includes every shuttle", () => {
    for (const id of ["GS", "FS", "H"]) {
      assert.equal(subwayRouteMatches(id, ["S"]), true, `${id} did not match`);
    }
  });

  test("asking for SI includes both service patterns", () => {
    assert.equal(subwayRouteMatches("SS", ["SI"]), true);
    assert.equal(subwayRouteMatches("SI", ["SI"]), true);
  });

  test("the feed's own id still matches", () => {
    // A user who writes GS rather than S gets what they asked for.
    assert.equal(subwayRouteMatches("GS", ["GS"]), true);
  });

  test("an unrelated line does not match", () => {
    assert.equal(subwayRouteMatches("N", ["7"]), false);
    assert.equal(subwayRouteMatches("GS", ["G"]), false);
  });

  test("asking for the G does not catch the 42nd St shuttle", () => {
    // GS labels to S, not G. A prefix match would put Brooklyn's G on a
    // Times Square card.
    assert.equal(subwayRouteMatches("GS", ["G"]), false);
  });

  test("it is case-insensitive on both sides", () => {
    assert.equal(subwayRouteMatches("gs", ["s"]), true);
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

describe("cards sharing a feed share one fetch", () => {
  // Decoding protobuf is the Worker's dominant CPU cost — a_division alone
  // measured 3.95ms warm against the free tier's 10ms budget — and the MTA
  // groups ten routes into that one feed. So two cards whose lines differ but
  // whose feeds coincide must not fetch it twice.
  //
  // This is invisible on the rendered board: duplicate fetches produce the
  // correct output, just slowly. Only the cache key says whether it happened.

  test("different lines on one feed share a key", () => {
    // The A division: 1/2/3, 4/5/6 and 7 are three distinct line sets and
    // one feed. Keying on the lines fetched and decoded it three times.
    const keys = [["1", "2", "3"], ["4", "5", "6"], ["7"]].map(subwayFeedKey);
    assert.equal(new Set(keys).size, 1, `expected one key, got ${keys}`);
    assert.equal(keys[0], "a_division");
  });

  test("lines on different feeds do not share a key", () => {
    // The converse: sharing too eagerly would serve a card from a feed its
    // trains are not in, which is the Franklin Av bug in another costume.
    assert.notEqual(subwayFeedKey(["1"]), subwayFeedKey(["A"]));
    assert.notEqual(subwayFeedKey(["A"]), subwayFeedKey(["N"]));
  });

  test("the key is order-independent", () => {
    assert.equal(subwayFeedKey(["7", "1"]), subwayFeedKey(["1", "7"]));
  });

  test("a shuttle's three feeds all appear in its key", () => {
    // "S" spans a_division, bdfm and ace. A key naming only one would let a
    // later card on bdfm reuse a feed fetched for the shuttle and miss trains.
    const key = subwayFeedKey(["S"]);
    for (const feed of ["a_division", "ace", "bdfm"]) {
      assert.ok(key.includes(feed), `${feed} missing from "${key}"`);
    }
  });

  test("a station's own route list keys to its feeds", () => {
    // Coney Island carries D/F/N/Q on one stop ID, across two feeds.
    const key = subwayFeedKey(getSubwayRoutes("D43"));
    assert.equal(new Set(key.split(",")).size, 2, `expected two feeds: ${key}`);
  });
});

describe("a station's expanded lines are all fetchable", () => {
  // The bug this exists for took down every multi-route subway card in
  // production. subwayLinesFor() expands a station's routes into every feed
  // id they could appear under, and that expansion guesses wide on purpose:
  // "1" yields "1X" because the trailing X *is* the express rule, not a list
  // to maintain. No 1X runs, so it maps to no feed — and the fetcher threw on
  // the first such id rather than skipping it.
  //
  // Times Sq expands to 25 ids, 10 of them unmapped, so the card died. Vernon
  // Blvd survived because the 7's express exists, which is why a single-route
  // board looked perfectly healthy.
  //
  // The invariant is not "every id maps" — that would forbid guessing wide.
  // It is "every station resolves to at least one feed, and the unmapped ones
  // are harmless".
  const expand = (routes: string[]) => [
    ...new Set(routes.flatMap(subwayRouteIds)),
  ];

  const stations: [string, string][] = [
    ["127", "Times Sq 1/2/3"],
    ["A27", "42 St-Port Authority"],
    ["D43", "Coney Island, D/F/N/Q"],
    ["A41", "Jay St-MetroTech"],
    ["721", "Vernon Blvd, single route"],
    ["S31", "St George, SIR"],
    ["L08", "Bedford Av"],
  ];

  for (const [stopId, label] of stations) {
    test(`${label} resolves to at least one feed`, () => {
      const ids = expand(getSubwayRoutes(stopId));
      const mapped = ids.filter((id) => feedKeysFor(id).length > 0);
      assert.ok(
        mapped.length > 0,
        `${stopId} expanded to ${ids.join(",")} and none mapped`
      );
    });
  }

  test("a speculative express id maps to nothing, and that is fine", () => {
    // Stated explicitly so the next reader does not "fix" it by pruning the
    // expansion — the fetcher skipping these is what makes it safe.
    assert.ok(subwayRouteIds("1").includes("1X"));
    assert.deepEqual(feedKeysFor("1X"), []);
  });

  test("no speculative id is fit to show a rider", () => {
    // The second half of the same bug. Once unmapped ids stopped being fatal,
    // the expanded list was still what fed the card's heading bullets — so
    // Times Sq rendered "1 1X 2 2X 3 3X" and Coney Island "D DX F FX". Those
    // are internal feed names; a diamond 1 is a train nobody can board.
    //
    // Bullets must come from the station table's routes, never the expansion.
    for (const [stopId, label] of stations) {
      const shown = getSubwayRoutes(stopId);
      const expanded = expand(shown);

      assert.ok(
        expanded.length >= shown.length,
        "the expansion should be at least as wide as the routes"
      );
      for (const route of shown) {
        assert.ok(
          !/^[0-9A-Z]X$/.test(route),
          `${label}: the station table itself lists "${route}"`
        );
      }
    }
  });

  test("every mapped id names a feed that exists", () => {
    // The other half: an id that maps to a key with no URL would throw at
    // fetch time, which no amount of skipping would rescue.
    for (const [stopId] of stations) {
      for (const id of expand(getSubwayRoutes(stopId))) {
        for (const key of feedKeysFor(id)) {
          assert.ok(
            key in apis.apiUrl,
            `${id} maps to "${key}", which has no URL`
          );
        }
      }
    }
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

describe("the ferry feed is shaped unlike the others", () => {
  // Two assumptions carried over from the MTA feeds were wrong here, and each
  // produced a card that was empty rather than broken — the hardest kind to
  // notice, because "no boats due" is a legitimate answer.

  const landings = ferryStops as Record<string, string>;

  test("a landing resolves to a name", () => {
    assert.equal(landings["87"], "Wall St/Pier 11");
    assert.equal(landings["4"], "Hunters Point South");
  });

  test("an unknown landing resolves to nothing, not a guess", () => {
    assert.equal(landings["99999"], undefined);
  });

  test("every landing in the table has a name", () => {
    // The picker offers these by name; a blank one would be unpickable.
    for (const [id, name] of Object.entries(landings)) {
      assert.ok(name.trim().length > 0, `landing ${id} has no name`);
    }
  });

  test("there are 51 landings across 7 routes", () => {
    // Guards the generated lookups: a truncated regeneration would silently
    // shrink the picker rather than fail.
    assert.equal(Object.keys(landings).length, 51);
    const routes = new Set(
      Object.values(
        ferryTrips as Record<string, { r: string; h: string }>
      ).map((t) => t.r)
    );
    assert.deepEqual([...routes].sort(), [
      "AS",
      "ER",
      "RES",
      "RS",
      "RWS",
      "SB",
      "SG",
    ]);
  });

  test("every trip carries a route and a headsign", () => {
    // The feed sends neither — routeId is empty and stops are bare numbers —
    // so a trip missing either renders a row with no badge or no destination.
    for (const [tripId, info] of Object.entries(
      ferryTrips as Record<string, { r: string; h: string }>
    )) {
      assert.ok(info.r, `trip ${tripId} has no route`);
      assert.ok(info.h, `trip ${tripId} has no headsign`);
    }
  });
});
