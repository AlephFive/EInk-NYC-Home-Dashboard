/**
 * Phase 1, step 1 — the Worker CPU spike.
 *
 * The only blocking unknown in the spec: Cloudflare Workers' free plan allows
 * 10ms of **CPU** per request. Fetching the MTA feeds is I/O and does not count
 * against that; decoding ~284KB of protobuf does. So this measures decode
 * alone, separated from the network time around it.
 *
 * Run with real feeds:  npm run spike:cpu
 *
 * Needs `--experimental-transform-types`, not `--strip-types`: the generated
 * protobuf declares real TypeScript enums, which strip-only mode rejects
 * outright. (The test suite sidesteps this by never importing the decoder —
 * see `utils/subway/feedLookup.ts`, split out for exactly that reason.)
 *
 * The numbers this prints decide whether the recipe can run on the free tier,
 * or needs the $5/month paid plan (50ms CPU) or a different host.
 */

import { FeedMessage } from "../../EInk-NYC-Home-Dashboard/src/protocol/proto/generated/gtfs-realtime.ts";

/** The feeds a representative board needs: two subway groups plus LIRR. */
const FEEDS = [
  {
    name: "subway a_division (1-7,S)",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  },
  {
    name: "subway g",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
  },
  {
    name: "lirr",
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr",
  },
];

/** Workers CPU budgets, for reporting the result against something real. */
const FREE_TIER_CPU_MS = 10;
const PAID_TIER_CPU_MS = 50;

interface FeedSample {
  name: string;
  bytes: Uint8Array;
  fetchMs: number;
}

async function fetchAll(): Promise<FeedSample[]> {
  const started = Date.now();
  const samples = await Promise.all(
    FEEDS.map(async ({ name, url }) => {
      const t0 = Date.now();
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${name}: ${response.status} ${response.statusText}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { name, bytes, fetchMs: Date.now() - t0 };
    })
  );
  console.log(`fetch (parallel, I/O — not billed as CPU): ${Date.now() - started}ms`);
  for (const s of samples) {
    console.log(`  ${s.name}: ${s.bytes.length.toLocaleString()} bytes in ${s.fetchMs}ms`);
  }
  return samples;
}

/**
 * Decode every feed once and report the total.
 *
 * Uses `performance.now()` rather than `Date.now()` because a single decode can
 * land under a millisecond, which `Date.now()` cannot resolve.
 */
function decodeOnce(samples: FeedSample[]): { totalMs: number; entities: number } {
  let entities = 0;
  const t0 = performance.now();
  for (const sample of samples) {
    const feed = FeedMessage.decode(sample.bytes);
    entities += feed.entity.length;
  }
  return { totalMs: performance.now() - t0, entities };
}

function report(label: string, ms: number): void {
  const verdict = (budget: number) =>
    ms <= budget ? `fits (${((ms / budget) * 100).toFixed(0)}% of budget)` : "EXCEEDS";
  console.log(`${label}: ${ms.toFixed(2)}ms`);
  console.log(`  free tier  (${FREE_TIER_CPU_MS}ms CPU): ${verdict(FREE_TIER_CPU_MS)}`);
  console.log(`  paid tier  (${PAID_TIER_CPU_MS}ms CPU): ${verdict(PAID_TIER_CPU_MS)}`);
}

const samples = await fetchAll();
const totalBytes = samples.reduce((sum, s) => sum + s.bytes.length, 0);
console.log(`\ntotal decoded payload: ${totalBytes.toLocaleString()} bytes\n`);

// A first decode pays one-off costs — JIT warmup, lazily-built decoder tables —
// that a long-lived Worker isolate pays once across many requests. Report both,
// because the cold number is what a freshly-started isolate actually sees.
const cold = decodeOnce(samples);
report("cold decode (first call in this process)", cold.totalMs);

const RUNS = 20;
const warm: number[] = [];
for (let i = 0; i < RUNS; i++) warm.push(decodeOnce(samples).totalMs);
warm.sort((a, b) => a - b);

console.log("");
report(`warm decode (median of ${RUNS})`, warm[Math.floor(RUNS / 2)]);
console.log(`  best ${warm[0].toFixed(2)}ms / worst ${warm[warm.length - 1].toFixed(2)}ms`);
console.log(`\nentities decoded per pass: ${cold.entities.toLocaleString()}`);
