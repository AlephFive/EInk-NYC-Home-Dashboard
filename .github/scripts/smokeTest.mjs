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
 *
 * **Use a multi-route complex, not a single-route stop.** Two bugs reached
 * production behind a fixture of `subway:721` (the 7 alone) and a railroad
 * stop: a station's routes are expanded into feed ids, and that expansion is
 * wider than the routes — it derives `1X` from `1` because the trailing X is
 * the express rule rather than a list. Vernon Blvd survived because the 7's
 * express exists; Times Sq, which expands to 25 ids with 10 mapping to no
 * feed, did not. Every local test, the whole CI suite and this smoke test
 * were green while every multi-route subway card was failing.
 *
 * So the board below is deliberately awkward: a twelve-route complex, a
 * single stop ID carrying four lines across two feeds, the Staten Island
 * Railway, a line-filtered card, a bus corner, and a railroad.
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

// 2. A board builds. Every card here exercises something that has broken:
//
//    c1  Times Sq complex, 5 stop IDs, 12 routes  — the expansion that threw
//    c2  Coney Island, one ID, D/F/N/Q, two feeds — multi-feed on one stop
//    c3  the same complex narrowed to 1,2,3       — the line filter
//    c4  St George, the Staten Island Railway     — its own feed and label
//    c5  a bus corner, both sides of the street   — SIRI, and ID pairing
//    c6  LIRR                                     — the other protobuf dialect
const TIMES_SQ = "127+725+902+A27+R16";
const board = await getJSON(
  `/api/board?c1=subway:${TIMES_SQ}:5` +
    `&c2=subway:D43:5` +
    `&c3=subway:${TIMES_SQ}!1,2,3:5` +
    `&c4=subway:S31:5` +
    `&c5=bus:505507+505513@BORDEN AV/5 ST:3` +
    `&c6=lirr:102:10` +
    "&h24=true&urgent=10"
);
check(board.status === 200, "/api/board returns 200");
check(board.json !== undefined, "/api/board returns valid JSON");

const cards = board.json?.c ?? [];
check(cards.length === 6, `six cards built (got ${cards.length})`);
check(board.json?.d !== true, "a configured board is not the demo board");

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

// 4b. Heading bullets are what a rider reads, never internal feed ids.
//     The feeds name an express by suffixing X and the shuttles GS/FS/H;
//     none of those belong on a panel. Times Sq once rendered
//     "1 1X 2 2X 3 3X 7 7X GS" because the bullets were taken from the
//     expanded feed ids rather than the station's own routes.
const bullets = cards.flatMap((card) => card.b ?? []);
const internal = bullets.filter((b) => /^[0-9A-Z]X$/.test(b) || /^(GS|FS|H|SS)$/.test(b));
check(
  internal.length === 0,
  internal.length === 0
    ? `bullets are rider-facing (${[...new Set(bullets)].join("/")})`
    : `internal feed ids reached the bullets: ${internal.join(", ")}`
);

// 4c. The line filter actually narrows. c3 is the same complex as c1 but
//     asked for 1,2,3 only, so it must show fewer routes than the full card.
const full = cards.find((c) => c.s === 1);
const filtered = cards.find((c) => c.s === 3);
if (full?.b && filtered?.b) {
  check(
    filtered.b.length < full.b.length,
    `the line filter narrows the card (${filtered.b.join("/")} vs ${full.b.length} routes)`
  );
}

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
//
//    Note this board is deliberately far busier than a real one and lands
//    near the trimmer's 90% margin, so this check mostly proves the trimmer
//    ran rather than that the board was small. That is the useful assertion:
//    going over the cap does not error, TRMNL silently truncates, and the
//    panel loses its last cards with nothing to say why.
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
