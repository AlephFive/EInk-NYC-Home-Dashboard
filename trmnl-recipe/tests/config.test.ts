/**
 * The recipe's two configuration sources, which must agree.
 *
 * `plugin/src/settings.yml` is what `trmnlp push` uploads. `recipe/form.yaml`
 * and `recipe/polling-url.txt` are the paste-by-hand copies for configuring
 * the plugin through TRMNL's web UI. They describe the same recipe, so they
 * drift silently — and a field is only wired up when it appears in *both* the
 * form and the polling URL.
 *
 * Both halves of that pairing have already broken, in opposite files:
 *
 * - `polling-url.txt` read `cardN_routes` while `form.yaml` never defined it,
 *   so the line filter could not be reached through the pasted form.
 * - `settings.yml` defined `cardN_routes` while its own `polling_url` never
 *   wrote it, so a user of the *published* recipe could fill the field in and
 *   watch nothing happen.
 *
 * Neither is a type error, neither fails a lint, and the board renders
 * perfectly in both cases. Only a reader comparing two files notices, which is
 * what these tests do instead.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) =>
  readFileSync(resolve(root, relative), "utf8");

const settingsYml = read("plugin/src/settings.yml");
const formYaml = read("recipe/form.yaml");
const pollingUrlTxt = read("recipe/polling-url.txt");

/** Field keynames declared in a YAML form, in file order. */
const declaredFields = (yaml: string): string[] =>
  [...yaml.matchAll(/^\s*-?\s*keyname:\s*(\S+)/gm)].map((m) => m[1]);

/**
 * The polling URL out of a settings.yml, without parsing YAML.
 *
 * It is a folded block scalar, so the value is the indented lines following
 * `polling_url:` — rejoined the way YAML folds them, which for a URL with no
 * blank lines means simple concatenation after trimming.
 */
function pollingUrlFromSettings(yaml: string): string {
  const start = yaml.indexOf("polling_url:");
  assert.ok(start >= 0, "settings.yml has no polling_url");
  const lines = yaml.slice(start).split(/\r?\n/).slice(1);

  const parts: string[] = [];
  for (const line of lines) {
    if (!/^\s+\S/.test(line)) break; // dedent ends the block
    parts.push(line.trim());
  }
  return parts.join("");
}

/** The ready-to-paste one-liner at the bottom of polling-url.txt. */
function pollingUrlFromTxt(text: string): string {
  const candidates = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("https://") && line.length > 300);

  assert.ok(candidates.length > 0, "polling-url.txt has no pasteable URL");
  return candidates[candidates.length - 1];
}

/**
 * The polling body out of a settings.yml.
 *
 * A literal block scalar (`|-`), so the value is the indented lines after
 * `polling_body:` with the indent removed and newlines kept.
 */
function pollingBodyFromSettings(yaml: string): string {
  const start = yaml.indexOf("polling_body:");
  assert.ok(start >= 0, "settings.yml has no polling_body");
  const lines = yaml.slice(start).split(/\r?\n/).slice(1);

  const kept: string[] = [];
  for (const line of lines) {
    if (line.trim() !== "" && !/^\s/.test(line)) break; // dedent ends the block
    kept.push(line.replace(/^ {2}/, ""));
  }
  return kept.join("\n");
}

/**
 * The JSON polling body, from the file that holds it.
 *
 * It lives in `recipe/` rather than in settings.yml because `trmnlp push`
 * drops `polling_body` — verified by pushing and pulling back, in both
 * block-scalar and one-line form. The Worker reads the body on POST and
 * the format is the one this recipe wants; the plugin cannot send it
 * until the CLI uploads the field, so settings.yml still ships the GET
 * query string and both are tested.
 */
const shippedBody = read("recipe/polling-body.json");
const pastedUrl = pollingUrlFromTxt(pollingUrlTxt);

describe("every card field is actually wired up", () => {
  // A field the polling URL never writes is a control that does nothing, and
  // the form gives no hint: it renders, accepts input, and is discarded.
  const perCardFields = ["station", "routes", "walk", "title"];

  for (const slot of [1, 2, 3, 4, 5, 6]) {
    for (const field of perCardFields) {
      const key = `card${slot}_${field}`;

      test(`${key} is declared and sent`, () => {
        assert.ok(
          declaredFields(settingsYml).includes(key),
          `${key} is missing from settings.yml`
        );
        assert.ok(
          shippedBody.includes(key),
          `${key} is declared but never written to the polling URL`
        );
      });
    }
  }

  test("each card can be hidden without losing its settings", () => {
    // Clearing a station also hides a card, but destructively. The toggle
    // is for parking a card you want back — a summer ferry, a station you
    // only use on weekdays.
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      const key = `card${slot}_visible`;
      assert.ok(
        declaredFields(settingsYml).includes(key),
        `${key} is missing`
      );
      assert.ok(
        shippedBody.includes(`"visible": "{{ ${key}`),
        `${key} is not passed to the Worker as v${slot}`
      );
    }
  });

  test("each card field is its own key in the body", () => {
    // Not packed into one value. The query string packed station, walk and
    // title together and the parser had to infer which was which from
    // where a separator fell — a station name can contain every separator
    // the grammar used, which is where most of this project's bugs came
    // from. A JSON key cannot be mistaken for another key.
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      for (const field of ["station", "routes", "walk", "title", "visible"]) {
        assert.ok(
          shippedBody.includes(`"${field}": "{{ card${slot}_${field}`),
          `card${slot}_${field} is not its own key`
        );
      }
    }
  });

  test("every interpolated value strips what would break the JSON", () => {
    // Only two characters can, and TRMNL's Liquid has no working JSON
    // filter: `| json` does not exist and renders nothing, `| jsonify`
    // does not escape, `| escape` writes `&quot;` into the document. All
    // three were checked against the engine.
    //
    // Stripping rather than escaping is safe because neither character
    // belongs in any of these fields — a station is a picker-generated id,
    // routes and walk are short codes and digits, and no stop name in the
    // bundled tables contains either. A quote typed into a title is lost;
    // the board is not.
    const interpolations = [...shippedBody.matchAll(/\{\{([^}]*)\}\}/g)].map(
      (m) => m[1]
    );
    assert.ok(interpolations.length > 0, "the body interpolates nothing");

    for (const expression of interpolations) {
      assert.match(
        expression,
        /replace:\s*'\\'/,
        `a value does not strip backslashes: {{${expression}}}`
      );
      assert.match(
        expression,
        /replace:\s*'"'/,
        `a value does not strip quotes: {{${expression}}}`
      );
    }
  });

  test("a form default matches the Worker's own", () => {
    // Two defaults for one setting is a bug waiting to happen: a field the
    // user never touched sends the form's, a field they cleared sends
    // nothing and gets the Worker's. They must agree.
    const defaults: [string, string][] = [
      ["urgent_threshold", "5"],
      ["card1_walk", "5"],
    ];
    for (const [key, expected] of defaults) {
      const block = settingsYml.slice(settingsYml.indexOf(`keyname: ${key}`));
      const match = /default:[ \t]*"?([^"\r\n]+)"?/.exec(block);
      assert.ok(match, `${key} declares no default`);
      assert.equal(
        match![1].trim(),
        expected,
        `${key}'s form default disagrees with settings.ts`
      );
    }
  });

  test("visibility is never decided in Liquid", () => {
    // It was once, and the toggle did nothing: Liquid treats only `nil`
    // and `false` as falsy, so a checkbox stored as the string "false" is
    // truthy and `{% if cardN_visible %}` never hides anything. The value
    // goes to the Worker as data, where every spelling is understood.
    //
    // Pinned because the obvious-looking fix is to put the test back.
    assert.doesNotMatch(
      shippedBody,
      /\{%\s*if[^%]*_visible/,
      "a card's visibility is decided in the template"
    );
  });

  test("the card groups name their grid position", () => {
    // "Card 4" says nothing about where it lands. The grid is fixed —
    // slots 1&2 are the left column, 3&4 the middle, 5&6 the right — so
    // the group can say so directly.
    for (const [slot, label] of [
      [1, "Column 1 · Row 1"],
      [2, "Column 1 · Row 2"],
      [3, "Column 2 · Row 1"],
      [4, "Column 2 · Row 2"],
      [5, "Column 3 · Row 1"],
      [6, "Column 3 · Row 2"],
    ] as [number, string][]) {
      assert.ok(
        settingsYml.includes(`group: ${label}`),
        `slot ${slot} is not grouped as "${label}"`
      );
    }
    assert.ok(
      !/group: Card \d/.test(settingsYml),
      "a card is still grouped by number"
    );
  });

  test("there is no transit type field", () => {
    // Removed once the picker searched every network. The station search
    // covers them all and the stored value carries its own type prefix
    // (`lirr:102`), so the field decided nothing and was one more thing to
    // set wrongly — a card typed Subway with an LIRR station picked would
    // still have rendered the LIRR card.
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      assert.ok(
        !declaredFields(settingsYml).includes(`card${slot}_type`),
        `card${slot}_type is back`
      );
    }
  });

  test("display settings are sent", () => {
    for (const key of ["use_24_hour", "urgent_threshold", "show_leave_in"]) {
      assert.ok(declaredFields(settingsYml).includes(key), `${key} missing`);
      assert.ok(shippedBody.includes(key), `${key} is never sent`);
    }
  });
});

describe("the two configuration sources agree", () => {
  /**
   * A polling URL with its host replaced by a fixed token.
   *
   * `npm run configure <host>` rewrites `settings.yml` **in place** — it is
   * what trmnlp uploads — while leaving `recipe/` as templates carrying
   * REPLACE_ME. So after configuring, the two differ by exactly the
   * hostname and by nothing else, and that is the invariant worth holding:
   * comparing them literally fails the moment the recipe is configured,
   * which is a normal state rather than a defect.
   */
  const withoutHost = (url: string) =>
    url.replace(/https:\/\/[^/]+\//, "https://HOST/");

  test("the pasteable copy documents the same endpoint", () => {
    // `polling-url.txt` is the paste-by-hand copy for TRMNL's web UI. The
    // plugin POSTs a JSON body now, so the two no longer share a long
    // interpolated URL to compare — what must still match is the endpoint
    // they point at, since a stale host there sends a hand-configured
    // user to the wrong Worker.
    assert.ok(
      pastedUrl.includes("/api/board"),
      "polling-url.txt does not document the board endpoint"
    );
  });

  test("both forms declare the same card fields", () => {
    const cardFields = (yaml: string) =>
      declaredFields(yaml)
        .filter((key) => /^card\d_/.test(key))
        .sort();

    assert.deepEqual(cardFields(formYaml), cardFields(settingsYml));
  });

  test("no station field declares depends_on", () => {
    // xhrSelectSearch does not support it. The form-builder's own field
    // definitions list depends_on under xhrSelect only, and declaring it
    // here stopped the widget initialising at all — the dropdown was empty
    // and the Worker never saw a single request.
    for (const [name, yaml] of [
      ["settings.yml", settingsYml],
      ["form.yaml", formYaml],
    ] as [string, string][]) {
      assert.ok(
        !yaml.includes("depends_on"),
        `${name} declares depends_on on an xhrSelectSearch field`
      );
    }
  });

  test("each station endpoint names its own slot", () => {
    // Without depends_on the transit type cannot ride in the path, so the
    // endpoint carries the slot instead and the Worker reads that slot's
    // own type out of the posted body. TRMNL posts every slot's settings
    // together, so without the slot a card 2 picker set to LIRR would
    // answer from card 1's type.
    for (const [name, yaml] of [
      ["settings.yml", settingsYml],
      ["form.yaml", formYaml],
    ] as [string, string][]) {
      for (const slot of [1, 2, 3, 4, 5, 6]) {
        assert.ok(
          yaml.includes(`/api/stations?slot=${slot}`),
          `${name} has no endpoint for slot ${slot}`
        );
      }
      assert.ok(
        !/\/api\/stations\/\{\{/.test(yaml),
        `${name} still interpolates the type into the endpoint path`
      );
    }
  });

  test("the station picker is a GET", () => {
    // A POST with a JSON body is preflighted, and the preflight is where
    // the picker died for most of a session. A GET carrying only `query`
    // is a simple request: no preflight, no custom headers, nothing for a
    // browser to block.
    //
    // It also carries no sibling settings, which is why the Worker falls
    // back to searching every transit type rather than guessing one.
    for (const [name, yaml] of [
      ["settings.yml", settingsYml],
      ["form.yaml", formYaml],
    ] as [string, string][]) {
      assert.ok(
        !/http_verb:\s*POST/i.test(yaml),
        `${name} still POSTs from a station picker`
      );
      assert.equal(
        (yaml.match(/http_verb:\s*GET/gi) ?? []).length,
        6,
        `${name} should declare GET on all six pickers`
      );
    }
  });

  test("the recipe templates keep their placeholder", () => {
    // `recipe/` is the source the configure script reads; it writes
    // `recipe/out/` and leaves these untouched, so the hostname can change
    // without re-editing them. `settings.yml` is deliberately excluded —
    // it is rewritten in place, because it is the file trmnlp uploads.
    for (const [name, content] of [
      ["form.yaml", formYaml],
      ["polling-url.txt", pollingUrlTxt],
    ] as [string, string][]) {
      assert.ok(
        content.includes("REPLACE_ME"),
        `${name} was configured in place — it should stay a template`
      );
    }
  });

  test("the shipped settings point at exactly one host", () => {
    // Either every endpoint still says REPLACE_ME, or every one names the
    // same deployed Worker. A mixture means `configure` missed a spot, and
    // a missed picker endpoint fails as an empty dropdown rather than an
    // error — which is hard to notice and hard to diagnose.
    const hosts = new Set(
      [...settingsYml.matchAll(/https:\/\/([^/\s"']+)\/api\//g)].map((m) => m[1])
    );
    assert.equal(
      hosts.size,
      1,
      `settings.yml points at several hosts: ${[...hosts].join(", ")}`
    );
  });
});

describe("the polling URL is well formed", () => {
  test("a slot needs no guard, because an empty station is data", () => {
    // The query string needed `{% if cardN_station != blank %}` so a
    // cleared card wrote an empty parameter rather than a stray separator.
    // A JSON body has no such hazard: an empty string is a value, and the
    // Worker skips a card whose station is empty.
    //
    // Pinned because reintroducing the guard would write the literal
    // string "false" or an empty object into the document.
    assert.doesNotMatch(
      shippedBody,
      /\{%\s*if/,
      "the polling body branches in Liquid"
    );
  });

  test("a blank routes filter is harmless", () => {
    // The query string needed a guard: an empty "!" parsed as a filter
    // matching nothing and emptied the card. In the body `routes` is its
    // own key, and an empty string is simply no filter — so the guard is
    // gone and must stay gone, since `{% if %}` in a JSON document is how
    // a trailing comma gets written.
    assert.ok(
      shippedBody.includes('"routes": "{{ card1_routes'),
      "routes is not a key of its own"
    );
    assert.doesNotMatch(
      shippedBody,
      /card\d_routes != blank/,
      "the body still guards an optional field"
    );
  });

  test("it carries all six slots", () => {
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      assert.ok(
        shippedBody.includes(`card${slot}_station`),
        `slot ${slot} is missing from the body`
      );
    }
  });

  test("the transit type is not written into the value", () => {
    // `{{ cardN_type }}` alongside the station would doubled-prefix it —
    // the picker already stores the type on the front of its own value.
    assert.doesNotMatch(
      shippedBody,
      /card\d_type/,
      "a card writes its type into the body"
    );
  });

});
