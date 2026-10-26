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

export default {
  async fetch(request: Request, env: BuildEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true });
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
