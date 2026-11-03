/**
 * Reading a board from a JSON polling body.
 *
 * The endpoint accepts this today; the plugin does not send it yet — see
 * `jsonSettings.ts` for why (TRMNL's Liquid has no working JSON escape).
 * The tests exist because the parser is live on POST and because they
 * record what the format buys over the query string.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { boardFromJson } from "../src/jsonSettings.ts";

describe("the station arrives as an object", () => {
  // The template splits `type:ids` and sends both named, so the Worker
  // reads two fields rather than inferring them from where separators
  // fall in a string. Every parsing bug this project hit was that
  // inference going wrong.
  test("type and ids are read from their own keys", () => {
    const { cards } = boardFromJson({
      cards: [{ station: { type: "subway", ids: ["127", "725"] } }],
    });
    assert.equal(cards[0].transitType, "subway");
    assert.deepEqual(cards[0].stopIds, ["127", "725"]);
  });

  test("a single id needs no array gymnastics", () => {
    const { cards } = boardFromJson({
      cards: [{ station: { type: "ferry", ids: ["87"] } }],
    });
    assert.deepEqual(cards[0].stopIds, ["87"]);
  });

  test("an aliased type still resolves", () => {
    for (const [type, expected] of [
      ["mtn", "railroad-mtn"],
      ["lirr", "railroad-lirr"],
      ["Metro-North", "railroad-mtn"],
    ] as [string, string][]) {
      const { cards } = boardFromJson({
        cards: [{ station: { type, ids: ["1"] } }],
      });
      assert.equal(cards[0]?.transitType, expected, type);
    }
  });

  test("a value a station name could never survive as a string", () => {
    // The object form's whole point: these characters are data, not
    // syntax. As a string every one of them was a separator.
    const { cards } = boardFromJson({
      cards: [
        {
          station: { type: "subway", ids: ["117"] },
          title: 'A: B @ C · D "quoted" :5:',
        },
      ],
    });
    assert.deepEqual(cards[0].stopIds, ["117"]);
    assert.equal(cards[0].title, 'A: B @ C · D "quoted" :5:');
  });

  test("a malformed station drops its own card and no other", () => {
    const { cards } = boardFromJson({
      cards: [
        { station: { type: "monorail", ids: ["1"] } },
        { station: { type: "subway", ids: [] } },
        { station: { type: "subway", ids: ["117"] } },
      ],
    });
    assert.deepEqual(
      cards.map((card) => card.slot),
      [3]
    );
  });

  test("a string station still parses, for a body not yet re-saved", () => {
    // Including TRMNL's `id::label` storage and the oldest label-only
    // values, which resolve against the bundled tables.
    for (const [station, ids] of [
      ["subway:117", ["117"]],
      ["subway:117::116 St-Columbia University (1) · Subway", ["117"]],
      ["116 St-Columbia University (1) · Subway", ["117"]],
    ] as [string, string[]][]) {
      const { cards } = boardFromJson({ cards: [{ station }] });
      assert.deepEqual(cards[0]?.stopIds, ids, station);
    }
  });
});

describe("a card from a JSON body", () => {
  test("station, walk, title and routes each come from their own key", () => {
    const { cards } = boardFromJson({
      cards: [
        { station: "subway:127+725", routes: "A,C,E", walk: 9, title: "Home" },
      ],
    });
    assert.deepEqual(cards[0].stopIds, ["127", "725"]);
    assert.deepEqual(cards[0].routes, ["A", "C", "E"]);
    assert.equal(cards[0].walkTime, 9);
    assert.equal(cards[0].title, "Home");
  });

  test("a title can contain every separator the flat format used", () => {
    // The point of the format. In the query string each of these broke
    // something: ":" split the fields, "@" was a smuggled name, "·"
    // ended a dropdown label, and ":5:" was a packed tail.
    const title = 'A: B & C/D @ x · y:5:';
    const { cards } = boardFromJson({
      cards: [{ station: "subway:117", title }],
    });
    assert.equal(cards[0].title, title);
  });

  test("a slot keeps its position even when an earlier one is empty", () => {
    const { cards } = boardFromJson({
      cards: [{}, { station: "subway:117" }],
    });
    assert.deepEqual(
      cards.map((card) => card.slot),
      [2]
    );
  });

  test("TRMNL's `id::label` storage keeps only the id", () => {
    // What the form actually sends. An xhrSelectSearch value is stored as
    // the id, two colons, then the label the dropdown showed — so a card
    // arrives as "subway:117::116 St-Columbia University (1) · Subway".
    //
    // Splitting on the first colon put the whole label inside the stop ID
    // list, the card resolved to nothing, and a fully configured board
    // fell back to the demo. Captured from a real request.
    const sent = [
      ["subway:117::116 St-Columbia University (1) · Subway", "subway", ["117"]],
      [
        "subway:127+725+902+A27+R16::Times Sq-42 St (1/2/3/7/S/N/Q/R/W/A/C/E) · Subway",
        "subway",
        ["127", "725", "902", "A27", "R16"],
      ],
      ["bus:505506::CENTER BLVD/BORDEN AV (Q101/Q103) · Bus", "bus", ["505506"]],
      ["mtn:4::Harlem-125 St · Metro-North", "railroad-mtn", ["4"]],
      ["lirr:349::Grand Central · LIRR", "railroad-lirr", ["349"]],
      ["ferry:4::Hunters Point South · Ferry", "ferry", ["4"]],
    ] as [string, string, string[]][];

    for (const [station, type, ids] of sent) {
      const { cards } = boardFromJson({ cards: [{ station }] });
      assert.equal(cards[0]?.transitType, type, station);
      assert.deepEqual(cards[0]?.stopIds, ids, station);
    }
  });

  test("the whole board the form sends parses", () => {
    // Six cards, every network. The failure was not one bad value — it
    // was every card but one, which is what made it look like the board
    // had reverted to the demo.
    const { cards, isDemo } = boardFromJson({
      cards: [
        { station: "subway:117::116 St-Columbia University (1) · Subway" },
        { station: "subway:127+725::Times Sq-42 St · Subway", routes: "7" },
        { station: "bus:505506::CENTER BLVD/BORDEN AV · Bus" },
        { station: "mtn:4::Harlem-125 St · Metro-North" },
        { station: "lirr:349::Grand Central · LIRR" },
        { station: "ferry:4::Hunters Point South · Ferry" },
      ],
    });
    assert.equal(isDemo, false);
    assert.equal(cards.length, 6);
    assert.deepEqual(cards[1].routes, ["7"]);
  });

  test("a stored dropdown label is recovered", () => {
    // JSON does not help here — it is the wrong *value*, not a parsing
    // ambiguity — so the same recovery runs as on the query string.
    const { cards } = boardFromJson({
      cards: [{ station: "116 St-Columbia University (1) · Subway" }],
    });
    assert.deepEqual(cards[0].stopIds, ["117"]);
  });
});

describe("values arrive as whatever Liquid rendered", () => {
  test("a boolean may be real or a string", () => {
    for (const value of [false, "false", "no", "0", "off"]) {
      const { cards } = boardFromJson({
        cards: [{ station: "subway:117", visible: value }, { station: "subway:721" }],
      });
      assert.deepEqual(
        cards.map((card) => card.slot),
        [2],
        `visible=${JSON.stringify(value)} did not hide the card`
      );
    }
  });

  test("a number may be real or a string", () => {
    assert.equal(
      boardFromJson({ cards: [{ station: "subway:117", walk: "12" }] })
        .cards[0].walkTime,
      12
    );
    assert.equal(
      boardFromJson({ cards: [{ station: "subway:117", walk: 12 }] })
        .cards[0].walkTime,
      12
    );
  });

  test("an absent field takes the default", () => {
    const board = boardFromJson({ cards: [{ station: "subway:117" }] });
    assert.equal(board.cards[0].walkTime, 5);
    assert.equal(board.urgentThresholdMinutes, 5);
    assert.equal(board.use24HourTime, true);
    assert.equal(board.destinationScale, 1);
  });

  test("the destination scale is clamped, by the same rule as the query string", () => {
    assert.equal(boardFromJson({ destinationScale: 5 }).destinationScale, 1.3);
    assert.equal(boardFromJson({ destinationScale: 0.1 }).destinationScale, 0.7);
  });
});

describe("a body that makes no sense still renders a board", () => {
  // An unattended panel must show something. Every one of these yields the
  // demo board rather than an error.
  for (const [label, body] of [
    ["empty object", {}],
    ["no cards key", { urgent: 5 }],
    ["cards is not an array", { cards: "nope" }],
    ["cards are not objects", { cards: [null, 7, "x"] }],
    ["station names no type", { cards: [{ station: "117" }] }],
    ["station is unknown", { cards: [{ station: "monorail:1" }] }],
  ] as [string, unknown][]) {
    test(label, () => {
      const board = boardFromJson(body);
      assert.equal(board.isDemo, true);
      assert.ok(board.cards.length > 0);
    });
  }

  test("more than six cards are ignored past the sixth", () => {
    const cards = Array.from({ length: 9 }, () => ({ station: "subway:117" }));
    assert.equal(boardFromJson({ cards }).cards.length, 6);
  });

  test("every card hidden shows them anyway", () => {
    // Same rule as the query string: TRMNL sends an explicit false for a
    // checkbox never touched, and hiding every card cannot be told apart
    // from the untouched state.
    const board = boardFromJson({
      cards: [{ station: "subway:117", visible: false }],
    });
    assert.equal(board.isDemo, false);
    assert.deepEqual(board.cards[0].stopIds, ["117"]);
  });
});
