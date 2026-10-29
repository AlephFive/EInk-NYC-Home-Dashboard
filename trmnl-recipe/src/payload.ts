/**
 * Keeping a board inside what TRMNL will store.
 *
 * Separate from the HTTP layer so it can be tested without starting a Worker,
 * and because "how big may a board be" is a property of the board, not of the
 * request that asked for it.
 */

import type { Board, BoardColumn } from "./buildBoard";

/** TRMNL's payload ceiling; 10KB with TRMNL+. */
export const PAYLOAD_CAP_BYTES = 5 * 1024;

/** Bytes a board serialises to. */
export function payloadBytes(board: Board): number {
  return new TextEncoder().encode(JSON.stringify(board)).length;
}

/**
 * How much headroom to leave under TRMNL's cap.
 *
 * What is measured here is our own JSON; what TRMNL enforces is the size of
 * the merge variables it stores after merging, and the two are not guaranteed
 * to be byte-identical. Overrun does not fail loudly — the board is silently
 * truncated and the panel quietly loses its last cards — so the margin is
 * sized for that asymmetry rather than for efficiency.
 *
 * 10% of the cap. A stress board of six multi-line complexes landed at 94.7%
 * with a 5% margin, which is too close to depend on when the penalty is a
 * board that looks broken for reasons the user cannot see.
 */
const PAYLOAD_MARGIN_RATIO = 0.1;

/**
 * Drop rows until the board fits, longest column first.
 */
export function trimToPayloadCap(board: Board, cap: number): void {
  const margin = cap - Math.ceil(cap * PAYLOAD_MARGIN_RATIO);
  // Bounded rather than `while (true)`: a pathological board should degrade,
  // not spin.
  for (let pass = 0; pass < 200; pass++) {
    if (payloadBytes(board) <= margin) return;

    let longest: BoardColumn | undefined;
    for (const card of board.c) {
      for (const column of card.k ?? []) {
        if (!longest || column.r.length > longest.r.length) longest = column;
      }
    }

    // Nothing left to drop — the chrome alone exceeds the cap, which the
    // caller can see in the reported byte count.
    if (!longest || longest.r.length === 0) return;
    longest.r.pop();
  }
}
