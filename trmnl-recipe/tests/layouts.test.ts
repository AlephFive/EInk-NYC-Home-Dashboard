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

/** Every class name a layout applies, with Liquid tags stripped out. */
function classesUsed(liquid: string): Set<string> {
  const found = new Set<string>();
  for (const [, attr] of markupOf(liquid).matchAll(/class="([^"]*)"/g)) {
    const literal = attr
      .replace(/\{%[\s\S]*?%\}/g, " ")
      .replace(/\{\{[\s\S]*?\}\}/g, " ");
    for (const name of literal.split(/\s+/)) {
      if (name) found.add(name);
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

  test("a single-column card puts its rows on one line", () => {
    // Width, not transit type: one column gets the card's whole ~253px, two
    // get about 123px each, and badge plus time plus gaps leave six
    // characters of that. So the rule keys on the column count — a subway
    // terminal collapses to one direction and should read like a railroad
    // card, which keying on `card.y` would miss.
    const full = layouts.get("full")!;
    assert.match(
      full,
      /\{%\s*assign column_count = card\.k \| size\s*%\}/,
      "full.liquid does not measure the column count"
    );
    assert.ok(
      full.includes("{% if one_line %}"),
      "full.liquid does not branch on the column count"
    );
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

  test("every layout caps the heading marks", () => {
    // A twelve-route complex wraps its bullets onto a second line and, in
    // the smaller layouts, straight through the neighbouring card's
    // heading. Past a few they stop telling a rider anything the station
    // name has not.
    for (const [name, liquid] of layouts) {
      assert.match(
        liquid,
        /\{%\s*for route in card\.b limit: [1-9]\s*%\}/,
        `${name} renders every bullet a card carries`
      );
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
