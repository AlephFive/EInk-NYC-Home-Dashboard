# The server: architecture, and what is wrong with it

A review of `trmnl-recipe/src/` — the Cloudflare Worker behind the TRMNL
recipe. Written 2026-10-28, against the code as it stands on `phase2-layout`.

Every claim here is measured or quoted from the source. Where a judgement is
mine rather than a measurement, it says so.

---

## 1. What it is

1,182 lines across four modules, plus 1,819 lines of transit logic shared with
the dashboard.

| Module | Lines | Job |
|---|---|---|
| `buildBoard.ts` | 451 | Fetch feeds, build cards, assemble the board |
| `pickers.ts` | 274 | Station search for the form's dropdowns |
| `index.ts` | 240 | HTTP: routing, payload cap, error boundary |
| `settings.ts` | 217 | Parse a board out of query parameters |

### The dependency graph is clean

```
settings.ts  ──▶  buildBoard.ts  ──▶  index.ts
                                      ▲
pickers.ts  ──────────────────────────┘
```

Acyclic, one direction, no module reaching across. `pickers.ts` imports
nothing local at all — it is a leaf, which is right for a module that only
answers search queries.

### The request path

```
GET /api/board?c1=…&c2=…
   │
   ├─ parseBoardSettings()        settings.ts — query string to a typed board
   │     └─ demo board when nothing is configured
   │
   ├─ buildBoard()                buildBoard.ts
   │     ├─ per-card, concurrently:
   │     │     subwayCard / railroadCard / busCard / ferryCard
   │     │        └─ sharedFeed()  one fetch+decode per feed per request
   │     │        └─ trainRows() / busRows()   ← shared with the dashboard
   │     └─ each card catches its own failures
   │
   ├─ trimToPayloadCap()          index.ts — drop rows until under 5KB
   └─ JSON, with x-payload-bytes for observability
```

---

## 2. What is good, with evidence

**Error isolation is real, not aspirational.** Every card builder has exactly
one `try`/`catch` and all four return the same `BoardCard` shape whether they
succeed or fail. Verified against a deliberately broken board: a retired bus
stop, an unknown subway stop and a malformed slot each failed alone while the
rest rendered.

**The card builders are not copy-paste.** They look parallel, and the obvious
review instinct is to collapse them into one generic builder. Measured, only
**4 lines appear in three or more of the four** — the signature, the `base`
literal and the catch. The bodies differ because the feeds genuinely differ:
subway needs two direction columns and a feed derived from the station's
routes; railroad needs one list and a railroad tag because LIRR and
Metro-North reuse stop IDs; bus needs one request per stop and per-stop
catching. A generic builder would be a parameter bag, not a simplification.

**No `any`, anywhere.** Zero occurrences across all four modules.

**The HTTP layer is thin.** `index.ts` routes, enforces the payload cap, and
holds the outer error boundary. It contains no transit logic.

**The shared boundary is honest.** The Worker imports eight dashboard modules
and two JSON files. None of them import React — three mention it only in
comments. That boundary was extracted deliberately in phase 1 and has held.

**It is genuinely stateless.** Settings arrive per request; nothing persists.
That is what makes the Worker cheap to reason about: the only correctness
question is "did the feed answer?"

---

## 3. What is wrong

Ordered by what I would actually fix, not by severity in the abstract.

### 3.1 ~~There are no tests~~ — **fixed, 81 of them**

`npm test` now runs 81 tests across four files, using Node's built-in runner
with no new dependency. They caught one real bug immediately: a query string
decodes a literal `+` as a space, so `subway:127+725` could arrive as
`subway:127 725` and collapse a five-platform complex into one unusable ID.
Whether TRMNL percent-encodes the interpolated value is not under our
control, so the parser now accepts both separators.

| File | Covers |
|---|---|
| `settings.test.ts` | 35 — slot parsing, aliases, the doubled prefix, bad slots, walk times, the demo board |
| `transit.test.ts` | 26 — multi-line stations, complexes, express variants, boardability, ID collisions, city-bound |
| `bus.test.ts` | 10 — stop pairing, the `valid_to` filter, picker grouping |
| `payload.test.ts` | 10 — the trim loop, including degenerate input |

The transit tests are the interesting ones. Each encodes a fact that, if
forgotten, produces a board which looks fine and is wrong: Coney Island
serving four lines on one ID, Times Square being five IDs under one complex,
LIRR stop 1 being Albertson while Metro-North stop 1 is Grand Central, `7X`
being the 7 running express rather than a separate route.

Extracting `trimToPayloadCap` into `src/payload.ts` was needed to test it —
importing `index.ts` would have started a Worker. That is better structure
anyway: how big a board may be is a property of the board, not of the request
that asked for it.

**What is still untested:** the feed-fetching paths in `buildBoard.ts`. They
need recorded protobuf fixtures, which is real work for less value — those
paths are exercised by every render and every smoke test.

The original finding stands as the reason this mattered:

Everything has been verified by **rendering and looking**, which worked
because a transit board is visual. But it only catches what is on screen in
the fixture being used, and that failure has already happened repeatedly on
this project:

- A destination-suppression rule was built against Vernon Blvd, which is the
  7 only and does not branch. It was wrong for every branching station;
  southbound at Jay St-MetroTech is three routes and five terminals.
- `flex--1` was used 13 times across four layouts without existing.
- Direction columns were stacked instead of side by side, so every subway
  card silently showed one direction. Caught by a human looking at a
  screenshot.

**None of those were in the server** — which is the interesting part. The
server's defect rate has been low. But that is partly because the server is
exercised by every render, and partly luck. The untested parts of it are the
parts no fixture reaches: the trim loop, the demo-board substitution, the
picker's `valid_to` boundary, the settings parser's edge cases.

*Worth fixing: yes.* `trmnlp test` exists and runs RSpec; a plain Node test
runner over `settings.ts` and `trimToPayloadCap` would cost an afternoon and
cover the pure logic. The impure parts (feed fetching) need fixtures, which is
more work and lower value.

### 3.2 `sharedFeed` is type-unsound

```ts
type FeedCache = Map<string, Promise<unknown>>;
if (existing) return existing as Promise<T>;
```

The cast is unchecked. Two callers using the same key with different `T` would
compile and fail at runtime. Today the keys are namespaced — `subway:…` and
`railroad:…` — so a collision needs a separate bug, but **nothing enforces
that**; it is a convention in two string literals forty lines apart.

*Worth fixing: yes, cheaply.* **Done** — the cache is now two typed maps, one
per feed family, with the shapes derived via `Awaited<ReturnType<…>>` so they
cannot drift from the fetchers. The cast is gone and `sharedFeed` is generic
over a correctly-typed map. Verified: two LIRR cards and two subway cards
still share their feeds.

### 3.3 `trimToPayloadCap` is O(n²)

It calls `JSON.stringify(board)` on every pass and drops one row per pass. At
the measured worst case that is ~40 serialisations of a ~5KB board — about
200KB of serialisation to shed 40 rows.

Trivial at this scale, and CPU is the Worker's binding constraint, so it is
not free either. The shape is the problem more than the number: it is the kind
of loop that is fine until a board gets large and then is not.

*Worth fixing: not yet.* Estimating bytes-per-row and dropping a batch would
make it O(n), but the current version is obviously correct and the measured
cost is noise. Revisit if the row budget ever rises.

### 3.4 Routing is an if-else chain

```ts
if (url.pathname === "/health") …
if (url.pathname === "/api/stations" || url.pathname.startsWith("/api/stations/") || …) …
if (url.pathname !== "/api/board") …
```

Five pathname comparisons in one handler, with the board as the fall-through.
Adding a route means adding a branch in the right place.

*Worth fixing: no.* Four endpoints does not need a router. Reaching for Hono
or itty-router here would add a dependency and a bundle to save three `if`s.
Revisit at a dozen routes.

### 3.5 The shared row type carries a React field

`DepartureRowData.key` exists for React's reconciliation. The Worker computes
it — including a `getTime()` call per bus row — and then discards it in
`toBoardRow`.

*Worth fixing: marginally.* It is one wasted field per row and a comment that
says "React" in a module the Worker also uses. Making `key` optional, or
having the dashboard derive it at render time, is tidier. Low value.

### 3.6 Card builders take four positional parameters

`subwayCard(card, rowOptions, feeds)` and `busCard(card, rowOptions, feeds,
env)` differ in arity, so the signatures are not uniform even though the
return type is.

*Worth fixing: no.* Three or four parameters is not a smell at this size, and
an options object would obscure which builders need `env`.

---

## 4. The thing a review would get wrong

The instinct on seeing four near-identical card builders is to unify them.
**Don't.** The measurement is in §2: four shared lines out of 229. What looks
like duplication is four genuinely different fetch-and-shape problems that
happen to produce the same output type — which is the *point* of the uniform
`BoardCard` contract, not evidence against it.

Unifying them would mean a `switch` on transit type inside one function, or a
config object describing how each type fetches. Both are harder to read than
four named functions, and both make the per-type comments — which carry real
MTA knowledge, like LIRR and Metro-North reusing stop IDs — homeless.

---

## 5. Verdict

**Maintainable:** yes, with the test gap as the real caveat. The modules are
small, the graph is acyclic, and the comments carry the domain knowledge that
would otherwise be lost.

**Readable:** yes. The largest module is 451 lines with 11 top-level
functions, the longest of which is 70 lines.

**Well structured:** yes for its size. The layering is right and the HTTP
layer is thin. The routing and parameter-shape criticisms are the kind that
only become true later.

**Optimised:** adequately. Feeds are shared per request, the payload is 34% of
cap on a typical board, and decode was measured rather than assumed. The
O(n²) trim and the unbuilt cross-request cache are both known and both
deliberately deferred — see the spec's §7.2 for the caching reasoning.

**Best practices:** mostly. The significant deviation is the absence of tests,
which is a real gap rather than a stylistic one.

### If I were to spend one day on it

1. ~~Tests for `settings.ts` and `trimToPayloadCap`.~~ **Done — 81 tests,
   see §3.1.** They found a real bug on the first run.
2. ~~Remove the `sharedFeed` cast.~~ **Done, see §3.2.**
3. Leave everything else alone.

Items 3.3 through 3.6 remain defensible as-is.

Items 3.3 through 3.6 are all defensible as-is, and changing them would be
churn rather than improvement.
