/**
 * Phase 1, step 3 — exercise /api/board against live feeds, off-Worker.
 *
 * Builds the board the dashboard currently shows, so the output can be
 * compared against the real panel, and reports the payload against TRMNL's
 * 5KB cap.
 */
import { parseBoardSettings } from "../src/settings";
import { buildBoard } from "../src/buildBoard";

// The live board's own config, expressed as a TRMNL polling URL.
const query = new URLSearchParams({
  c1: "subway:721:10",
  c2: "subway:G24:15",
  c3: "bus:505506:3",
  c4: "lirr:118:5",
  c5: "lirr:349:20",
  h24: "true",
  urgent: "10",
  leavein: "false",
});
const url = new URL(`https://example.com/api/board?${query}`);

const settings = parseBoardSettings(url);
console.log(`parsed ${settings.cards.length} cards:`);
for (const c of settings.cards) {
  console.log(`  slot ${c.slot}: ${c.transitType} ${c.stopIds.join("+")} walk ${c.walkTime}m`);
}

const t0 = Date.now();
const board = await buildBoard(settings, { MTA_API_KEY: process.env.MTA_API_KEY });
console.log(`\nbuilt in ${Date.now() - t0}ms\n`);

for (const card of board.c) {
  const rows = (card.k ?? []).reduce((n, col) => n + col.r.length, 0);
  console.log(`[${card.s}] ${card.n} (${card.y})${card.e ? `  ERROR: ${card.e}` : `  ${rows} rows`}`);
  for (const col of card.k ?? []) {
    console.log(`   ${col.h || "(no heading)"}`);
    for (const r of col.r) console.log(`     ${r[0].padEnd(16)} ${r[1].padEnd(22)} ${r[2]}${r[3] ? " *" : ""}`);
    if (col.r.length === 0) console.log("     (no upcoming departures)");
  }
}

const body = JSON.stringify(board);
const bytes = Buffer.byteLength(body, "utf8");
console.log(`\npayload: ${bytes} bytes = ${((bytes / 5120) * 100).toFixed(1)}% of 5KB cap`);
