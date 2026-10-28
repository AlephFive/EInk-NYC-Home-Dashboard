/**
 * Keeping a board inside TRMNL's 5KB cap.
 *
 * This matters more than its size suggests. Going over does not fail loudly:
 * TRMNL truncates what it stores, so the panel quietly loses its last cards
 * and nothing says why. The row count was raised to 16 per card so the panel
 * could decide what fits, which is what made the cap reachable — a board of
 * six busy subway complexes measured at 90% of it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PAYLOAD_CAP_BYTES,
  payloadBytes,
  trimToPayloadCap,
} from "../src/payload.ts";
import type { Board, BoardRow } from "../src/buildBoard.ts";

/** A row of roughly the size a real railroad departure takes. */
const row = (n: number): BoardRow => [
  "Port Washington",
  "Port Washington",
  `0${n % 10}:${n % 60}`,
  0,
];

/** A board of `cards` cards, each with `cols` columns of `rows` rows. */
function makeBoard(cards: number, cols: number, rows: number): Board {
  return {
    t: "2026-10-28T12:00:00.000Z",
    c: Array.from({ length: cards }, (_, i) => ({
      s: i + 1,
      y: "railroad-lirr",
      n: "Grand Central Madison",
      k: Array.from({ length: cols }, () => ({
        h: "Departures",
        r: Array.from({ length: rows }, (_, j) => row(j)),
      })),
    })),
  };
}

const totalRows = (board: Board) =>
  board.c.reduce(
    (sum, card) => sum + (card.k ?? []).reduce((n, col) => n + col.r.length, 0),
    0
  );

describe("a board that already fits", () => {
  test("is left alone", () => {
    const board = makeBoard(2, 1, 5);
    const before = totalRows(board);
    trimToPayloadCap(board, PAYLOAD_CAP_BYTES);
    assert.equal(totalRows(board), before);
  });
});

describe("a board that does not fit", () => {
  test("is trimmed under the cap", () => {
    const board = makeBoard(6, 2, 16);
    assert.ok(
      payloadBytes(board) > PAYLOAD_CAP_BYTES,
      "the fixture should start over the cap"
    );

    trimToPayloadCap(board, PAYLOAD_CAP_BYTES);
    assert.ok(payloadBytes(board) <= PAYLOAD_CAP_BYTES);
  });

  test("keeps a margin under it", () => {
    // What is measured here is our own JSON; what TRMNL enforces is the
    // merge variables it stores after merging, and the two are not
    // guaranteed byte-identical. A 5% margin left a stress board at 94.7%,
    // which is too close when the penalty is silent truncation.
    const board = makeBoard(6, 2, 16);
    trimToPayloadCap(board, PAYLOAD_CAP_BYTES);
    assert.ok(
      payloadBytes(board) <= PAYLOAD_CAP_BYTES * 0.92,
      `expected a margin, landed at ${payloadBytes(board)} bytes`
    );
  });

  test("every card survives", () => {
    // Trimming rows is a loss of future departures; losing a whole card is a
    // loss of a station the user asked for. The first is acceptable, the
    // second is not.
    const board = makeBoard(6, 2, 16);
    trimToPayloadCap(board, PAYLOAD_CAP_BYTES);
    assert.equal(board.c.length, 6);
  });

  test("drops from the longest column first", () => {
    // So the trim costs the departures furthest in the future, and a quiet
    // card keeps its handful of rows rather than being emptied to make room
    // for a busy one.
    const board = makeBoard(2, 1, 4);
    // Long enough to actually exceed the cap, or the trim never runs and the
    // assertion passes for the wrong reason.
    board.c[0].k![0].r = Array.from({ length: 140 }, (_, i) => row(i));

    const quietBefore = board.c[1].k![0].r.length;
    trimToPayloadCap(board, PAYLOAD_CAP_BYTES);

    assert.equal(
      board.c[1].k![0].r.length,
      quietBefore,
      "the quiet card lost rows while a long column still had some"
    );
    assert.ok(board.c[0].k![0].r.length < 140, "the long column was not trimmed");
  });
});

describe("degenerate input", () => {
  test("a board with no rows terminates", () => {
    const board = makeBoard(3, 1, 0);
    trimToPayloadCap(board, PAYLOAD_CAP_BYTES);
    assert.equal(totalRows(board), 0);
  });

  test("an empty board terminates", () => {
    const board: Board = { t: "2026-10-28T12:00:00.000Z", c: [] };
    trimToPayloadCap(board, PAYLOAD_CAP_BYTES);
    assert.equal(board.c.length, 0);
  });

  test("a cap smaller than the chrome does not spin", () => {
    // Nothing left to drop: the loop must give up rather than loop forever,
    // and the caller sees the real size in x-payload-bytes.
    const board = makeBoard(2, 1, 3);
    trimToPayloadCap(board, 10);
    assert.equal(totalRows(board), 0, "every row should have been dropped");
  });

  test("a card reporting an error is not trimmed away", () => {
    const board = makeBoard(1, 1, 2);
    board.c.push({ s: 2, y: "bus", n: "A dead stop", e: "No such stop" });
    trimToPayloadCap(board, PAYLOAD_CAP_BYTES);
    assert.equal(board.c.length, 2);
    assert.equal(board.c[1].e, "No such stop");
  });
});

describe("payloadBytes", () => {
  test("measures UTF-8, not characters", () => {
    // Station names carry accented and hyphenated forms; counting characters
    // would under-report and let a board slip over the cap.
    const ascii = makeBoard(1, 1, 1);
    const wide = makeBoard(1, 1, 1);
    wide.c[0].n = "Grand Central Madison ———";

    // Three em-dashes are three bytes each where a character count would see
    // three, so the gap is small but must be positive beyond the extra ASCII.
    assert.ok(
      payloadBytes(wide) - payloadBytes(ascii) > "  ———".length,
      "multi-byte characters were counted as one byte each"
    );
  });
});
