/**
 * Bus stops, which behave unlike every other transit type here.
 *
 * A subway or railroad station is one place with trains going both ways. A
 * bus stop is **one side of the street** — a single ID carries one direction
 * only, and the opposite direction is a different ID with the same name. Get
 * this wrong and the card shows half the service while looking complete,
 * which is worse than showing an error.
 */

import { test, describe } from "node:test";
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
  // This hits the NY Open Data portal, so it is slower than the rest and
  // depends on the network. It earns that because the valid_to filter is the
  // single most consequential thing in the picker.
  test("groups both sides of a corner under one option", async () => {
    const options = await searchStations("bus", "borden av/5");
    assert.ok(options.length > 0, "no options for a known corner");

    const [label, value] = Object.entries(options[0])[0];
    assert.match(label, /BORDEN AV\/5 ST/);

    const ids = value.replace(/^bus:/, "").split("@")[0].split("+");
    assert.equal(ids.length, 2, `expected both sides, got ${ids.join(",")}`);
  });

  test("carries the stop name so the card is not headed 'Bus Stop <id>'", async () => {
    // route_info.json holds one hand-added stop, so a lookup cannot cover a
    // user's choice. The picker knows the name and sends it along.
    const options = await searchStations("bus", "borden av/5");
    const value = Object.values(options[0])[0];
    assert.match(value, /@BORDEN AV\/5 ST$/);
  });

  test("excludes retired stop IDs", async () => {
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
