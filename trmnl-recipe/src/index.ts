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
import { searchStations, parsePickerKind, type PickerOption } from "./pickers";

/**
 * What a browser must be told before it will send the picker's POST.
 *
 * The station field runs **in the browser**, not on TRMNL's server, so a
 * cross-origin POST to this Worker is preflighted. Answering that preflight
 * with only `allow-origin` is not enough: the browser also asks whether the
 * headers it intends to send are permitted, and if the answer omits them it
 * cancels the POST.
 *
 * It cancels it *silently* — the dropdown renders empty, the Worker logs
 * nothing but a stray OPTIONS, and both ends look healthy. That is what the
 * empty picker turned out to be, after `depends_on` and the response shape
 * had both been ruled out.
 *
 * `x-csrf-token` is in the list because TRMNL's widget sends one unless the
 * field sets `exclude_csrf_token`.
 */
const CORS_HEADERS = {
  // TRMNL polls server-side, but the picker is a browser XHR, and a browser
  // is also how you debug a recipe.
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-csrf-token",
  // Cache the preflight for a day, so typing in the picker does not pay for
  // a round trip per keystroke.
  "access-control-max-age": "86400",
} as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
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
    kindValue = kindValue ?? pickTransitType(body, url.searchParams.get("slot"));
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
    return json((await searchStations(kind, query)).map(toSearchOption));
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Search failed" },
      502
    );
  }
}

/**
 * One option, in the shape `xhrSelectSearch` expects.
 *
 * The two XHR field types disagree, and the difference is silent:
 *
 *   xhrSelect        [{ "Braves": 123 }]                label -> value
 *   xhrSelectSearch  [{ id: "...", name: "..." }]       objects
 *
 * We returned the first for a field declared as the second, so the widget
 * received options it could not read and rendered an empty dropdown — with
 * no error anywhere, because the request succeeded.
 *
 * The pickers keep producing label->value pairs, which is the natural shape
 * for a lookup and what the tests assert against; the conversion happens
 * here, at the one point where the format is TRMNL's business.
 */
function toSearchOption(option: PickerOption): { id: string; name: string } {
  const [[name, id]] = Object.entries(option);
  return { id, name };
}

/** `/api/stations/subway` -> "subway". Undefined when the path carries none. */
function pathKind(pathname: string): string | undefined {
  const match = /^\/api\/stations\/([^/]+)\/?$/.exec(pathname);
  if (!match) return undefined;

  const segment = decodeURIComponent(match[1]);

  // An un-interpolated Liquid tag, which is what arrives when TRMNL does not
  // substitute `{{cardN_type}}` into the endpoint — because `depends_on`
  // requires an `xhrSelect` parent and ours is a plain `select`, so the
  // reference is silently cleared.
  //
  // Returning the literal here is worse than returning nothing: it is
  // truthy, so it short-circuits the `??` chain that would otherwise read
  // the type out of the posted body, and the picker answers with an empty
  // list. That is exactly the empty dropdown seen on the real plugin.
  if (segment.includes("{{") || segment.includes("}}")) return undefined;

  return segment;
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
function pickTransitType(
  body: Record<string, unknown>,
  slot?: string | null
): string | undefined {
  // The asking slot, when the endpoint says which one it is. TRMNL posts
  // every slot's settings together, so without this a card 2 picker set to
  // LIRR would answer from card 1's transit type — the board's first card
  // decides what every other card searches.
  if (slot) {
    const own = body[`card${slot}_type`];
    if (typeof own === "string" && own.trim()) return own;
    // The slot is known and its type is unset: the user has not chosen one
    // yet, so an empty dropdown is the honest answer rather than falling
    // back to a neighbour's type.
    return undefined;
  }

  for (const [key, value] of Object.entries(body)) {
    if (key.endsWith("_type") && typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

/**
 * How long a built demo board may be reused.
 *
 * The demo is the only board many users share: every unconfigured install and
 * the public store preview request it with the same empty query, so one build
 * serves all of them. Caching *user* boards is not possible — two users share
 * a key only if they picked identical stations and identical walk times, and
 * walk time is personal by definition.
 *
 * 60s, comfortably under the 15-minute poll interval, so a demo board is at
 * most a minute stale while still collapsing a burst of store-preview traffic
 * into one build. Short enough that the "live data only" rule still holds: a
 * minute-old subway departure is a minute-old departure, not a timetable.
 *
 * Worth more than it looks. Building a board costs ~3-10ms of CPU against a
 * 10ms budget; serving a cached one costs ~0.02ms to parse a few KB. Caching
 * raw feed bytes, by contrast, saves only the fetch — which is I/O and is not
 * billed as CPU — because the protobuf still has to be decoded on every hit.
 * See spec 7.2.
 *
 * **This does nothing on a `*.workers.dev` deployment.** Cloudflare's cache is
 * zone-level, and workers.dev is one zone shared by every account, so
 * `caches.default` there is a documented silent no-op: `put` resolves, `match`
 * never hits, and nothing errors. Verified in production — five consecutive
 * polls to the same colo all reported a miss, while the identical code hits on
 * the first retry under `wrangler dev`.
 *
 * It starts working the moment the Worker is served from a custom domain,
 * which is on the list for store submission anyway. Until then the code is
 * correct and inert, and `x-board-cache` says `unavailable` rather than
 * `miss` so the difference is visible rather than mysterious.
 */
const DEMO_CACHE_SECONDS = 60;

/** The cache entry for the demo board. Keyed on a URL, as the Cache API requires. */
const DEMO_CACHE_KEY = "https://board.invalid/demo";

export default {
  async fetch(
    request: Request,
    env: BuildEnv,
    ctx?: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Answer the preflight before anything else, and for every path — a
    // browser sends it to whatever URL the field holds, including a stale
    // one from a previous push. 204 with no body is the conventional
    // answer; the headers are the whole point of the response.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

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

    const settings = parseBoardSettings(url);

    // The demo board is the same for everyone who has not configured a card,
    // so it is built once and reused. `caches` is absent outside the Workers
    // runtime (tests, `node --test`), hence the guard rather than a bare call.
    const cache = typeof caches !== "undefined" ? caches.default : undefined;
    // workers.dev cannot cache (see DEMO_CACHE_SECONDS), so a miss there is
    // not a cache that failed — it is a cache that was never available.
    const cacheUsable = cache !== undefined && !url.hostname.endsWith(".workers.dev");
    if (settings.isDemo && cacheUsable) {
      const hit = await cache!.match(DEMO_CACHE_KEY);
      if (hit) {
        const headers = new Headers(hit.headers);
        headers.set("x-board-cache", "hit");
        return new Response(hit.body, { status: 200, headers });
      }
    }

    // `buildBoard` catches per card and is not supposed to reject, but the
    // whole design rule is that nothing blanks the board — and a Worker
    // exception renders as nothing at all, since the Liquid template never
    // runs. So the invariant is enforced here rather than trusted.
    let board: Board;
    try {
      board = await buildBoard(settings, env);
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

    // Only a *complete* demo board is worth storing. A board carrying a card
    // error is a transient upstream failure, and caching it would pin that
    // failure in front of every new installer for the full TTL.
    const complete = board.c.every((card) => card.e === undefined);
    if (settings.isDemo && cacheUsable && complete) {
      const stored = new Response(body, {
        status: 200,
        headers: {
          ...headers,
          "cache-control": `max-age=${DEMO_CACHE_SECONDS}`,
        },
      });
      // Handed to waitUntil so the write finishes after the response is
      // sent. A bare `void cache.put(...)` is not enough: the runtime may
      // cancel pending work once the handler returns, so the entry is never
      // stored and every request reports a miss — which is exactly what the
      // first version of this did.
      if (ctx) {
        ctx.waitUntil(cache!.put(DEMO_CACHE_KEY, stored));
      } else {
        await cache!.put(DEMO_CACHE_KEY, stored);
      }
    }

    headers["x-board-cache"] = !settings.isDemo
      ? "bypass"
      : cacheUsable
        ? "miss"
        : "unavailable";
    return new Response(body, { status: 200, headers });
  },
};
