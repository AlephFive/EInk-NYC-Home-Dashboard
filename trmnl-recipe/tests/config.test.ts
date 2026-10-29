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

const shippedUrl = pollingUrlFromSettings(settingsYml);
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
          shippedUrl.includes(key),
          `${key} is declared but never written to the polling URL`
        );
      });
    }
  }

  test("the type field drives the form without being sent", () => {
    // Deliberately asymmetric. The picker stores the type on the front of the
    // station value already, so writing it again would produce
    // "subway:subway:721:10" and shift every field along one.
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      const key = `card${slot}_type`;
      assert.ok(declaredFields(settingsYml).includes(key), `${key} missing`);
      assert.ok(
        shippedUrl.includes(`${key} != 'off'`),
        `${key} should guard its slot`
      );
    }
  });

  test("display settings are sent", () => {
    for (const key of ["use_24_hour", "urgent_threshold", "show_leave_in"]) {
      assert.ok(declaredFields(settingsYml).includes(key), `${key} missing`);
      assert.ok(shippedUrl.includes(key), `${key} is never sent`);
    }
  });
});

describe("the two configuration sources agree", () => {
  test("the polling URLs are identical", () => {
    // One is pasted into TRMNL's UI, the other uploaded by trmnlp. A board
    // built from one would differ from the other in ways no test of the
    // Worker could see, because the Worker only ever sees the result.
    assert.equal(pastedUrl, shippedUrl);
  });

  test("both forms declare the same card fields", () => {
    const cardFields = (yaml: string) =>
      declaredFields(yaml)
        .filter((key) => /^card\d_/.test(key))
        .sort();

    assert.deepEqual(cardFields(formYaml), cardFields(settingsYml));
  });

  test("the hostname placeholder is consistent", () => {
    // `npm run configure <host>` rewrites every one. If a file used a
    // different placeholder it would be skipped and ship pointing nowhere.
    const files: [string, string][] = [
      ["settings.yml", settingsYml],
      ["form.yaml", formYaml],
      ["polling-url.txt", pollingUrlTxt],
    ];

    for (const [name, content] of files) {
      assert.ok(
        content.includes("REPLACE_ME"),
        `${name} has no REPLACE_ME — was it configured in place?`
      );
    }
  });
});

describe("the polling URL is well formed", () => {
  test("every slot guards against its Off value", () => {
    // Setting a card to Off does not clear the station it holds, so without
    // the guard the slot keeps rendering the last station picked and the Off
    // option appears to do nothing.
    const guards = shippedUrl.match(/card\d_type != 'off'/g) ?? [];
    assert.equal(guards.length, 6);
  });

  test("the routes filter is optional", () => {
    // Blank must omit the segment entirely rather than send an empty "!",
    // which would parse as a filter matching nothing and empty the card.
    const guards = shippedUrl.match(/card\d_routes != blank/g) ?? [];
    assert.equal(guards.length, 6);
  });

  test("it carries all six slots", () => {
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      assert.ok(
        shippedUrl.includes(`c${slot}=`),
        `slot ${slot} has no parameter`
      );
    }
  });

  test("the transit type is not written into the value", () => {
    // `{{ cardN_type }}` as a value would doubled-prefix the station. The
    // Worker tolerates that, but the URL should not produce it.
    assert.ok(
      !/=\{\{\s*card\d_type\s*\}\}/.test(shippedUrl),
      "a card writes its type into the slot value"
    );
  });
});
