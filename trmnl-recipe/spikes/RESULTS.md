# Phase 1, step 1 — Worker CPU spike

Run 2026-10-26 against live MTA feeds, Node 24 on Windows.
Reproduce with `spikes/decodeCost.ts`.

## Question

Cloudflare Workers' **free plan allows 10ms of CPU per request**
([limits](https://developers.cloudflare.com/workers/platform/limits/)). Fetching
the feeds is I/O and is not billed as CPU; decoding protobuf is. Does decode fit?

## Result: no, not reliably on the free tier

| Case | Feeds | Bytes | Decode | vs. 10ms free tier |
|---|---|---|---|---|
| Cold (first call in a fresh isolate) | 3 | 318KB | **14.90ms** | **exceeds** |
| Warm, median of 20 | 3 | 318KB | 5.59ms | fits, 56% of budget |
| Warm, worst of 20 | 3 | 318KB | 9.26ms | fits, 93% of budget |
| Warm, all 8 feeds, median | 8 | 983KB | **13.52ms** | **exceeds** |
| Warm, all 8 feeds, worst | 8 | 983KB | **15.70ms** | **exceeds** |

Per-feed, warm:

| Feed | Bytes | Decode |
|---|---|---|
| subway `a_division` (1-7, S) | 215KB | 3.95ms |
| lirr | 92KB | 1.24ms |
| subway `g` | 19KB | 0.25ms |

**Decode cost scales with feed size**, so the bill depends on which stations a
user picks — not on a fixed board size. That is what rules the free tier out:
the cost is user-controlled and unbounded up to 8 feeds.

Three failure modes, any one of which is disqualifying for a public plugin:

1. **Cold start exceeds the budget outright** (14.90ms). A Worker isolate that
   has gone cold pays this, and under low per-user traffic — one poll every 15
   minutes — cold is the common case, not the rare one.
2. **A six-card board spanning many feeds exceeds it even warm** (13.52ms).
3. **The 3-feed warm worst case is 9.26ms**, 93% of budget, before any of the
   filtering, lookup and serialisation work the endpoint still has to do.

## Decision

**Cloudflare Workers paid plan, $5/month.** At 50ms the worst measured case
(15.70ms) uses 31% of budget, leaving room for the rest of the request.

This is a change from the spec, which assumed free-tier Workers. The cost
section's conclusion — "$0/month" — does not survive this measurement.

### Alternatives considered

- **Free tier with caching.** Cache decoded feeds in KV so most requests skip
  decode. Does not fix cold start, adds a cache layer to a stateless design,
  and KV writes have their own free-tier limits. Rejected as complexity that
  buys an unreliable result.
- **Decode only the needed entities.** GTFS-RT is a single `FeedMessage` with
  entities nested inside; there is no documented way to decode a subset without
  parsing the message. Would mean hand-writing a partial parser — a large,
  fragile change to the most correctness-critical code in the project.
- **A different host.** Deno Deploy, Fly.io, a small VPS. All viable; all cost
  about the same or more, and Workers' free tier was the only reason to prefer
  it. Worth revisiting only if $5/month is itself the blocker.

### What this does not change

Everything else in the architecture holds. The payload measurements
(1,853 bytes compact) are unaffected, the endpoint design is unaffected, and
the decode work itself is comfortably fast in absolute terms — 5.59ms to parse
318KB is not slow, it is simply more than a 10ms budget shared with real work.

---

# Phase 1, step 3 — `/api/board` against live feeds

Run 2026-10-26. Reproduce with `spikes/boardHarness.ts`.

## Result: works end to end

The current dashboard board, expressed as a TRMNL polling URL
(`c1=subway:721:10&c2=subway:G24:15&c3=bus:505506:3&c4=lirr:118:5&c5=lirr:349:20`):

| | |
|---|---|
| Cards built | 5 of 5 |
| Rows | 37 |
| Build time | 212ms (fetch-dominated) |
| **Payload** | **1,756 bytes = 34.3% of the 5KB cap** |

That lands within 6% of the 1,853 bytes estimated in step 1, so the payload
budget holds against real data rather than a hand-built sample. Output matches
the live panel: same stations, same destinations, same urgency marks.

## Error isolation verified

Deliberately broken board — a retired bus stop, an unknown subway stop, and a
malformed slot:

```
[1] Vernon Blvd-Jackson Av     10 rows
[2] Bus Stop 700748            ERROR: Bus stop 700748: No such stop: MTA NYCT_700748...
[3] Grand Central              10 rows
[4] Stop NOPE                  ERROR: At least one train line must be specified
```

- **A retired stop fails its own card.** `700748` is the ID that silently broke
  the real bus card when the MTA re-IDed it; here it reports the SIRI error and
  the other three cards still render.
- **An unknown subway stop fails safely.** `getSubwayRoutes("NOPE")` returns
  nothing, so no feed is requested and the card reports it. Preventing this is
  the picker's job (step 4); failing cleanly is this layer's.
- **A malformed slot is dropped at parse time** rather than failing the board —
  `bus::3` carries no stop ID, so it never becomes a card.

## Decoupling done

Three couplings had to be broken before any of the dashboard's modules could
run off-Vite. All three are improvements in their own right:

| Was | Now |
|---|---|
| `departures.ts` read `displayConfig` directly | Takes `DisplaySettings`, defaulting to `displayConfig` |
| `fetchBusData.ts` read `import.meta.env.VITE_MTA_API_KEY` | Takes the key as an argument, defaulting to the Vite env |
| `stationLookup.ts` imported `.geojson` via a Vite plugin | Imports `stations.json`, generated by `npm run gen:stations` |

The last one also shrank the dashboard bundle from **709KB to 450KB**
(gzip 132KB to 108KB), because the pruned station table is a quarter the size
of the GeoJSON it replaced. The 500KB chunk warning is gone.

---

# Phase 1, step 4 — picker endpoints

Run 2026-10-26, verified both off-Worker (`spikes/pickerHarness.ts`) and in
`wrangler dev`, which is the first time this code ran in workerd rather than
Node.

## Station search

| Query | Result |
|---|---|
| subway "times sq" | `Times Sq-42 St (1/2/3/7/S/N/Q/R/W/A/C/E)` -> `subway:127+725+902+A27+R16` |
| subway "port authority" | the same single option |
| subway "coney" | `Coney Island-Stillwell Av (D/F/N/Q)` -> `subway:D43` |
| lirr "grand central" | `lirr:349` |
| mtn "grand central" | `mtn:1` |
| bus "borden" | 8 corners, each carrying every direction's ID |

- **Complexes collapse to one option.** All 35 multi-stop complexes are offered
  as a single entry carrying every platform group, so picking "Times Sq" shows
  the 3 *and* the A rather than silently showing only the 1/2/3. Searching
  "port authority" finds it even though only `A27` carries that name.
- **LIRR and Metro-North stay separate.** Both railroads have a "Grand Central"
  at different IDs (349 and 1); the two tables are never merged.
- **Bus corners group by name**, so one option yields both direction IDs — the
  two-column bus card, without the user knowing stop IDs exist.

## The `valid_to` filter, proven

```
# unfiltered — the stop that silently broke the real board is offered
$where=stop_id='700748'
  -> [{"stop_id":"700748","stop_name":"BORDEN AV/CENTER BLVD",
       "valid_from":"2025-10-22...","valid_to":"2025-12-15..."}]

# filtered
$where=stop_id='700748' AND valid_to > '2026-10-26...'
  -> []
```

Without the filter a user searching "borden" would be offered `700748` — the
exact retired ID that broke this board — and get a permanently failing card.

## Verified in workerd

`wrangler dev` served every endpoint against live feeds:

| Endpoint | Result |
|---|---|
| `/health` | `{"ok":true}` |
| `/api/board` (5 cards) | 1,810 bytes, **35.4% of cap** |
| `/api/stations` GET | works |
| `/api/stations` POST, JSON | works, reads TRMNL's sibling `*_type` field |
| `/api/stations` POST, form-encoded | works |
| `/api/bus-stops` | works, live |
| no transit type chosen | `[]` — an empty dropdown, not an error |

**Round-trip verified**: a picker's own output pasted into a board slot builds
that card. The Times Sq complex returns both the 3 and the A; a bus corner
returns two direction columns.

## Bug found by the round-trip

A user-picked bus stop headed its card **"Bus Stop 505507"**. `getBusStopInfo()`
reads `staticData/bus/route_info.json`, a hand-maintained map holding exactly
one entry — fine for a fixed personal board, useless when users pick their own
stops, which is the entire point of the recipe.

Fixed by carrying the name in the stored value (`bus:<ids>@<name>`), since the
picker already knows it. No table to maintain, and it cannot go stale. An
explicit card title still overrides it.

---

# Phase 1, step 5 — the form

Run 2026-10-26. Artefacts in `../recipe/`: `form.yaml`, `polling-url.txt`,
`markup-debug.liquid`, `SETUP.md`.

27 fields: six slots of four (type, station, walk time, title), plus three
display settings. Validated as YAML, all keynames unique, every field carrying
the required `keyname`/`field_type`/`name`.

## Two bugs caught before the device

**1. `Off:` is not a string in YAML.** The transit-type select read

```yaml
options:
  - Off: 'off'
```

which YAML 1.1 parses as the *boolean* `false`, so the option's label would
have rendered wrong. Quoted to `'Off'`. The same trap waits on `On`, `Yes` and
`No`.

**2. The polling URL duplicated the transit type.** The obvious template is

```
c1={{ card1_type }}:{{ card1_station }}:{{ card1_walk }}
```

but the picker already stores the type on the front of the station value, so
that yields `subway:subway:127+725:10` — and every field shifts one place,
making the stop IDs parse as the walk time. The URL now writes only
`{{ cardN_station }}`, and `parseCard` tolerates the doubled form anyway, since
getting it wrong silently produces a board that looks configured but is not.

## Verified against the running Worker

| Case | Result |
|---|---|
| De-duplicated slot (what the URL emits) | 3 cards, correct names |
| Doubled `type:type:ids` form | parses, same cards |
| Slots left Off (`c2=::`, `c3=off:::`, `c4=`) | skipped, no error |
| Custom title | overrides the picked station name |

## The whole pipeline rendered

`markup-debug.liquid` run against a real endpoint response, via liquidjs:

```
slot 1  subway  "Vernon Blvd-Jackson Av"  bullets: 7
  [Outbound]  5 rows
    7 | Flushing-Main St | 16:15 *URGENT
  [Manhattan]  5 rows
    7 | 34 St-Hudson Yards | 16:14 *URGENT
slot 2  bus  "BORDEN AV/5 ST"
  [(no heading)]  5 rows
    Q101 | STEINWAY via STEINWAY ST | 16:12 *URGENT
```

Settings -> Worker -> JSON -> Liquid -> readable text, end to end. The bus card
shows both directions, urgency marks survive, and the picker's stop name heads
the card.

---

# Review pass — bugs found and fixed

A `/code-review high` pass over the branch, plus a manual audit, on
2026-10-26. Eight real defects; all fixed and re-verified against `wrangler
dev` and the live panel.

## 1. Every departure time would have been wrong by 4 hours

`formatClockTime` called `toLocaleTimeString([], ...)` with no `timeZone`, so
times rendered in *the runtime's* zone. A deployed Cloudflare Worker runs in
**UTC**, so 16:22 would have shown as 20:22 on the device.

The trap is that `wrangler dev --local` inherits the developer's zone, so
local testing shows correct times and the fault appears only once deployed.
Verified: same instant, `TZ=UTC` renders `20:10`, `TZ=America/New_York`
renders `16:10`.

Fixed by pinning `timeZone` through `DisplaySettings`, defaulting to
`America/New_York` — the network this board reports on is in one zone. The
locale is pinned to `en-GB` at the same time, confirmed to produce identical
output to the previous host default in both 12- and 24-hour modes, so the
panel is unchanged.

The same UTC assumption affected the picker's `valid_to` cutoff, which used
`toISOString()`: for the hours after local midnight it read as tomorrow and
would have excluded a stop a day before it retired. Now computed with
`toLocaleDateString("en-CA", { timeZone })`.

## 2. The station picker searched the wrong dataset

The picker let the POST body override the path. TRMNL posts *every* slot's
settings, and `pickTransitType` takes the first key ending `_type` — so
editing card 4's bus picker while card 1 was subway searched **subway**
stations. The path segment comes from the field's own `depends_on`
interpolation and is the only source that identifies the right slot, so it now
wins; the body is a fallback.

## 3. One dead bus stop blanked both directions

`Promise.all(...).catch(...)` attributed any stop's failure to the whole card.
A corner is always two IDs and the MTA retires them one at a time, so a single
re-IDed direction discarded the working one. The dashboard catches per stop
(`loadTransitData.ts`) precisely for this. Now each stop is caught
individually; the card errors only when every stop failed.

Verified: `505506+700748` (one live, one retired) now returns the live
direction's rows instead of an empty errored card.

## 4. A running direction could vanish from a subway card

The terminal collapse filtered on `column.r.length > 0` — rows *after*
walk-time filtering. A direction whose trains were all inside the walk time was
dropped entirely, telling the rider that direction does not exist. The
dashboard tests `trains.some(isBoardable)`, which asks whether the direction
*runs*, and that distinction is the "empty is not an error" rule: an empty
column is a fact about now, a missing column is a claim about the service.

Verified: a 600-minute walk time keeps both columns (empty); Flushing-Main St
still collapses to one.

## 5. "Off" did not hide a card

Setting a slot to Off does not clear the station it already holds, and the
polling URL wrote the station unconditionally — so an Off card kept rendering
its last station. The URL now guards each parameter with
`{% if cardN_type != 'off' %}`, verified through liquidjs.

## 6. Each card fetched and decoded its own feed

Two LIRR cards decoded the same 92KB feed twice; two subway cards on one feed
decoded 215KB twice. On a runtime where CPU is the binding constraint (see the
step 1 spike) that is the most expensive thing the Worker does. Feeds are now
fetched once per request and shared across cards by a promise cache.

## 7. No outer error handling on `/api/board`

`buildBoard` catches per card and is not supposed to reject, but an unexpected
throw returned a bare Worker exception — the Liquid template never runs, so the
panel renders nothing. The whole design rule is that nothing blanks the board,
so the invariant is now enforced rather than trusted.

## 8. SoQL `like` wildcards passed through unescaped

Quotes were doubled, so no injection — `x' OR '1'='1` correctly returns zero
results. But `%` and `_` reached the `like` pattern, so "100%" matched every
stop beginning "100". Now escaped.

## Also addressed

- A dead `failures` branch in `railroadCard` that could never fire, removed
  with the feed-sharing rewrite.
- `subwayLinesFor` computed twice per card; hoisted.
- Subway direction order inverted relative to the dashboard; now south-first,
  so the two surfaces render the same board.
- A dead `standalone` branch in the picker: all 496 stations carry a
  `complex_id`, so grouping by it already covers singletons.
- Ferry rendered a silently empty card. It is disabled, so it now says so —
  an empty card would read as "no boats due".

## Regression suite

| Case | Result |
|---|---|
| normal subway | 2 cols, 10 rows |
| terminal | collapses to 1 col |
| unreachable (600m walk) | both cols kept, 0 rows |
| bus: 1 dead + 1 live stop | live direction survives |
| bus: all stops dead | card errors |
| two LIRR / two subway cards | shared feed, both render |
| ferry | explicit error |
| unknown stop | card errors alone |
| all slots off | empty board, no error |
| doubled `type:type:` form | parses |
| no parameters | empty board, no error |

Dashboard re-verified after the shared-code changes: lint and build clean, the
panel renders all five cards with correct NY times and no console errors.

---

# The free tier works — the step 1 spike was wrong

Measured 2026-10-26 against a real deployment on the **Workers free plan**.
The hostname is deliberately not recorded here: a workers.dev subdomain is
derived from the account, and this repo is headed for public release.

| Test | Result |
|---|---|
| Smoke test, 9 checks | all pass |
| 8 rapid warm requests | all 200, 0.17-0.40s |
| Full 5-card board, 3x | 5 cards, 37 rows, no errors |
| 5 requests spaced 90s (cold isolates) | all 200, 5 cards, no errors |
| Board spanning 5 subway feeds + LIRR | 5 cards, 45 rows, no errors |

No `Worker exceeded CPU time limit` at any point.

## Why the spike was wrong

The step 1 numbers were measured with **Node on a Windows laptop**, not
workerd on Cloudflare's hardware. The conclusion — that cold decode at 14.90ms
exceeded the 10ms budget — did not survive contact with the real runtime.

Two things the local measurement could not see:

- **Cloudflare's V8 build and CPU are not this machine's.** The deploy
  reported `Worker Startup Time: 15 ms`, which is the whole module evaluating;
  the per-request decode is evidently far cheaper there than locally.
- **The "cold decode" penalty was largely JIT warmup in a fresh Node
  process.** A Workers isolate is not a fresh process: the runtime keeps
  compiled code around across isolate lifetimes in ways a `node script.js` run
  cannot replicate.

## What this changes

**The $5/month Workers Paid plan is not required.** §7 of the spec and the
step 1 conclusion both said it was; both were wrong, on a measurement that
looked rigorous but was taken on the wrong machine.

The lesson worth keeping: a performance budget measured off-platform is a
hypothesis, not a result. It was right to treat the free tier as untestable
without deploying — and wrong to conclude it would fail.

## Still true

- Decode cost scales with feed size, so a board spanning more feeds costs more
  CPU. Nothing measured so far approaches the limit, but the headroom is
  unknown rather than proven large.
- The caching optimisation (decoded feeds shared ~30s) remains unbuilt and
  unnecessary.
- If a future board does hit the limit, the paid plan is still the answer —
  it just is not needed now.
