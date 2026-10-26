/**
 * Prove a deployed Worker actually serves a board.
 *
 * A deploy that succeeds but returns an empty or broken board is worse than a
 * failed one, because the panel keeps showing stale pixels and nothing says
 * why. This runs against the real URL after deploying and fails the job if
 * the board is not usable.
 *
 * Usage:  node .github/scripts/smokeTest.mjs https://host.workers.dev
 *
 * Deliberately *not* asserting on departure counts: a feed can legitimately
 * be empty — service ends, a stop is peak-only — and the project's rule is
 * that empty is not an error. What it checks is that the pipeline ran: cards
 * came back, they carry the names the lookups resolve, and the payload fits.
 */

const host = process.argv[2]?.replace(/\/$/, "");
if (!host) {
  console.error("Usage: node smokeTest.mjs <worker-url>");
  process.exit(1);
}

/** TRMNL stores at most this much; a larger board is silently truncated. */
const PAYLOAD_CAP_BYTES = 5 * 1024;

const failures = [];
const check = (ok, message) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

/** A request that reports a network failure rather than throwing out of the run. */
async function getJSON(path) {
  try {
    const response = await fetch(`${host}${path}`);
    const text = await response.text();
    return { status: response.status, text, json: safeParse(text) };
  } catch (err) {
    return { status: 0, text: "", json: undefined, error: String(err) };
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

console.log(`smoke testing ${host}\n`);

// 1. The Worker is up at all.
const health = await getJSON("/health");
check(health.status === 200 && health.json?.ok === true, "/health returns ok");

// 2. A board builds. Uses a subway stop and a railroad stop, so both feed
//    families are exercised — they decode different protobuf extensions.
const board = await getJSON(
  "/api/board?c1=subway:721:10&c2=lirr:349:20&h24=true&urgent=10"
);
check(board.status === 200, "/api/board returns 200");
check(board.json !== undefined, "/api/board returns valid JSON");

const cards = board.json?.c ?? [];
check(cards.length === 2, `two cards built (got ${cards.length})`);

// 3. Names resolved, which proves the bundled lookups shipped with the Worker.
const named = cards.filter((card) => card.n && !/^Stop |^Bus Stop /.test(card.n));
check(
  named.length === cards.length,
  `station names resolved (${cards.map((c) => c.n).join(", ")})`
);

// 4. No card reports a fetch failure. A card *may* legitimately have no
//    departures, but an error means the feed itself did not come back.
const errored = cards.filter((card) => card.e);
check(
  errored.length === 0,
  errored.length === 0
    ? "no card reported an error"
    : `cards errored: ${errored.map((c) => `${c.n}: ${c.e}`).join("; ")}`
);

// 5. Clock times are the network's, not the runtime's. This is the regression
//    that would otherwise reach the panel silently.
const firstRow = cards.flatMap((c) => c.k ?? []).flatMap((col) => col.r ?? [])[0];
if (firstRow) {
  const hour = Number(String(firstRow[2]).slice(0, 2));
  const nowInNewYork = Number(
    new Date().toLocaleString("en-GB", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    })
  );
  // Departures run ahead of now, and the hour wraps, so allow a window rather
  // than an exact match — this is catching a 4-hour skew, not minutes.
  const delta = Math.min(
    Math.abs(hour - nowInNewYork),
    24 - Math.abs(hour - nowInNewYork)
  );
  check(
    delta <= 2,
    `departure times look like New York local (${firstRow[2]}, now ${nowInNewYork}h)`
  );
} else {
  console.log("  skip  no departures to time-check (all feeds empty right now)");
}

// 6. The payload fits what TRMNL will store.
const bytes = new TextEncoder().encode(board.text).length;
check(
  bytes <= PAYLOAD_CAP_BYTES,
  `payload ${bytes} B is within the ${PAYLOAD_CAP_BYTES} B cap (${((bytes / PAYLOAD_CAP_BYTES) * 100).toFixed(0)}%)`
);

// 7. The station picker answers, which is what the form depends on.
let options;
try {
  const picker = await fetch(`${host}/api/stations/subway`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "times sq" }),
  });
  options = safeParse(await picker.text());
} catch {
  options = undefined;
}
check(
  Array.isArray(options) && options.length > 0,
  `station search returns options (${options?.length ?? 0})`
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  // Set the code rather than calling process.exit(): exiting while fetch's
  // sockets are still closing aborts teardown noisily on some platforms,
  // which buries the failure list the reader actually needs.
  process.exitCode = 1;
} else {
  console.log("\nAll smoke checks passed.");
}
