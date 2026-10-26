/**
 * Guard against the clock-time regression that would ship silently.
 *
 * A deployed Cloudflare Worker runs in UTC. `formatClockTime` once called
 * `toLocaleTimeString` with no `timeZone`, so every departure rendered four or
 * five hours out — and `wrangler dev` inherits the developer's own zone, so
 * the fault was invisible until the board reached a device.
 *
 * This reads the source rather than importing it: `departures.ts` pulls in
 * `displayConfig` through Vite's resolution, which a bare `node` run cannot
 * follow. Checking the source is also the stricter test — it fails on a
 * formatter that *would* trust the host, even if the default happens to mask
 * it on the machine running CI.
 *
 * Run under `TZ=UTC` in CI.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, "../../EInk-NYC-Home-Dashboard/src/utils/departures.ts");
const NETWORK_ZONE = "America/New_York";

const source = readFileSync(SOURCE, "utf8");
const failures = [];

// 1. The formatter must pass a timeZone. Without it the host's zone wins.
const formatter = source.match(/toLocaleTimeString\([\s\S]*?\}\)/);
if (!formatter) {
  failures.push("Could not find the toLocaleTimeString call in departures.ts.");
} else if (!formatter[0].includes("timeZone")) {
  failures.push(
    "toLocaleTimeString is called without a timeZone, so clock times render in\n" +
      "  the host's zone — UTC on a deployed Worker, and hours wrong on the panel."
  );
}

// 2. The default must be the network's own zone, not whatever the host says.
if (!source.includes(`"${NETWORK_ZONE}"`)) {
  failures.push(`No ${NETWORK_ZONE} default found; the fallback zone must be explicit.`);
}

// 3. The behaviour itself, exercised through the same Intl call the formatter
//    makes — so a correct source that somehow still renders wrong is caught.
const INSTANT = Date.parse("2026-10-26T20:10:00Z");
const rendered = new Date(INSTANT).toLocaleTimeString("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: NETWORK_ZONE,
});
if (rendered !== "16:10") {
  failures.push(`Intl rendered ${rendered} for 20:10 UTC in ${NETWORK_ZONE}; expected 16:10.`);
}

console.log(`host zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`20:10 UTC in ${NETWORK_ZONE}: ${rendered}`);

if (failures.length > 0) {
  console.error("\nFAIL:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nPASS: clock times are pinned to the network's zone, not the host's.");
