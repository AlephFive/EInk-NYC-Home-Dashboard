/**
 * The station pickers — what the form's search offers for each transit type.
 *
 * Grouped here rather than per type because the thing under test is the same
 * throughout: a picker must hand back an ID a card can actually use, and the
 * ways that fails differ by network rather than by code path.
 *
 * Each type has its own trap, and all four have produced a card that looked
 * complete and was not:
 *
 * - **Bus:** a stop ID is one side of the street. The opposite direction is a
 *   different ID with the same name, so a corner needs both.
 * - **Subway:** a complex spans several platform groups, and picking one
 *   silently shows real trains of the wrong line.
 * - **Railroad:** LIRR and Metro-North reuse stop IDs, so the tables must
 *   stay separate.
 * - **Ferry:** a landing is flat — one ID, every route — unlike all three.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { parseBoardSettings } from "../src/settings.ts";
import {
  searchStations,
  searchAllTypes,
  fetchBusStopNames,
} from "../src/pickers.ts";

const board = (query: string) =>
  parseBoardSettings(new URL(`https://example.test/api/board?${query}`));

describe("a stop ID is one direction", () => {
  test("a card with one ID gets one column", () => {
    const { cards } = board("c1=bus:505507&w1=3");
    assert.deepEqual(cards[0].stopIds, ["505507"]);
  });

  test("a corner needs both IDs to show both directions", () => {
    // 505507 and 505513 are the two sides of Borden Av / 5 St. The card
    // renders one column per ID, so a user who picks only one sees
    // departures in a single direction with no hint that the other exists.
    const { cards } = board("c1=bus:505507%2B505513&w1=3");
    assert.equal(cards[0].stopIds.length, 2);
  });
});

describe("the picker offers a corner as one choice", { concurrency: 1 }, () => {
  // The only tests here that leave the machine. The bus picker queries NY
  // Open Data live, because the dataset is the authority on which stop IDs
  // are still valid and a fixture would freeze that answer — the `valid_to`
  // filter is the single most consequential thing in the picker, and the
  // whole point is that the MTA changes it without telling us.
  //
  // They **skip** rather than fail when the portal is unreachable. A CI run
  // should not go red because a third party is slow, and a skipped test is
  // visible in the output where a silently-passing one would not be.

  /** Whether the portal answered, checked once for the whole block. */
  let portalReachable = true;

  before(async () => {
    try {
      const probe = await searchStations("bus", "borden av/5");
      portalReachable = probe.length > 0;
    } catch {
      portalReachable = false;
    }
  });

  /** Skip the rest of a test when the portal is down. */
  const needsPortal = (t: { skip: (reason?: string) => void }): boolean => {
    if (!portalReachable) {
      t.skip("NY Open Data unreachable");
      return true;
    }
    return false;
  };

  test("groups both sides of a corner under one option", async (t) => {
    if (needsPortal(t)) return;
    const options = await searchStations("bus", "borden av/5");
    assert.ok(options.length > 0, "no options for a known corner");

    const [label, value] = Object.entries(options[0])[0];
    assert.match(label, /BORDEN AV\/5 ST/);

    const ids = value.replace(/^bus:/, "").split("@")[0].split("+");
    assert.equal(ids.length, 2, `expected both sides, got ${ids.join(",")}`);
  });

  test("stores IDs only, never the stop name", async (t) => {
    if (needsPortal(t)) return;
    // The name used to travel with the ID as "@<name>", which put free text
    // in a positional, colon-delimited value — so every delimiter a stop
    // name can contain became a parsing hazard. The board builder asks the
    // dataset for the name instead; see fetchBusStopNames.
    const options = await searchStations("bus", "borden av/5");
    const value = Object.values(options[0])[0];
    assert.match(value, /^bus:[\d+]+$/, `value carries more than IDs: ${value}`);
  });

  test("excludes retired stop IDs", async (t) => {
    if (needsPortal(t)) return;
    // 700748 was this board's own bus stop until the MTA re-IDed it to
    // 505506 — same corner, cross-streets swapped. The retired ID is still
    // in the published dataset with a past valid_to, and still returns a
    // SIRI error, so offering it would hand a user a permanently dead card.
    const options = await searchStations("bus", "borden");
    const ids = options.flatMap((o) =>
      Object.values(o)[0].replace(/^bus:/, "").split("@")[0].split("+")
    );
    assert.ok(!ids.includes("700748"), "a retired stop ID was offered");
  });

  test("a one-character query returns nothing", async () => {
    // The portal is remote; an unbounded query would fetch all of New York.
    assert.deepEqual(await searchStations("bus", "b"), []);
  });
});

describe("the dropdown's label and value are separate", () => {
  // `xhrSelectSearch` returns `{id, name}`: `id` is stored in settings,
  // `name` is shown in the dropdown — the same split a `remote:` block
  // spells out as `value_field` and `label_field`.
  //
  // Worth asserting because getting it backwards is silent and expensive.
  // Folding the label into the value made every heading read
  // "Times Sq-42 St (1/2/3/7/S/N/Q/R/W/A/C/E)"; folding the value into the
  // label would store something the board cannot parse at all.

  test("the value is an opaque id, not a display name", async () => {
    const options = await searchAllTypes("harlem");
    for (const option of options) {
      const [value] = Object.values(option);
      assert.match(
        value,
        /^(subway|lirr|mtn|bus|ferry):/,
        "a stored value must lead with its transit type"
      );
      assert.ok(
        !value.includes(" · "),
        `the network suffix leaked into a stored value: ${value}`
      );
    }
  });

  test("the label is for reading, the value for parsing", async () => {
    const options = await searchAllTypes("harlem");
    for (const option of options) {
      const [[label, value]] = Object.entries(option);
      assert.notEqual(label, value, "label and value collapsed into one");
      assert.match(label, / · (Subway|LIRR|Metro-North|Bus|Ferry)$/);
    }
  });

  test("a bus value is shaped like every other network's", async () => {
    // Bus used to be the exception, embedding a name after "@". It is not
    // any more: the board builder names a stop from NY Open Data, so the
    // stored value is IDs like the rest.
    const options = await searchAllTypes("borden");
    const bus = options
      .map((o) => Object.values(o)[0])
      .filter((v) => v.startsWith("bus:"));

    assert.ok(bus.length > 0, "no bus stops matched");
    for (const value of bus) {
      assert.match(value, /^bus:[\d+]+$/, `value carries more than IDs: ${value}`);
    }
  });
});

describe("the response shape xhrSelectSearch expects", () => {
  // The two XHR field types disagree, and the mismatch is silent — the
  // request succeeds, the widget cannot read the options, and the dropdown
  // renders empty with no error anywhere:
  //
  //   xhrSelect        [{ "Braves": 123 }]           label -> value
  //   xhrSelectSearch  [{ id, name }]                objects
  //
  // The pickers produce label -> value pairs, which is the natural shape for
  // a lookup; `toSearchOption` in index.ts converts at the boundary. These
  // assert the internal shape the conversion depends on.

  test("a picker option is one label mapped to one value", () => {
    const option = { "Jamaica": "lirr:102" };
    const entries = Object.entries(option);
    assert.equal(entries.length, 1, "an option must hold exactly one pair");
  });

  test("the value carries the transit type and stop IDs", () => {
    // What the conversion puts in `id`, and what the board parses back out.
    for (const value of [
      "subway:127+725+902+A27+R16",
      "lirr:102",
      "bus:505507+505513@BORDEN AV/5 ST",
      "ferry:87",
    ]) {
      assert.match(value, /^(subway|lirr|mtn|bus|ferry):/);
    }
  });
});

describe("searching every type at once", { concurrency: 1 }, () => {
  // What the picker actually calls. A GET carries no sibling settings, so
  // the Worker cannot know which transit type the card was set to — it
  // searches all of them and labels each result instead.

  test("one query reaches several networks", async () => {
    const options = await searchAllTypes("jamaica");
    assert.ok(options.length > 0, "no options for a well-known name");

    const labels = Object.keys(Object.assign({}, ...options));
    const networks = new Set(
      labels.map((l) => l.split(" · ").at(-1)).filter(Boolean)
    );
    assert.ok(
      networks.size > 1,
      `expected several networks, got ${[...networks].join(", ")}`
    );
  });

  test("every label names its network", () => {
    // Why: "Jamaica" is an LIRR station and "Jamaica Center" is on the E.
    // Without the suffix a rider cannot tell which row is which.
    return searchAllTypes("jamaica").then((options) => {
      for (const option of options) {
        const [label] = Object.keys(option);
        assert.match(label, / · (Subway|LIRR|Metro-North|Bus|Ferry)$/);
      }
    });
  });

  test("the value still carries its own type", async () => {
    // The board reads the type from the stored value, not from the card's
    // type field — which is what lets one search serve every network.
    const options = await searchAllTypes("wall st");
    for (const option of options) {
      const [value] = Object.values(option);
      assert.match(value, /^(subway|lirr|mtn|bus|ferry):/);
    }
  });

  test("one character searches the bundled tables only", async () => {
    // The first keystroke should show something rather than an empty list
    // that reads as broken. Subway, railroad and ferry are local lookups
    // and cost nothing; the bus search leaves the machine for NY Open Data
    // and is held back until there are two characters to go on.
    const options = await searchAllTypes("f");
    assert.ok(options.length > 0, "one character returned nothing");

    const labels = Object.keys(Object.assign({}, ...options));
    assert.ok(
      !labels.some((l) => l.endsWith("Bus")),
      "the bus portal was queried on a single character"
    );
  });

  test("an empty query returns nothing", async () => {
    assert.deepEqual(await searchAllTypes("   "), []);
  });
});

describe("station search for the rail types", () => {
  test("a subway complex is one option carrying every platform", async () => {
    const options = await searchStations("subway", "times sq");
    assert.equal(options.length, 1, "Times Square split into several options");

    const ids = Object.values(options[0])[0].replace(/^subway:/, "").split("+");
    assert.equal(ids.length, 5, `expected five platform groups, got ${ids.length}`);
  });

  test("searching a name only one platform carries still finds the complex", async () => {
    // A27 is "42 St-Port Authority Bus Terminal"; the other four are
    // "Times Sq-42 St". A search for either must reach the same complex.
    const options = await searchStations("subway", "port authority");
    assert.ok(options.length > 0, "the complex was not found by its A/C/E name");
  });

  test("LIRR and Metro-North are searched separately", async () => {
    // Both have a Grand Central at different stop IDs, so a merged table
    // would send a card to the wrong railroad's station.
    const lirr = await searchStations("lirr", "grand central");
    const mtn = await searchStations("mtn", "grand central");

    assert.ok(lirr.length > 0 && mtn.length > 0);
    assert.notEqual(Object.values(lirr[0])[0], Object.values(mtn[0])[0]);
  });

  test("ferry landings are searchable", async () => {
    // Live since 2026-10-29, on NYC Ferry's own GTFS-realtime feed. It was
    // omitted while schedule-based, because a printed timetable can only
    // claim a departure rather than observe one.
    const options = await searchStations("ferry", "hunters point");
    assert.equal(options.length, 1);
    assert.deepEqual(options[0], { "Hunters Point South": "ferry:4" });
  });

  test("a ferry landing is one stop ID", async () => {
    // Flat, unlike the other searches: no complex to collapse the way subway
    // platforms need, and no opposite-side ID the way a bus corner has. Every
    // route calling there shares the landing.
    const options = await searchStations("ferry", "wall st");
    const value = Object.values(options[0])[0];
    assert.match(value, /^ferry:\d+$/);
    assert.ok(!value.includes("+"), "a landing should not merge stop IDs");
  });
});

describe("naming a bus stop from the dataset", () => {
  // What replaced the "@name" suffix. Bus is the one network whose stop
  // names are not bundled into the Worker, so the board builder asks NY
  // Open Data rather than having the picker smuggle the name through the
  // stored value.
  let portalReachable = true;

  before(async () => {
    try {
      const probe = await fetchBusStopNames(["403257"]);
      portalReachable = probe.size > 0;
    } catch {
      portalReachable = false;
    }
  });

  const needsPortal = (t: { skip: (reason?: string) => void }): boolean => {
    if (!portalReachable) {
      t.skip("NY Open Data unreachable");
      return true;
    }
    return false;
  };

  test("one call names every ID on a card", async (t) => {
    if (needsPortal(t)) return;
    // Both sides of W 42 St/5 Av. The limit must scale with the ID count:
    // a busy stop returns one row per route serving it, so a flat limit let
    // 403257 alone fill the response and 403465 came back unnamed.
    const names = await fetchBusStopNames(["403257", "403465"]);
    assert.equal(names.size, 2, `expected both stops, got ${names.size}`);
    for (const id of ["403257", "403465"]) {
      assert.match(names.get(id) ?? "", /42 ST/i, `${id} unnamed`);
    }
  });

  test("an unknown ID is simply absent", async (t) => {
    if (needsPortal(t)) return;
    // Not an error: the card still has departures to show, and falls back
    // to "Bus Stop <id>" as it always did.
    const names = await fetchBusStopNames(["999999999"]);
    assert.equal(names.get("999999999"), undefined);
  });

  test("a non-numeric ID never reaches the query", async () => {
    // The digit filter is what keeps the SoQL literal injection-free, so
    // anything else is dropped before the call — which also means no
    // request at all when nothing survives.
    const names = await fetchBusStopNames(["'; DROP--", "abc"]);
    assert.equal(names.size, 0);
  });

  test("no IDs means no request", async () => {
    const names = await fetchBusStopNames([]);
    assert.equal(names.size, 0);
  });
});
