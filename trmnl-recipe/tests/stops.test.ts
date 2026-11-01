/**
 * Rejecting a slot whose stop ID names no real stop.
 *
 * A slot can be well-formed and still meaningless. `Bus:6:` parses cleanly —
 * transit type `bus`, stop `6`, no walk time — because the parser only knows
 * the grammar, not the stops. It shipped as a card headed "Bus Stop 6" whose
 * entire content was a SIRI "No such stop" error, which is what a station
 * value stored before the picker returned `{id, name}` decays into.
 *
 * The check cannot be "is the ID short" or "does it look like a label":
 * single-digit IDs are real on three of the five networks (ferry 4 is Hunters
 * Point South, LIRR 1 is Albertson, Metro-North 1 is Grand Central). Only
 * presence in the lookup distinguishes them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { knownStop } from "../src/buildBoard.ts";
import { BusStopError } from "../../EInk-NYC-Home-Dashboard/src/utils/bus/fetchBusData.ts";

describe("a real stop ID is accepted", () => {
  test("subway, by its feed ID", () => {
    assert.equal(knownStop("721", "subway"), true); // Vernon Blvd-Jackson Av
    assert.equal(knownStop("127", "subway"), true); // Times Sq-42 St
  });

  test("each railroad, including single-digit IDs", () => {
    assert.equal(knownStop("102", "railroad-lirr"), true); // Jamaica
    assert.equal(knownStop("1", "railroad-lirr"), true); // Albertson
    assert.equal(knownStop("1", "railroad-mtn"), true); // Grand Central
  });

  test("ferry, whose IDs are all short", () => {
    assert.equal(knownStop("87", "ferry"), true); // Wall St/Pier 11
    assert.equal(knownStop("4", "ferry"), true); // Hunters Point South
  });
});

describe("an ID that names nothing is rejected", () => {
  test("the stale value that prompted the check", () => {
    // "Bus:6:" put `6` in the stop position. As a bus ID it cannot be
    // checked locally, but the same decay on any other type is caught.
    assert.equal(knownStop("6", "subway"), false);
    assert.equal(knownStop("9999", "ferry"), false);
  });

  test("a label fragment left behind by the old picker", () => {
    // Before the fix the stored value was the display label, so the stop
    // position could hold prose.
    assert.equal(knownStop("Times Sq-42 St · Subway", "subway"), false);
    assert.equal(knownStop("", "subway"), false);
  });
});

describe("the two railroads are checked separately", () => {
  // Their ID spaces overlap and disagree, so one shared lookup would accept
  // a Metro-North card pointed at an LIRR-only station and then render it
  // empty for ever. 102 is Jamaica on the LIRR and nothing on Metro-North.
  test("an LIRR-only ID is not a Metro-North stop", () => {
    assert.equal(knownStop("102", "railroad-lirr"), true);
    assert.equal(knownStop("102", "railroad-mtn"), false);
  });

  test("a Metro-North-only ID is not an LIRR stop", () => {
    assert.equal(knownStop("9", "railroad-mtn"), true); // Morris Heights
    assert.equal(knownStop("9", "railroad-lirr"), false);
  });

  test("a shared ID means different stations on each", () => {
    // Not a bug to fix — the point is that neither lookup can stand in for
    // the other, since "1" resolves on both and to unrelated places.
    assert.equal(knownStop("1", "railroad-lirr"), true);
    assert.equal(knownStop("1", "railroad-mtn"), true);
  });
});

describe("bus IDs are not checked locally", () => {
  test("any bus ID passes", () => {
    // Bus stops live in the MTA's remote dataset; route_info.json names only
    // the handful the dashboard itself uses, so a local miss would mean "not
    // one of ours", not "does not exist". The SIRI error path reports the
    // real answer.
    assert.equal(knownStop("505506", "bus"), true);
    assert.equal(knownStop("6", "bus"), true);
  });
});

describe("a bus stop's non-existence is a different failure from an outage", () => {
  // Bus is the one type whose stop list is remote, so `knownStop` cannot
  // screen it and the answer arrives as a SIRI error instead. Both kinds
  // arrive identically — HTTP 200 with text in the body — so the class
  // reads the wording once, where the response is still parsed, rather
  // than leaving every caller to match strings.
  test("'no such stop' is permanent", () => {
    // SIRI repeats itself once per operator prefix. Quoted verbatim from
    // the response for the stale `Bus:6:` card.
    const err = new BusStopError(
      "6",
      "No such stop: MTA NYCT_6. No such stop: MTA_6. No such stop: MTABC_6."
    );
    assert.equal(err.noSuchStop, true);
    assert.match(err.message, /^Bus stop 6: /);
  });

  test("anything else is transient and must stay visible", () => {
    // Hiding a card on one of these would silently delete transit the user
    // does depend on, which is the failure per-card errors exist to avoid.
    for (const text of [
      "Rate limit exceeded",
      "The service is temporarily unavailable",
      "Unknown error",
    ]) {
      assert.equal(
        new BusStopError("505506", text).noSuchStop,
        false,
        `"${text}" was treated as a missing stop`
      );
    }
  });

  test("it is still an Error, so existing handlers keep working", () => {
    const err = new BusStopError("6", "No such stop: MTA_6.");
    assert.ok(err instanceof Error);
    assert.equal(err.name, "BusStopError");
  });
});
