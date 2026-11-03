/**
 * The four Liquid layouts, which must agree with each other and with the code.
 *
 * TRMNL's Liquid has no partials — `{% render %}` and `{% include %}` both
 * fail with "Template not found", and they fail *silently at render time*
 * rather than breaking the build. So the display rules cannot be extracted:
 * every layout reproduces them in markup, and the copies drift.
 *
 * Two failure modes, both of which have already shipped here:
 *
 * - **A rule changes in one layout.** Three of the four once printed the raw
 *   feed route id in card headings, so a `6X` headed its card "6X" and a
 *   shuttle headed its card "GS". Only `full.liquid` had the logic.
 * - **A class that does not exist.** `trmnlp lint` validates `label--*` sizes
 *   and nothing else, so an invented class renders as unstyled markup that
 *   usually looks close enough to right. `flex--1` shipped 13 times; this
 *   suite was written after finding `items--center`, `b--black` and `bw--1`
 *   live across all four layouts.
 *
 * Neither is a type error and neither fails lint. The board renders, and only a
 * reader comparing files notices — which is what these tests do instead.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  subwayRouteGlyph,
} from "../../EInk-NYC-Home-Dashboard/src/utils/subway/routeLabel.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAYOUTS = [
  "full",
  "half_horizontal",
  "half_vertical",
  "quadrant",
] as const;

const source = (name: string): string =>
  readFileSync(resolve(root, `plugin/src/${name}.liquid`), "utf8");

const layouts = new Map(LAYOUTS.map((name) => [name, source(name)]));

/** Markup with our own `<style>` block removed, so only framework classes remain. */
const markupOf = (liquid: string): string =>
  liquid.replace(/<style>[\s\S]*?<\/style>/g, "");

/**
 * Every class name a layout applies.
 *
 * Liquid is stripped **before** attributes are found, not after. A class
 * attribute can hold a tag containing quotes — `{% if bullet_class == "" %}`
 * — and those quotes close the `class="…"` match early, leaving a fragment
 * whose tail reads as a class called `if`. Removing the tags first makes the
 * attribute well-formed before it is parsed.
 */
function classesUsed(liquid: string): Set<string> {
  const withoutLiquid = markupOf(liquid)
    .replace(/\{%[\s\S]*?%\}/g, " ")
    .replace(/\{\{[\s\S]*?\}\}/g, " ");

  const found = new Set<string>();
  for (const [, attr] of withoutLiquid.matchAll(/class="([^"]*)"/g)) {
    for (const name of attr.split(/\s+/)) {
      // A class interpolated from Liquid — `grid--cols-{{ used_columns }}` —
      // leaves a stem like "grid--cols-" once the tag is gone. It is a real
      // class at render time but not a literal one here, so a name ending
      // in a hyphen is skipped rather than reported as invented.
      //
      // Everything else must be checked. The framework's own names carry
      // double hyphens and colons (`label--filled`, `md:title--base`), so
      // the pattern has to admit them — an earlier version did not, and
      // silently skipped every class worth checking.
      if (name && !name.endsWith("-")) found.add(name);
    }
  }
  return found;
}

describe("the display rule is identical in every layout", () => {
  // Not a string comparison of the markup: full.liquid carries responsive
  // variants (`md:label--base`) the smaller layouts do not, and the heading
  // path writes markup inline where the row path assigns a class. What has to
  // match is the *rule*, so these assert its moving parts.

  test("every layout strips the express X the same way", () => {
    for (const [name, liquid] of layouts) {
      // The whole id must be one character plus X — the same bound
      // EXPRESS_ROUTE applies in TypeScript. A looser `endsWith("X")` would
      // eventually eat a route whose name merely ends in X.
      assert.ok(
        liquid.includes('remove_last: "X"'),
        `${name} does not strip the express suffix`
      );
      assert.ok(
        liquid.includes("{% if stripped.size == 1 %}"),
        `${name} does not bound the express rule to a single character`
      );
    }
  });

  test("every layout draws a bullet at one or two characters", () => {
    // Two is SI, the Staten Island Railway. Three or more is a bus route or a
    // railroad branch and must stay a pill — "Babylon" in a circle is
    // unreadable, and a "Q101" clipped to "Q10" is a different route.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes("glyph.size <= 2"),
        `${name} does not use the two-character bullet bound`
      );
      assert.ok(
        !liquid.includes("{% if glyph.size == 1 %}"),
        `${name} still has a one-character-only bullet test`
      );
    }
  });

  test("every layout gives a two-character bullet its own type treatment", () => {
    // At the single-character size the two letters touch the curve.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes("bullet--pair"),
        `${name} does not size SI to fit the circle`
      );
      assert.ok(
        liquid.includes(".bullet--pair > span"),
        `${name} uses bullet--pair without defining it`
      );
    }
  });

  test("every layout defines the shapes it applies", () => {
    // These three are ours, not the framework's, so each layout carries its
    // own copy of the CSS. A layout applying a shape it never defined renders
    // a plain pill and looks merely a bit wrong.
    for (const [name, liquid] of layouts) {
      for (const shape of [".bullet", ".bullet--express"]) {
        assert.ok(
          liquid.includes(`${shape} {`),
          `${name} does not define ${shape}`
        );
      }
    }
  });

  test("only subway cards draw bullets", () => {
    // The shape *means* "a subway line", so it has to be scoped by card
    // type rather than by glyph length. Ferry routes are two characters —
    // AS, ER, SG — and were drawn as subway bullets on the demo board;
    // bus routes escaped only by being four characters long.
    for (const [name, liquid] of layouts) {
      const shapeTests = [
        ...liquid.matchAll(/\{%\s*if\s+([^%]*?)glyph\.size\s*<=\s*2\s*%\}/g),
      ];
      assert.ok(shapeTests.length > 0, `${name} has no bullet shape test`);

      for (const [, prefix] of shapeTests) {
        assert.match(
          prefix,
          /card\.y\s*==\s*"subway"\s+and\s*$/,
          `${name} draws a bullet without checking the card is subway`
        );
      }
    }
  });

  test("every row is one line, in every layout", () => {
    // It was two in `full` for split subway columns, on the measurement
    // that ~123px could not carry badge, destination and time together —
    // true at a 1.7em bullet, not at 1.35em. Now uniform: a row is a row
    // whatever card it is in, which is what lets a reader scan across
    // columns.
    for (const [name, markup] of layouts) {
      assert.ok(
        markup.includes("row-line"),
        `${name}.liquid does not use the one-line row`
      );
      assert.ok(
        !markup.includes("one_line"),
        `${name}.liquid still branches on a two-line layout`
      );
    }
  });

  test("every clock on the board is the same size", () => {
    // A split subway column is half the width of a full card's row, and
    // the clock was shrunk there twice to buy the destination back — 0.75em,
    // then 0.92em. Both read as a mistake beside the full-size clocks next
    // to them, and a panel seen from across a room has exactly one element
    // that must never shrink.
    //
    // The destination gives way instead: a clipped station name survives
    // being clipped, where a smaller clock is just harder to read.
    for (const [name, markup] of layouts) {
      assert.doesNotMatch(
        markup,
        /\.row-time\s*\{[^}]*font-size/s,
        `${name}.liquid resizes the clock`
      );
      assert.ok(
        !markup.includes("row-line--split"),
        `${name}.liquid still has a narrower row variant`
      );
    }
  });

  test("the footer names the networks and dates itself", () => {
    for (const [name, markup] of layouts) {
      assert.ok(
        markup.includes("NYC Subway, Bus, Rail, Ferry"),
        `${name}.liquid does not name the networks`
      );
      assert.ok(
        markup.includes("Last updated: {{ a }}"),
        `${name}.liquid does not date the board`
      );
      assert.ok(
        markup.includes("footer-stamp"),
        `${name}.liquid does not right-align the timestamp`
      );
    }
  });

  test("becoming urgent changes a row's colour and nothing else", () => {
    // The highlight once carried a negative margin so it could reach the
    // card edge without narrowing the row. Two bugs came of it: a negative
    // margin pulls the row outside its parent, which clips, so the left
    // edge of every highlight was shaved off — and only urgent rows moved,
    // so a highlight visibly shifted its own row against its neighbours.
    //
    // Every row carries the inset now, so the urgent rule may set colour
    // and nothing that affects layout.
    for (const [name, markup] of layouts) {
      const rule = /\.row-line--urgent\s*\{([^}]*)\}/s.exec(markup);
      assert.ok(rule, `${name}.liquid has no urgent row rule`);
      assert.doesNotMatch(
        rule![1],
        /margin|padding|width|font-size/,
        `${name}.liquid lets the highlight change the row's geometry`
      );
    }
  });

  test("the destination clips instead of wrapping", () => {
    // A wrapped name makes its row taller than its neighbours, which is
    // exactly what uniform row height exists to prevent.
    for (const [name, markup] of layouts) {
      assert.ok(
        markup.includes("row-dest"),
        `${name}.liquid does not bound its destination`
      );
    }
  });

  test("every layout puts the heading marks after the title", () => {
    // Subway bullets and the LIRR/Metro North/Ferry tags share one slot, to
    // the right of the station name. Three layouts rendered them *before*
    // the title, so a tag sat where a reader expects the name — visible
    // only once the non-subway types had marks of their own.
    for (const [name, liquid] of layouts) {
      const title = liquid.indexOf("{{ card.n }}");
      const marks = liquid.indexOf("{% if card.b %}");
      assert.ok(title >= 0 && marks >= 0, `${name} has no card heading`);
      assert.ok(
        title < marks,
        `${name} renders the heading marks before the station name`
      );
    }
  });

  test("the heading marks are bounded by width, not by a count", () => {
    // A twelve-route complex wraps its bullets onto a second line and, in
    // the smaller layouts, straight through the neighbouring card's
    // heading — so the strip has to be bounded somehow.
    //
    // It was a fixed `limit:` for a while, and that is the wrong shape: the
    // right count depends on the bullet size, so the cap went stale the
    // moment the bullets shrank, and Times Square headed itself "1 2 3 7"
    // while the rows beneath showed A, E and R. Clipping cannot go stale.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes('<div class="bullet-strip'),
        `${name} does not bound its heading marks`
      );
      assert.doesNotMatch(
        liquid,
        /\{%\s*for route in card\.b limit:/,
        `${name} still caps its bullets at a fixed count`
      );
    }
  });

  test("a heading tag is not squeezed like a bullet", () => {
    // The tag shares the heading's mark slot with the subway's bullets, and
    // that slot is sized for circles. When the strip gained a shrink and a
    // 50% cap, "LIRR", "Bus" and "Ferry" were crushed to an unreadable
    // black square on the device — a word is useless once clipped, where a
    // bullet list can give way.
    for (const [name, liquid] of layouts) {
      assert.match(
        liquid,
        /\.type-tag \{[^}]*min-width:/s,
        `${name} lets its network tag shrink to nothing`
      );
      assert.ok(
        liquid.includes("bullet-strip--tag"),
        `${name} applies the bullet cap to a card carrying a tag`
      );
    }
  });

  test("the layouts do not depend on :has()", () => {
    // It reads better than a template-set modifier, but this markup renders
    // on an e-ink device whose browser version is not ours to choose, and
    // an unsupported selector drops the whole rule silently — here that
    // would mean shipping the very bug the rule fixes.
    for (const [name, liquid] of layouts) {
      // Comments mention it by name — explaining why it is not used is the
      // point — so strip CSS and Liquid comments before looking.
      const code = liquid
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{%\s*comment\s*%\}[\s\S]*?\{%\s*endcomment\s*%\}/g, "");
      assert.doesNotMatch(code, /:has\(/, `${name} uses :has()`);
    }
  });

  test("a heading tag cannot overflow its card", () => {
    // The tag shares its slot with the subway's route bullets, but unlike a
    // bullet it is words. Unbounded, a long one wraps onto a second line,
    // pushes past the card's edge into the heading beside it, and crushes
    // the station name it was meant to sit next to — verified by rendering
    // a 32-character tag, which clipped "Harlem-125 St" to "Harlem-1…".
    //
    // The station name is what a rider reads first, so the tag gives way.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes(".type-tag {"),
        `${name} does not define the tag's bounds`
      );
      assert.ok(
        /<span class="label[^"]*label--filled type-tag">/.test(liquid),
        `${name} renders a heading tag without bounding it`
      );
      for (const rule of ["text-overflow: ellipsis", "white-space: nowrap", "max-width"]) {
        assert.ok(
          liquid.includes(rule),
          `${name}'s tag is missing ${rule}`
        );
      }
    }
  });

  test("the grid is sized to the columns in use", () => {
    // Hardcoded at three, a board using two left a third of the panel
    // blank — and width is the thing destinations are short of, which is
    // why three is the maximum in the first place. Two columns go from
    // ~253px each to ~390px.
    //
    // Slots keep their columns: only the empty ones are dropped, so a card
    // never moves because a different card was added elsewhere.
    for (const name of ["full", "half_horizontal"]) {
      const liquid = layouts.get(name)!;
      assert.ok(
        liquid.includes("grid--cols-{{ used_columns }}"),
        `${name} hardcodes its column count`
      );
      assert.ok(
        /\{%\s*if used_columns == 0\s*%\}/.test(liquid),
        `${name} does not guard against an empty board`
      );
    }
  });

  test("a long row badge cannot make its row taller", () => {
    // Uniform row height is what makes a column scannable. "City Terminal
    // Zone" — LIRR's name for Penn/Atlantic/Grand Central service — wrapped
    // to a second line and pushed its row past its neighbours.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes(".row-badge {"),
        `${name} does not bound its row badges`
      );
      assert.ok(
        liquid.includes("row-badge{% endif %}"),
        `${name} never applies the bound`
      );
    }
  });

  test("every layout shows when the data was fetched", () => {
    // A panel refreshes on an interval and e-ink holds its last image
    // through a failure, so without this there is no way to tell a quiet
    // board from a frozen one.
    //
    // The Worker pre-formats it in New York time: Liquid cannot convert a
    // timezone, and the panel runs wherever the user is.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes("{% if a %}"),
        `${name} does not guard the timestamp`
      );
      assert.ok(
        liquid.includes("{{ a }}"),
        `${name} never renders the timestamp`
      );
    }
  });

  test("every layout draws the direction arrow", () => {
    // `‹` toward the city, `›` away. Single-angle quotes rather than ← →,
    // which the panel's face draws inconsistently at this size.
    for (const [name, liquid] of layouts) {
      assert.ok(liquid.includes("r[4]"), `${name} ignores the direction field`);

      // The assignments themselves, not just the glyphs — a comment
      // mentioning an arrow would satisfy a bare `includes`.
      assert.ok(
        /assign arrow = "‹"/.test(liquid),
        `${name} never assigns the inbound arrow`
      );
      assert.ok(
        /assign arrow = "›"/.test(liquid),
        `${name} never assigns the outbound arrow`
      );
      assert.ok(
        liquid.includes("{{ arrow }}"),
        `${name} assigns an arrow but never renders it`
      );
    }
  });

  test("the arrow survives a dropped destination", () => {
    // A train to its branch's namesake has its destination blanked as
    // redundant — "Ronkonkoma | Ronkonkoma" — but still has a direction.
    // The old markup replaced the whole span with an empty spacer when the
    // destination was blank, which lost the arrow on exactly the rows that
    // most need it.
    for (const [name, liquid] of layouts) {
      assert.ok(
        !liquid.includes('<span class="grow"></span>'),
        `${name} still replaces a dropped destination with an empty spacer`
      );
    }
  });

  test("the card heading uses the same rule as the departure rows", () => {
    // The bug this guards: three layouts printed `{{ route }}` raw in their
    // headings while their rows went through the rule, so one card could
    // disagree with itself — heading "GS", rows "S".
    for (const [name, liquid] of layouts) {
      const headings = [
        ...markupOf(liquid).matchAll(
          /<span class="label[^"]*label--filled[^"]*">\{\{\s*(\w+)\s*\}\}<\/span>/g
        ),
      ].map((m) => m[1]);

      for (const variable of headings) {
        assert.equal(
          variable,
          "glyph",
          `${name} renders {{ ${variable} }} directly — it must render the glyph the rule produced`
        );
      }
    }
  });
});

describe("every class exists in the framework", () => {
  // trmnlp lint does not check this. An invented class is inert: the element
  // renders unstyled, which usually looks close enough that it ships.
  //
  // The stylesheet is fetched rather than vendored (19MB), so this test is
  // skipped offline rather than failing the suite for a network reason.
  const FRAMEWORK_CSS = "https://trmnl.com/css/3.4.4/plugins.css";
  const cachePath = resolve(root, "node_modules/.cache/trmnl-framework.css");

  /** Classes we define ourselves, in each layout's own <style> block. */
  const OURS = new Set([
    "bullet",
    "bullet--express",
    "bullet--pair",
    "type-tag",
    "row-badge",
    "row-line",
    "row-dest",
    "row-time",
    "bullet-strip",
    "card-name",
    "footer-stamp",
    "row-line--urgent",
    "bullet-strip--tag",
  ]);

  let frameworkClasses: Set<string> | undefined;

  before(async () => {
    let css: string | undefined;

    if (existsSync(cachePath)) {
      css = readFileSync(cachePath, "utf8");
    } else {
      try {
        const response = await fetch(FRAMEWORK_CSS);
        if (response.ok) {
          css = await response.text();
          mkdirSync(dirname(cachePath), { recursive: true });
          writeFileSync(cachePath, css);
        }
      } catch {
        // Offline. Left undefined, and the tests below skip.
      }
    }

    if (css === undefined) return;

    // Two escaping traps, each of which produced a false positive here:
    //
    // - Responsive variants are written escaped (`.md\:label--base`), so a
    //   colon counts as part of the name only when a backslash precedes it,
    //   and the backslash is dropped before comparing.
    // - A pseudo-selector can follow the class directly
    //   (`.label--underline::after`), so an *unescaped* colon must end the
    //   name. Allowing bare colons swallowed the pseudo-element and reported
    //   a real framework class as invented.
    const names = new Set<string>();
    for (const [, name] of css.matchAll(/\.(-?[_a-zA-Z](?:[\w-]|\\:)*)/g)) {
      names.add(name.replace(/\\/g, ""));
    }
    frameworkClasses = names;
  });

  for (const name of LAYOUTS) {
    test(`${name} applies no invented class`, (t) => {
      if (!frameworkClasses) {
        t.skip("framework stylesheet unavailable (offline)");
        return;
      }

      const invented = [...classesUsed(layouts.get(name)!)]
        .filter((cls) => !OURS.has(cls) && !frameworkClasses!.has(cls))
        .sort();

      assert.deepEqual(
        invented,
        [],
        `${name} uses ${invented.join(", ")} — not in the framework, so inert`
      );
    });
  }

  test("the framework still defines what the layouts lean on", () => {
    // A pinned framework version should not move under us, but it is served
    // from a URL rather than a lockfile. These are the classes whose absence
    // would quietly change the board's geometry.
    if (!frameworkClasses) return;

    for (const cls of [
      "grow",
      "basis--0",
      "flex--center-y",
      "flex--between",
      "w--full",
      "border--h-40",
      "label--filled",
      "label--outline",
    ]) {
      assert.ok(frameworkClasses.has(cls), `the framework no longer has .${cls}`);
    }
  });
});

describe("the layouts agree with the TypeScript rule", () => {
  // The templates cannot import subwayRouteGlyph, so these assert that what
  // the markup is built to do matches what the function actually does. If the
  // function's bounds change, the layouts' hardcoded bounds must change too.

  test("the express cases the rule produces all fit a bullet", () => {
    for (const routeId of ["6X", "7X", "FX"]) {
      const { glyph, isExpress } = subwayRouteGlyph(routeId);
      assert.equal(isExpress, true, `${routeId} should be express`);
      assert.ok(
        glyph.length <= 2,
        `${routeId} yields "${glyph}", which the layouts would draw as a pill`
      );
    }
  });

  test("every special label fits the bullet bound the layouts hardcode", () => {
    // The layouts test `glyph.size <= 2`. Any label the rule can produce that
    // is longer renders as a pill, which for a subway route is wrong.
    for (const routeId of ["GS", "FS", "H", "SI", "SS", "SIR", "1", "7", "A"]) {
      const { glyph } = subwayRouteGlyph(routeId);
      assert.ok(
        glyph.length <= 2,
        `${routeId} yields "${glyph}" (${glyph.length} chars) — too long for a bullet`
      );
    }
  });

  test("a named route stays long enough to be drawn as a pill", () => {
    // The other side of the same bound: these must *not* become bullets.
    for (const name of ["Q101", "B41", "Babylon", "Port Washington"]) {
      const { glyph } = subwayRouteGlyph(name);
      assert.ok(
        glyph.length > 2,
        `"${name}" yields "${glyph}", which the layouts would draw in a circle`
      );
    }
  });
});

describe("the preview is pinned to the device's own profile", () => {
  // TRMNL stamps a per-device class on the `.screen` wrapper when it renders
  // for hardware; `trmnlp` emits a bare `screen screen--fonts-trmnl`, so a
  // local build silently falls back to the `:root` defaults. Each layout
  // therefore sets the same variables that class would, which is how the
  // preview and the panel agree.
  //
  // Copied values go stale. This checks ours still match the framework's.
  const FRAMEWORK_CSS = "https://trmnl.com/css/3.4.4/plugins.css";
  const cachePath = resolve(root, "node_modules/.cache/trmnl-framework.css");

  /** The device this recipe is previewed against. */
  const DEVICE = "ogv2";

  // Variables the device block sets that `.trmnl .screen` already computes
  // identically — the gap scale chain and the full-screen sizes. The preview
  // gets those from `.screen` whether or not a device class is present, so
  // copying them would be noise. The test below proves they really are
  // identical rather than taking it on trust.
  //
  // --quadrant-w/h are the exception in the other direction: `.screen`
  // computes them differently, and the device's 100% resolves against
  // trmnlp's unsized wrapper and collapses the quadrant view to an empty
  // title bar. Verified by rendering it both ways.
  const ALREADY_ON_SCREEN = new Set([
    "gap-xsmall",
    "gap-small",
    "gap",
    "gap-medium",
    "gap-large",
    "gap-xlarge",
    "gap-xxlarge",
    "list-gap-small",
    "full-w",
    "full-h",
  ]);
  const CANNOT_COPY = new Set(["quadrant-w", "quadrant-h"]);

  let deviceProfile: Map<string, string> | undefined;
  let screenProfile: Map<string, string> | undefined;

  before(async () => {
    let css: string | undefined;

    if (existsSync(cachePath)) {
      css = readFileSync(cachePath, "utf8");
    } else {
      try {
        const response = await fetch(FRAMEWORK_CSS);
        if (response.ok) {
          css = await response.text();
          mkdirSync(dirname(cachePath), { recursive: true });
          writeFileSync(cachePath, css);
        }
      } catch {
        // Offline. Left undefined, and the tests below skip.
      }
    }

    if (css === undefined) return;

    const read = (body: string) => {
      const profile = new Map<string, string>();
      for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+)/g)) {
        profile.set(name, value.trim());
      }
      return profile;
    };

    const device = new RegExp(`\.trmnl \.screen--${DEVICE}\{([^}]*)\}`).exec(css);
    const screen = /\.trmnl \.screen\{([^}]*)\}/.exec(css);
    if (!device || !screen) return;

    deviceProfile = read(device[1]);
    screenProfile = read(screen[1]);
  });

  test("the variables we skip are already identical on .screen", () => {
    // Why ALREADY_ON_SCREEN is safe to leave out. If a framework release
    // ever makes a device's gap chain differ from the generic one, this
    // fails and the skipped set has to be revisited.
    if (!deviceProfile || !screenProfile) return;

    for (const key of ALREADY_ON_SCREEN) {
      assert.equal(
        screenProfile.get(key),
        deviceProfile.get(key),
        `--${key} differs between .screen and ${DEVICE}, so it can no longer be skipped`
      );
    }
  });

  for (const name of LAYOUTS) {
    test(`${name} matches the ${DEVICE} profile`, (t) => {
      if (!deviceProfile) {
        t.skip("framework stylesheet unavailable (offline)");
        return;
      }

      const markup = readFileSync(resolve(root, `plugin/src/${name}.liquid`), "utf8");
      const ours = new Map<string, string>();
      const screenBlock = /\.trmnl \.screen \{([^}]*)\}/.exec(markup);
      assert.ok(screenBlock, `${name} sets no .trmnl .screen block`);

      for (const [, key, value] of screenBlock[1].matchAll(
        /--([a-z0-9-]+):\s*([^;]+)/g
      )) {
        ours.set(key, value.trim());
      }

      for (const [key, value] of ours) {
        assert.equal(
          deviceProfile.get(key),
          value,
          `--${key} is "${value}" locally but "${deviceProfile.get(key)}" on ${DEVICE}`
        );
      }

      // The other direction: a variable the device sets and we do not have
      // silently reverts to the :root fallback.
      for (const key of deviceProfile.keys()) {
        if (ALREADY_ON_SCREEN.has(key) || CANNOT_COPY.has(key)) continue;
        assert.ok(
          ours.has(key),
          `${DEVICE} sets --${key}, which ${name} does not pin`
        );
      }
    });
  }
});
