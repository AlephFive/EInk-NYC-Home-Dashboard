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

describe("a multi-ID station survives URL encoding", () => {
  // `c1` is written into the polling URL *raw* — unlike `n1`, which is
  // url_encode'd — so the station value is exposed to whatever TRMNL does
  // with it. A query string decodes a literal "+" as a space, so
  // "127+725" can arrive either way and both must mean two stops. Getting
  // this wrong collapses a five-platform complex into one unusable id,
  // silently.
  //
  // This had no test until an audit of the string handling went looking
  // for it, which is how defensive code rots.
  test("plus-joined IDs", () => {
    assert.deepEqual(board("c1=subway:127+725").cards[0].stopIds, ["127", "725"]);
  });

  test("the same value with the plus decoded to a space", () => {
    assert.deepEqual(
      board("c1=subway:127%20725").cards[0].stopIds,
      ["127", "725"]
    );
  });

  test("a percent-encoded value parses identically", () => {
    // If `c1` ever gains `| url_encode`, this is the shape it would send.
    assert.deepEqual(
      board("c1=subway%3A127%2B725%21A%2CC").cards[0].stopIds,
      ["127", "725"]
    );
    assert.deepEqual(
      board("c1=subway%3A127%2B725%21A%2CC").cards[0].routes,
      ["A", "C"]
    );
  });
});

describe("a stored value that is really a dropdown label", () => {
  // TRMNL is supposed to store the `id` from {id, name} and show the
  // `name`. Sometimes the label lands in storage instead: the field reads
  // correctly in the form while the Worker gets
  // "116 St-Columbia University (1) · Subway", which parses to nothing.
  // Every card dropping is what puts the demo board on a panel whose
  // settings all look right — unfalsifiable from the user's side, since
  // they are looking at the name they picked.
  test("a subway label resolves to its stop", () => {
    const { cards } = board(
      `c1=${encodeURIComponent("116 St-Columbia University (1) · Subway")}&w1=5`
    );
    assert.deepEqual(cards[0].stopIds, ["117"]);
    assert.equal(cards[0].transitType, "subway");
  });

  test("it parses to the same card as the id would", () => {
    const viaLabel = board(
      `c1=${encodeURIComponent("116 St-Columbia University (1) · Subway")}&w1=5`
    ).cards[0];
    const viaId = board("c1=subway:117&w1=5").cards[0];
    assert.deepEqual(viaLabel, viaId);
  });

  test("ferry and railroad labels resolve too", () => {
    assert.deepEqual(
      board(`c1=${encodeURIComponent("Wall St/Pier 11 · Ferry")}&w1=5`)
        .cards[0].stopIds,
      ["87"]
    );
    assert.equal(
      board(`c1=${encodeURIComponent("Grand Central · Metro-North")}&w1=5`)
        .cards[0].transitType,
      "railroad-mtn"
    );
  });

  test("a name that matches nothing is still refused", () => {
    // The recovery must not become a second, looser parser.
    const { cards } = board(
      `c1=${encodeURIComponent("Nonsense Station · Subway")}&c2=subway:721&w2=5`
    );
    assert.deepEqual(
      cards.map((card) => card.slot),
      [2]
    );
  });
});

describe("the route filter", () => {
  const ROUTES = ["A", "C", "E"];

  test("is split off the station value", () => {
    const { cards } = board("c1=subway:127+725!A,C,E&w1=5");
    assert.deepEqual(cards[0].routes, ROUTES);
    assert.deepEqual(cards[0].stopIds, ["127", "725"]);
  });

  test("a packed tail hiding behind the filter is refused", () => {
    // The two-segment check only sees the part in front of the "!", so a
    // tail after it slipped through and was read as part of a route name:
    // "subway:127+725!A,C,E:5:" rendered a badge saying "ACE:5:". A route
    // never contains a colon, so one there means a legacy value.
    const { cards } = board(
      `c1=${encodeURIComponent("subway:127+725!A,C,E:5:")}&c2=subway:721&w2=5`
    );
    assert.deepEqual(
      cards.map((card) => card.slot),
      [2]
    );
  });

  test("survives url encoding, separator included", () => {
    // The template writes the "!" as a literal %21 so it stays a
    // separator rather than being encoded as part of the value.
    const { cards } = board("c1=subway%3A127%2B725%21A%2CC%2CE&w1=5");
    assert.deepEqual(cards[0].routes, ROUTES);
    assert.deepEqual(cards[0].stopIds, ["127", "725"]);
  });
});


describe("each card field has its own parameter", () => {
  // The fields were packed into one parameter as `station:walk:title`, and
  // the title — free text, last in line — could not be told from the
  // separators around it. Separate parameters make the question not arise:
  // the URL encoder does the escaping.
  test("a title full of separators survives intact", () => {
    // Impossible under the packed format: every one of these characters was
    // either a separator or ambiguous with one.
    for (const title of ["A: B & C/D", "Track 5: Downtown", "7th & 9th", "a:b:c"]) {
      const { cards } = board(
        `c1=subway:721&w1=5&n1=${encodeURIComponent(title)}`
      );
      assert.equal(cards[0].title, title, `"${title}" did not survive`);
    }
  });

  test("walk time comes from its own parameter", () => {
    assert.equal(board("c1=subway:721&w1=12").cards[0].walkTime, 12);
  });

  test("a packed value no longer parses", () => {
    // The compatibility shim is gone. A value predating the split is not
    // repairable into the new shape, only tolerated, and tolerating it is
    // what kept four parsing bugs alive. It now fails cleanly: the slot is
    // skipped rather than producing a card built on guesses.
    const { cards } = board(
      `c1=${encodeURIComponent("subway:721:12:My stop")}&c2=subway:127&w2=5`
    );
    assert.deepEqual(
      cards.map((card) => card.slot),
      [2]
    );
  });
});

describe("the visibility toggle", () => {
  // Decided here, not in the polling template. Liquid treats the string
  // "false" as truthy, so a `{% if cardN_visible %}` guard hid nothing and
  // the toggle appeared dead. What TRMNL stores for an unticked box is
  // undocumented, so every plausible spelling is accepted.
  test("an off card is dropped whatever the spelling", () => {
    // A second card keeps the board configured, so the hidden slot's
    // absence is visible — with only one card the board empties and the
    // demo takes over, which is tested separately below.
    for (const off of ["false", "FALSE", "0", "no", "off", " false "]) {
      const { cards } = board(
        `c1=subway:721&w1=10&v1=${off}&c2=railroad-lirr:102&w2=10`
      );
      assert.deepEqual(
        cards.map((card) => card.slot),
        [2],
        `v1=${off} did not hide the card`
      );
    }
  });

  test("an on card is kept whatever the spelling", () => {
    for (const on of ["true", "TRUE", "1", "yes"]) {
      const { cards } = board(`c1=subway:721&w1=10&v1=${on}`);
      assert.equal(cards[0]?.stopIds[0], "721", `v1=${on} hid the card`);
    }
  });

  test("an unrecognised value shows the card", () => {
    // Fail visible, not hidden. We do not know which representation TRMNL
    // sends, so anything unexpected is likelier a spelling we have not seen
    // than a request to hide — and silently dropping a card the user
    // configured is the worse of the two mistakes.
    assert.equal(board("c1=subway:721&w1=10&v1=maybe").cards.length, 1);
  });

  test("a missing or empty toggle shows the card", () => {
    // Older polling URLs send no vN at all, and TRMNL may write an empty
    // value. Neither should blank a board that was working.
    assert.equal(board("c1=subway:721&w1=10").cards.length, 1);
    assert.equal(board("c1=subway:721&w1=10&v1=").cards.length, 1);
  });

  test("hiding one card leaves the others alone", () => {
    const { cards } = board(
      "c1=subway:721&w1=10&v1=false&c2=railroad-lirr:102&w2=10&v2=true"
    );
    assert.deepEqual(
      cards.map((card) => card.slot),
      [2]
    );
  });

  test("hiding every configured card shows them anyway", () => {
    // TRMNL sends an explicit `false` for a checkbox the user has never
    // touched, whatever the field's declared default — so adding the
    // toggles silently hid every card on every existing install, and the
    // panel fell back to the demo board. A user who had picked their
    // stations saw Times Square with no way to tell why.
    //
    // Hiding some cards is a real choice and is honoured. Hiding all of
    // them cannot be told apart from the untouched state, and showing the
    // stations the user actually picked is the better of the two guesses.
    const { cards, isDemo } = board("c1=subway:721&w1=10&v1=false");
    assert.equal(isDemo, false);
    assert.deepEqual(
      cards.map((card) => card.slot),
      [1]
    );
  });

  test("an empty board still demonstrates itself", () => {
    // The fallback is for a board with nothing configured at all, which is
    // a different thing from one whose cards are merely hidden.
    assert.equal(board("c1=&c2=").isDemo, true);
  });
});

describe("slot parsing", () => {
  test("reads type, stop IDs, walk time and title", () => {
    const { cards } = board("c1=subway:721&w1=10&n1=Home");
    assert.equal(cards.length, 1);
    assert.deepEqual(cards[0], {
      slot: 1,
      transitType: "subway",
      stopIds: ["721"],
      walkTime: 10,
      title: "Home",
      // Absent unless the card narrows itself to particular lines.
      routes: undefined,
      // Absent unless the card is narrowed to one direction.
      direction: undefined,
    });
  });

  test("a station spanning several IDs keeps all of them", () => {
    // Times Square is five platform groups under one complex. The picker
    // offers it as one choice and joins the IDs with "+"; dropping any of
    // them silently hides whole lines from the card.
    const { cards } = board("c1=subway:127+725+902+A27+R16&w1=5");
    assert.deepEqual(cards[0].stopIds, ["127", "725", "902", "A27", "R16"]);
  });

  test("a bus corner keeps both direction IDs", () => {
    // A bus stop ID is one side of the street. Both are needed or the card
    // shows one direction and looks like the other has no service.
    const { cards } = board("c1=bus:505507+505513&w1=3");
    assert.deepEqual(cards[0].stopIds, ["505507", "505513"]);
  });

  test("a title comes from its own parameter", () => {
    const { cards } = board("c1=bus:505507+505513&w1=3&n1=My stop");
    assert.equal(cards[0].title, "My stop");
    assert.deepEqual(cards[0].stopIds, ["505507", "505513"]);
  });

  test("a title containing a colon survives", () => {
    // Trivially now that it has its own parameter; this was the case the
    // packed format could not express at all.
    const { cards } = board("c1=subway:721&w1=10&n1=Home: the 7");
    assert.equal(cards[0].title, "Home: the 7");
  });
});

describe("narrowing a card to some routes", () => {
  // The filter is not subway-only. It was, silently: routeFilterFor ran
  // inside subwayCard and nowhere else, so a railroad, bus or ferry card
  // accepted the field and ignored it — a user asking for the Babylon
  // branch got all nine, with nothing to say the request had been dropped.
  test("every transit type accepts a route filter", () => {
    // The expected routes are spelled out, not counted. An earlier version
    // asserted only `routes.length > 0`, which is satisfied by the wrong
    // answer: when a packed tail slipped into the list, ["1","2","3:5"]
    // passed and the bug shipped. A count says the field was read; the
    // values say it was read correctly.
    const cases: [string, string, string[]][] = [
      ["subway:127!1,2,3", "subway", ["1", "2", "3"]],
      ["lirr:102!Babylon", "railroad-lirr", ["BABYLON"]],
      ["mtn:1!Hudson", "railroad-mtn", ["HUDSON"]],
      ["bus:403257!M42", "bus", ["M42"]],
      ["ferry:87!ER", "ferry", ["ER"]],
    ];

    for (const [slot, type, routes] of cases) {
      const { cards } = board(`c1=${slot}`);
      assert.equal(cards[0]?.transitType, type, slot);
      assert.deepEqual(
        cards[0]?.routes,
        routes,
        `${type} did not read its route filter correctly`
      );
    }
  });

  // A complex puts many lines on one card — Times Square is twelve — so a
  // rider who only takes the 1/2/3 can name them and hide the rest.
  test("reads a comma-separated list", () => {
    const { cards } = board("c1=subway:127%2B725!1,2,3&w1=5");
    assert.deepEqual(cards[0].routes, ["1", "2", "3"]);
    assert.deepEqual(cards[0].stopIds, ["127", "725"]);
  });

  test("is absent when not given", () => {
    const { cards } = board("c1=subway:127&w1=5");
    assert.equal(cards[0].routes, undefined);
  });

  test("is absent when given empty", () => {
    // The Liquid guard should omit it entirely, but a blank must not become
    // a filter that matches nothing and empties the card.
    const { cards } = board("c1=subway:127!&w1=5");
    assert.equal(cards[0].routes, undefined);
  });

  test("normalises case and spacing", () => {
    const { cards } = board("c1=subway:127!a, c , e&w1=5");
    assert.deepEqual(cards[0].routes, ["A", "C", "E"]);
  });

  test("a filter on a bus stop with punctuation in its ID list", () => {
    // The filter is split off the whole value before the ":" parse, so a
    // route list is never confused with part of the IDs.
    const { cards } = board("c1=bus:505507+505513!Q101&w1=3");
    assert.deepEqual(cards[0].routes, ["Q101"]);
    assert.deepEqual(cards[0].stopIds, ["505507", "505513"]);
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
      const { cards } = board(`c1=${input}:123&w1=5`);
      assert.equal(cards[0]?.transitType, expected);
    });
  }
});

describe("a station value must be exactly type and IDs", () => {
  // The parser used to read looser shapes, for values stored before each
  // card field got its own query parameter: a packed ":<walk>:<title>"
  // tail, an "@name" beside the IDs, a doubled "subway:subway:" prefix.
  //
  // Dropping the extra segments quietly would be worse than refusing them.
  // The card renders, looks configured, and is built on whatever survived
  // the guess — "subway:subway:127" yields a stop ID of "subway", which
  // resolves to nothing and shows an empty card with no clue why.
  for (const value of [
    "subway:721:12:My stop",
    "subway:subway:127",
    "bus:505507@BORDEN AV/5 ST",
  ]) {
    test(`"${value}" is refused`, () => {
      // Paired with a good slot, so the board stays configured and the
      // refusal is visible as an absence. Alone it would fall through to
      // the demo board, which is a different behaviour being tested.
      const { cards } = board(
        `c1=${encodeURIComponent(value)}&c2=subway:721&w2=5`
      );
      assert.deepEqual(
        cards.map((card) => card.slot),
        [2]
      );
    });
  }

  test("a well-formed value parses", () => {
    const { cards } = board("c1=subway:127+725&w1=5");
    assert.deepEqual(cards[0].stopIds, ["127", "725"]);
  });
});

describe("a bad slot costs only itself", () => {
  const skipped: [string, string][] = [
    ["c1=", "empty value"],
    ["c1=::", "empty everything"],
    ["c1=off:::", "the form's Off value"],
    ["c1=none:721&w1=5", "an unknown type"],
    ["c1=subway:", "a type with no stop ID"],
    ["c1=:721&w1=10", "a stop ID with no type"],
    ["c1=garbage", "unparseable"],
  ];

  for (const [query, label] of skipped) {
    test(`${label} is dropped`, () => {
      // Paired with a good slot, so the test proves isolation rather than
      // just that nothing parsed.
      const { cards } = board(`${query}&c2=subway:721&w2=10`);
      assert.equal(cards.length, 1);
      assert.equal(cards[0].slot, 2);
    });
  }

  test("slots outside 1..6 are ignored", () => {
    const { cards } = board("c7=subway:721&w7=10&c0=subway:G24&w0=5");
    assert.equal(cards.length, 6, "falls back to the demo board");
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
      const { cards } = board(`c1=subway:721&w1=${input}`);
      assert.equal(cards[0].walkTime, expected);
    });
  }

  test("an absurd walk time is honoured, not clamped", () => {
    // The board then shows nothing reachable, which is the honest answer —
    // the app does not second-guess a user who says the stop is far away.
    const { cards } = board("c1=subway:721&w1=99999");
    assert.equal(cards[0].walkTime, 99999);
  });
});

describe("destination text size", () => {
  const scale = (q: string) =>
    parseBoardSettings(new URL(`https://example.test/api/board?${q}`))
      .destinationScale;

  test("defaults to the row's own size", () => {
    assert.equal(scale(""), 1);
    assert.equal(scale("dscale="), 1);
    assert.equal(scale("dscale=abc"), 1);
  });

  test("the offered sizes pass through", () => {
    for (const v of [0.8, 0.9, 1, 1.1, 1.2]) {
      assert.equal(scale(`dscale=${v}`), v);
    }
  });

  test("anything outside the range is clamped, not refused", () => {
    // A board must render whatever arrives. Below 0.7 the 1-bit panel
    // cannot resolve the glyphs; above 1.3 a destination crowds out the
    // clock it sits beside. Neither is a reason to blank the panel.
    assert.equal(scale("dscale=5"), 1.3);
    assert.equal(scale("dscale=0.1"), 0.7);
    assert.equal(scale("dscale=-2"), 0.7);
  });
});

describe("display settings", () => {
  test("defaults", () => {
    const s = board("c1=subway:721&w1=10");
    assert.equal(s.use24HourTime, true);
    assert.equal(s.urgentThresholdMinutes, 5);
    assert.equal(s.showLeaveIn, false);
  });

  test("booleans accept the shapes a Liquid template emits", () => {
    for (const truthy of ["true", "1", "yes", "TRUE"]) {
      assert.equal(board(`c1=subway:721&w1=5&leavein=${truthy}`).showLeaveIn, true);
    }
    for (const falsy of ["false", "0", "no", ""]) {
      assert.equal(board(`c1=subway:721&w1=5&h24=${falsy}`).use24HourTime, false || falsy === "");
    }
  });
});

describe("the demo board", () => {
  test("stands in when nothing is configured", () => {
    const s = board("h24=true");
    assert.equal(s.isDemo, true);
    assert.equal(s.cards.length, 6, "a full board, so the preview is not half empty");
  });

  test("covers every feed family the plugin can reach", () => {
    // Every upstream, each decoded differently: the subway and railroad
    // protobuf dialects, NYC Ferry's own GTFS-RT, and the bus SIRI API,
    // which is JSON and the only one needing a key. A broken one should
    // show up in the directory listing rather than after a user configures
    // it — which is the whole reason the demo is a full board.
    const types = new Set(board("").cards.map((c) => c.transitType));
    assert.deepEqual(
      [...types].sort(),
      ["bus", "ferry", "railroad-lirr", "railroad-mtn", "subway"]
    );
  });

  test("fills the grid", () => {
    // Every slot occupied, so the preview shows the layout at full density
    // rather than three cards and three gaps.
    const slots = board("").cards.map((c) => c.slot).sort((a, b) => a - b);
    assert.deepEqual(slots, [1, 2, 3, 4, 5, 6]);
  });

  test("shows a bus corner as both directions", () => {
    // A bus stop ID is one side of the street, so a corner needs two. It is
    // the most-missed thing about bus cards, and the demo shows it.
    const bus = board("").cards.find((c) => c.transitType === "bus");
    assert.ok(bus, "no bus card on the demo board");
    assert.equal(bus.stopIds.length, 2, "a corner needs both direction IDs");
  });

  test("the two railroads are shown at comparable stations", () => {
    // Both cards render identically — a branch badge, a destination, a time
    // — so the pair only teaches something if the stations are comparable.
    //
    // Penn Station was the wrong LIRR choice: at a terminal most trains run
    // to their branch's namesake, so badge and destination repeat on 73% of
    // rows ("Ronkonkoma | Ronkonkoma") against 21% at Grand Central, and the
    // card reads as one word printed twice. Jamaica is the hub nearly every
    // LIRR train passes through — 10 branches, 13 destinations, trains in
    // both directions — which is the shape Grand Central has.
    const rail = board("").cards.filter((c) =>
      c.transitType.startsWith("railroad-")
    );
    assert.equal(rail.length, 2, "one card per railroad");
    assert.deepEqual(
      rail.map((c) => c.transitType).sort(),
      ["railroad-lirr", "railroad-mtn"]
    );

    const lirr = rail.find((c) => c.transitType === "railroad-lirr");
    assert.equal(lirr?.stopIds[0], "102", "the LIRR card should be Jamaica");
  });

  test("demonstrates the line filter", () => {
    // Times Square carries twelve routes on one card, and narrowing it is
    // the non-obvious thing a new installer most needs to discover. The
    // demo shows the full complex and a filtered view of it side by side.
    const filtered = board("").cards.filter((c) => c.routes?.length);
    assert.ok(filtered.length > 0, "no card demonstrates the filter");
    assert.deepEqual(filtered[0].routes, ["N", "Q", "R", "W"]);
  });

  test("uses stations nobody lives at", () => {
    // The public recipe page renders a preview from the author's own
    // instance, so the demo must not be the author's commute.
    const names = board("").cards.map((c) => c.title);
    assert.deepEqual(names, [
      "Times Sq-42 St",
      "Custom name",
      "Jamaica",
      "W 42 St/5 Av",
      "Grand Central",
      "Wall St/Pier 11",
    ]);
  });

  test("one configured card is enough to suppress it", () => {
    const s = board("c1=subway:721&w1=10");
    assert.equal(s.isDemo, false);
    assert.equal(s.cards.length, 1);
  });
});
