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
import { buildBoard, type BuildEnv, type Board } from "./buildBoard";
import {
  PAYLOAD_CAP_BYTES,
  payloadBytes,
  trimToPayloadCap,
} from "./payload";
import { searchStations, parsePickerKind } from "./pickers";

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
  // The transit type can arrive three ways, because `depends_on` can
  // interpolate the parent field into either the path or the query string,
  // and TRMNL also posts sibling settings in the body.
  let kindValue =
    pathKind(url.pathname) ??
    url.searchParams.get("kind") ??
    url.searchParams.get("transit_type") ??
    undefined;

  if (request.method === "POST") {
    const body = await readBody(request);
    query = String(body.query ?? query ?? "");
    // The path wins. TRMNL posts *every* sibling setting, so the body carries
    // all six slots' types — and picking "the first key ending _type" out of
    // them returns card 1's type no matter which slot's picker is open. The
    // path segment comes from this field's own `depends_on` interpolation, so
    // it is the only one that identifies the right slot.
    kindValue = kindValue ?? pickTransitType(body);
  }

  // `/api/bus-stops` is an alias for `/api/stations/bus`, kept because the
  // spec names it and because it needs no transit type to be passed at all.
  // The form uses the path-interpolated form for every slot, so both routes
  // reach the same search.
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

/** `/api/stations/subway` -> "subway". Undefined when the path carries none. */
function pathKind(pathname: string): string | undefined {
  const match = /^\/api\/stations\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
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
 * Find a transit-type field in a picker payload.
 *
 * Only a fallback for when the path carries no type — a hand-made request, or
 * a form whose endpoint omits the interpolation. TRMNL posts every slot's
 * settings, so this cannot tell which slot asked; the path can.
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

    if (
      url.pathname === "/api/stations" ||
      url.pathname.startsWith("/api/stations/") ||
      url.pathname === "/api/bus-stops"
    ) {
      return handlePicker(request, url);
    }

    if (url.pathname !== "/api/board") {
      return json({ error: "Not found" }, 404);
    }

    // `buildBoard` catches per card and is not supposed to reject, but the
    // whole design rule is that nothing blanks the board — and a Worker
    // exception renders as nothing at all, since the Liquid template never
    // runs. So the invariant is enforced here rather than trusted.
    let board: Board;
    try {
      board = await buildBoard(parseBoardSettings(url), env);
    } catch (err) {
      board = {
        t: new Date().toISOString(),
        c: [
          {
            s: 1,
            y: "error",
            n: "Transit board",
            e: err instanceof Error ? err.message : "Unknown error",
          },
        ],
      };
    }

    // Trim before serialising if the board would exceed what TRMNL stores.
    // Raising the per-card row count so the panel can decide what fits made
    // this reachable: six busy subway cards measured at 90% of the cap, and
    // going over does not fail loudly — TRMNL truncates, so the panel would
    // simply render a board missing its last cards.
    //
    // Rows are dropped from the end of the longest column first, so the trim
    // costs the departures furthest in the future and every card keeps its
    // soonest ones.
    trimToPayloadCap(board, PAYLOAD_CAP_BYTES);

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
