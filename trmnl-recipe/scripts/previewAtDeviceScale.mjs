/**
 * Re-render a built view at the scale the real device uses.
 *
 * `trmnlp build` renders with `--device-ui-scale: 1`, so every local PNG is
 * the *unscaled* case. The device sets it higher and the framework
 * multiplies every size by it — which is why the TRMNL-rendered board came
 * back visibly tighter than anything seen locally, with "Times Sq-42 St"
 * truncated to "Times Sq…" and the Metro North tag to "Metro …".
 *
 * `--ui-scale` is computed on `.screen`, a wrapper `trmnlp` does emit, so
 * the scale can be injected there after the fact. That is what this does:
 * take `_build/<view>.html`, set the variable, and reopen it.
 *
 * Usage:
 *   docker run ... trmnl/trmnlp build            # HTML (no --png)
 *   node scripts/previewAtDeviceScale.mjs        # then scale it
 *   open plugin/_build/full.html                 # in a browser
 *
 * **Run it after `build`, and open the HTML rather than the PNG.** `trmnlp`
 * renders the PNG itself, before this can touch anything, so the PNG stays
 * unscaled. The browser is the only place the device's proportions show.
 *
 * The default of 1.15 is measured from the TRMNL render rather than
 * documented — TRMNL does not publish the per-device value — so treat it as
 * a close approximation, not the exact number.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(here, "../plugin/_build");

const scale = Number(process.argv[2] ?? 1.15);

if (!Number.isFinite(scale) || scale <= 0) {
  console.error("Usage: node scripts/previewAtDeviceScale.mjs [scale]");
  process.exit(1);
}

const views = ["full", "half_horizontal", "half_vertical", "quadrant"];
let written = 0;

for (const view of views) {
  const path = resolve(BUILD, `${view}.html`);
  if (!existsSync(path)) continue;

  const html = readFileSync(path, "utf8");

  // Already scaled: re-running should change the value, not stack styles.
  const cleaned = html.replace(
    /<style data-device-scale>[\s\S]*?<\/style>/g,
    ""
  );

  const style =
    `<style data-device-scale>.trmnl .screen{--device-ui-scale:${scale}}</style>`;

  // After the framework stylesheet, so it wins on equal specificity.
  const out = cleaned.includes("</head>")
    ? cleaned.replace("</head>", `${style}</head>`)
    : style + cleaned;

  writeFileSync(path, out, "utf8");
  written++;
}

console.log(
  `rewrote ${written} view(s) at --device-ui-scale: ${scale}\n` +
    `open plugin/_build/<view>.html to see the device's proportions`
);
