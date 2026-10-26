/**
 * Write the deployed Worker's hostname into the recipe files.
 *
 * `form.yaml` carries the picker endpoint six times and the polling URL twice,
 * so doing it by hand is eight chances to miss one — and a missed one fails as
 * an empty dropdown rather than an error, which is hard to spot.
 *
 * Usage:  node scripts/configure.mjs <worker-host>
 *   e.g.  node scripts/configure.mjs trmnl-nyc-transit.alephfive.workers.dev
 *
 * Writes `recipe/out/`, leaving the templates untouched so it can be re-run
 * when the hostname changes.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RECIPE_DIR = resolve(here, "../recipe");
const OUT_DIR = join(RECIPE_DIR, "out");
/** trmnlp's own copy, which `trmnlp push` uploads. Edited in place. */
const PLUGIN_SETTINGS = resolve(here, "../plugin/src/settings.yml");
const PLACEHOLDER = "REPLACE_ME.workers.dev";

const host = process.argv[2]?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");

if (!host) {
  console.error("Usage: node scripts/configure.mjs <worker-host>");
  console.error("  e.g. node scripts/configure.mjs my-worker.my-name.workers.dev");
  process.exit(1);
}

if (!host.includes(".")) {
  console.error(`"${host}" does not look like a hostname — expected something like`);
  console.error("  trmnl-nyc-transit.<your-subdomain>.workers.dev");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(RECIPE_DIR).filter((name) => /\.(yaml|txt|liquid)$/.test(name));
let totalReplacements = 0;

for (const name of files) {
  const source = readFileSync(join(RECIPE_DIR, name), "utf8");
  const replacements = source.split(PLACEHOLDER).length - 1;
  const configured = source.split(PLACEHOLDER).join(host);
  writeFileSync(join(OUT_DIR, name), configured, "utf8");
  totalReplacements += replacements;
  console.log(`  ${name.padEnd(22)} ${replacements} replacement${replacements === 1 ? "" : "s"}`);
}

// The trmnlp project is what `trmnlp push` uploads, so its settings file is
// rewritten in place rather than copied into an output directory.
const settings = readFileSync(PLUGIN_SETTINGS, "utf8");
const settingsReplacements = settings.split(PLACEHOLDER).length - 1;

if (settingsReplacements > 0) {
  writeFileSync(PLUGIN_SETTINGS, settings.split(PLACEHOLDER).join(host), "utf8");
  totalReplacements += settingsReplacements;
  console.log(
    `  ${"plugin settings.yml".padEnd(22)} ${settingsReplacements} replacement${settingsReplacements === 1 ? "" : "s"} (in place)`
  );
} else {
  console.log(`  plugin settings.yml    already configured`);
}

console.log(`\nWrote recipe/out/ against https://${host}`);
console.log(`${totalReplacements} placeholder${totalReplacements === 1 ? "" : "s"} replaced.`);

if (totalReplacements === 0) {
  console.warn("\nNothing was replaced — check the templates still contain REPLACE_ME.");
}
