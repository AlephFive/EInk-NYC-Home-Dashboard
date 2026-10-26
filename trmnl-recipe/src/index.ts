/**
 * The recipe's polling endpoint.
 *
 * TRMNL calls `GET /api/board` on each refresh with the user's form values in
 * the query string, and renders the JSON this returns through the plugin's
 * Liquid template. There is no state: the settings arrive with the request.
 *
 * Phase 1 serves JSON only — the UI is phase 2 (see `docs/TRMNL-RECIPE-SPEC.md`).
 */

import { parseBoardSettings } from "./settings";
import { buildBoard, type BuildEnv } from "./buildBoard";
import { searchStations, parsePickerKind } from "./pickers";

/** TRMNL's payload ceiling; 10KB with TRMNL+. */
const PAYLOAD_CAP_BYTES = 5 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // TRMNL polls server-side, but a browser is how you debug a recipe.
      "access-control-allow-origin": "*",
      // Never serve a cached board: the whole point is live departures.
      "cache-control": "no-store",
    },
  });

/**
 * Serve an `xhrSelectSearch` field.
 *
 * TRMNL POSTs the typed query alongside the form's sibling settings, so the
 * chosen transit type arrives as `settings_custom_fields_values_<keyname>`.
 * GET is accepted too, because that is how you test a picker in a browser.
 */
async function handlePicker(request: Request, url: URL): Promise<Response> {
  let query = url.searchParams.get("query") ?? "";
  let kindValue =
    url.searchParams.get("kind") ??
    url.searchParams.get("transit_type") ??
    undefined;

  if (request.method === "POST") {
    const body = await readBody(request);
    query = String(body.query ?? query ?? "");
    kindValue = pickTransitType(body) ?? kindValue;
  }

  // The bus endpoint is addressed directly by the form's bus slots, so it
  // does not depend on the sibling field arriving.
  const kind =
    url.pathname === "/api/bus-stops"
      ? ("bus" as const)
      : parsePickerKind(kindValue);

  if (!kind) {
    // An unset transit type is the normal state before the user picks one, so
    // this is an empty dropdown rather than an error.
    return json([]);
  }

  try {
    return json(await searchStations(kind, query));
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Search failed" },
      502
    );
  }
}

/** Read a picker request body, whether JSON or form-encoded. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      return (await request.json()) as Record<string, unknown>;
    }
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  } catch {
    // A malformed body is a blank search, not a failure — the dropdown just
    // opens empty.
    return {};
  }
}

/**
 * Find the sibling transit-type field in a picker payload.
 *
 * TRMNL prefixes sibling settings with `settings_custom_fields_values_`, and
 * the slot number varies (`card1_type`..`card6_type`), so the field is matched
 * by suffix rather than by an exact name.
 */
function pickTransitType(body: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(body)) {
    if (key.endsWith("_type") && typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

export default {
  async fetch(request: Request, env: BuildEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/stations" || url.pathname === "/api/bus-stops") {
      return handlePicker(request, url);
    }

    if (url.pathname !== "/api/board") {
      return json({ error: "Not found" }, 404);
    }

    const settings = parseBoardSettings(url);
    const board = await buildBoard(settings, env);
    const body = JSON.stringify(board);
    const bytes = new TextEncoder().encode(body).length;

    // The cap is TRMNL's, and exceeding it silently truncates a user's board,
    // so it is reported rather than discovered in the field. Phase 1 measures;
    // enforcement (trimming lowest-priority rows) comes with the real row
    // counts in phase 2.
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "x-payload-bytes": String(bytes),
      "x-payload-cap-pct": ((bytes / PAYLOAD_CAP_BYTES) * 100).toFixed(1),
    };

    return new Response(body, { status: 200, headers });
  },
};
