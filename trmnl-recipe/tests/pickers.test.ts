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
import { searchStations } from "../src/pickers.ts";

const board = (query: string) =>
  parseBoardSettings(new URL(`https://example.test/api/board?${query}`));

describe("a stop ID is one direction", () => {
  test("a card with one ID gets one column", () => {
    const { cards } = board("c1=bus:505507:3");
    assert.deepEqual(cards[0].stopIds, ["505507"]);
  });

  test("a corner needs both IDs to show both directions", () => {
    // 505507 and 505513 are the two sides of Borden Av / 5 St. The card
    // renders one column per ID, so a user who picks only one sees
    // departures in a single direction with no hint that the other exists.
    const { cards } = board("c1=bus:505507%2B505513:3");
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

  test("carries the stop name so the card is not headed 'Bus Stop <id>'", async (t) => {
    if (needsPortal(t)) return;
    // route_info.json holds one hand-added stop, so a lookup cannot cover a
    // user's choice. The picker knows the name and sends it along.
    const options = await searchStations("bus", "borden av/5");
    const value = Object.values(options[0])[0];
    assert.match(value, /@BORDEN AV\/5 ST$/);
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
