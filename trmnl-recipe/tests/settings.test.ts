/**
 * Parsing a board out of a polling request.
 *
 * These are the cases a user can actually reach through the TRMNL form, plus
 * the ones a malformed Liquid template can produce. The rule throughout is
 * that a bad slot costs its own card and nothing else — an unattended panel
 * showing five good cards beside one gap beats a panel showing nothing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseBoardSettings } from "../src/settings.ts";

/** Build the URL TRMNL's polling template would produce. */
const board = (query: string) =>
  parseBoardSettings(new URL(`https://example.test/api/board?${query}`));

describe("slot parsing", () => {
  test("reads type, stop IDs, walk time and title", () => {
    const { cards } = board("c1=subway:721:10:Home");
    assert.equal(cards.length, 1);
    assert.deepEqual(cards[0], {
      slot: 1,
      transitType: "subway",
      stopIds: ["721"],
      walkTime: 10,
      title: "Home",
    });
  });

  test("a station spanning several IDs keeps all of them", () => {
    // Times Square is five platform groups under one complex. The picker
    // offers it as one choice and joins the IDs with "+"; dropping any of
    // them silently hides whole lines from the card.
    const { cards } = board("c1=subway:127+725+902+A27+R16:5");
    assert.deepEqual(cards[0].stopIds, ["127", "725", "902", "A27", "R16"]);
  });

  test("a bus corner keeps both direction IDs", () => {
    // A bus stop ID is one side of the street. Both are needed or the card
    // shows one direction and looks like the other has no service.
    const { cards } = board("c1=bus:505507+505513:3");
    assert.deepEqual(cards[0].stopIds, ["505507", "505513"]);
  });

  test("the picker's '@name' suffix becomes the card title", () => {
    // staticData/bus/route_info.json holds one hand-added stop, so a
    // user-picked stop would otherwise head its card "Bus Stop <id>". The
    // picker already knows the name, so it travels with the ID.
    const { cards } = board("c1=bus:505507+505513@BORDEN AV/5 ST:3");
    assert.equal(cards[0].title, "BORDEN AV/5 ST");
    assert.deepEqual(cards[0].stopIds, ["505507", "505513"]);
  });

  test("an explicit title beats the picker's name", () => {
    const { cards } = board("c1=bus:505507@BORDEN AV/5 ST:3:My stop");
    assert.equal(cards[0].title, "My stop");
  });

  test("a title containing a colon survives", () => {
    const { cards } = board("c1=subway:721:10:Home: the 7");
    assert.equal(cards[0].title, "Home: the 7");
  });
});

describe("transit type aliases", () => {
  // The form shows friendly names; stored settings must not depend on the
  // internal spelling of the union.
  const cases: [string, string][] = [
    ["subway", "subway"],
    ["lirr", "railroad-lirr"],
    ["railroad-lirr", "railroad-lirr"],
    ["mtn", "railroad-mtn"],
    ["metro-north", "railroad-mtn"],
    ["Metro-North", "railroad-mtn"],
    ["BUS", "bus"],
  ];

  for (const [input, expected] of cases) {
    test(`"${input}" maps to ${expected}`, () => {
      const { cards } = board(`c1=${input}:123:5`);
      assert.equal(cards[0]?.transitType, expected);
    });
  }
});

describe("the doubled type prefix", () => {
  test("parses when the polling URL writes the type twice", () => {
    // The picker stores "subway:721"; a template that also writes
    // {{ cardN_type }} produces "subway:subway:721:10" and shifts every
    // field along one, so stop IDs would parse as the walk time.
    const { cards } = board("c1=subway:subway:721:10");
    assert.deepEqual(cards[0].stopIds, ["721"]);
    assert.equal(cards[0].walkTime, 10);
  });

  test("a type-like station name is not mistaken for a doubled prefix", () => {
    // Only drops the first segment when *both* leading segments parse as
    // transit types.
    const { cards } = board("c1=bus:505506:3");
    assert.deepEqual(cards[0].stopIds, ["505506"]);
  });
});

describe("a bad slot costs only itself", () => {
  const skipped: [string, string][] = [
    ["c1=", "empty value"],
    ["c1=::", "empty everything"],
    ["c1=off:::", "the form's Off value"],
    ["c1=none:721:5", "an unknown type"],
    ["c1=subway:", "a type with no stop ID"],
    ["c1=:721:10", "a stop ID with no type"],
    ["c1=garbage", "unparseable"],
  ];

  for (const [query, label] of skipped) {
    test(`${label} is dropped`, () => {
      // Paired with a good slot, so the test proves isolation rather than
      // just that nothing parsed.
      const { cards } = board(`${query}&c2=subway:721:10`);
      assert.equal(cards.length, 1);
      assert.equal(cards[0].slot, 2);
    });
  }

  test("slots outside 1..6 are ignored", () => {
    const { cards } = board("c7=subway:721:10&c0=subway:G24:5");
    assert.equal(cards.length, 3, "falls back to the demo board");
  });
});

describe("walk time", () => {
  const cases: [string, number, string][] = [
    ["10", 10, "a normal value"],
    ["0", 0, "zero, meaning you are at the stop"],
    ["", 5, "blank falls back to the default"],
    ["abc", 5, "garbage falls back"],
    ["-5", 5, "negative falls back"],
  ];

  for (const [input, expected, label] of cases) {
    test(`${label}: "${input}" -> ${expected}`, () => {
      const { cards } = board(`c1=subway:721:${input}`);
      assert.equal(cards[0].walkTime, expected);
    });
  }

  test("an absurd walk time is honoured, not clamped", () => {
    // The board then shows nothing reachable, which is the honest answer —
    // the app does not second-guess a user who says the stop is far away.
    const { cards } = board("c1=subway:721:99999");
    assert.equal(cards[0].walkTime, 99999);
  });
});

describe("display settings", () => {
  test("defaults", () => {
    const s = board("c1=subway:721:10");
    assert.equal(s.use24HourTime, true);
    assert.equal(s.urgentThresholdMinutes, 10);
    assert.equal(s.showLeaveIn, false);
  });

  test("booleans accept the shapes a Liquid template emits", () => {
    for (const truthy of ["true", "1", "yes", "TRUE"]) {
      assert.equal(board(`c1=subway:721:5&leavein=${truthy}`).showLeaveIn, true);
    }
    for (const falsy of ["false", "0", "no", ""]) {
      assert.equal(board(`c1=subway:721:5&h24=${falsy}`).use24HourTime, false || falsy === "");
    }
  });
});

describe("the demo board", () => {
  test("stands in when nothing is configured", () => {
    const s = board("h24=true");
    assert.equal(s.isDemo, true);
    assert.equal(s.cards.length, 3);
  });

  test("covers subway and both railroads", () => {
    // The preview should exercise every feed family the plugin can reach,
    // so a broken one shows up in the directory listing rather than after
    // a user configures it.
    const types = board("").cards.map((c) => c.transitType);
    assert.deepEqual([...types].sort(), [
      "railroad-lirr",
      "railroad-mtn",
      "subway",
    ]);
  });

  test("uses stations nobody lives at", () => {
    // The public recipe page renders a preview from the author's own
    // instance, so the demo must not be the author's commute.
    const names = board("").cards.map((c) => c.title);
    assert.deepEqual(names, ["Times Sq-42 St", "Penn Station", "Grand Central"]);
  });

  test("one configured card is enough to suppress it", () => {
    const s = board("c1=subway:721:10");
    assert.equal(s.isDemo, false);
    assert.equal(s.cards.length, 1);
  });
});
