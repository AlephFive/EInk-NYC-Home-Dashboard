# TRMNL Recipe Port — Specification

Porting the NYC transit board to a **public TRMNL Recipe** with user-configurable
stations.

Status: proposed, not implemented. Every platform constraint below was verified
against TRMNL docs and live MTA endpoints on 2026-10-26; the verification
commands are kept in the appendix so they can be re-run when they go stale.

---

## 1. What changes and what does not

The current app is one person's board: `displayConfig.ts` names five stops, and
`npm run build` bakes 785KB of station lookups into the bundle. A store plugin
inverts both of those — stops arrive at render time from a form, and the lookups
cannot ship to the client.

What survives the port intact:

- **All transit logic.** `utils/subway/`, `utils/railroad/`, `utils/bus/`,
  `utils/ferry/`, `utils/departures.ts`, `utils/multiStop.ts` move to the
  backend essentially unchanged. This is the bulk of the value and none of it
  is rewritten.
- **The layout geometry.** TRMNL OG is 800x480, the same panel this was built
  for. `ROW_HEIGHT` 26px, `HEADER_HEIGHT` 34px, the `cardCapacity.ts`
  constants, the clip-path arrow badges — all carry over as CSS.
- **The design rules.** Live-data-only, empty-is-not-an-error, per-card errors,
  hard clipping over ellipsis.

What is replaced:

- **React rendering** becomes Liquid markup. The component tree goes; the CSS
  does not.
- **In-browser fetching** becomes a backend endpoint. TRMNL polls one URL.
- **`displayConfig.ts`** becomes a TRMNL form, with the same fields.
- **The free-form column layout** becomes a fixed 3x2 grid (§4).

**Build order note:** the UI ports last. Everything genuinely at risk here is
data flow, user config and the recipe mechanism; the layout is already proven
on this exact panel size. Phase 1 therefore ships debug text only — see §8.

---

## 2. Why a backend is unavoidable

Three independent constraints, each sufficient on its own:

| Constraint | Measured | Source |
|---|---|---|
| TRMNL payload cap | 5KB (10KB with TRMNL+) | [Private Plugins](https://help.trmnl.com/en/articles/9510536-private-plugins) |
| Subway station lookup | 369KB | `MTA_Subway_Stations_20251126.geojson` |
| One GTFS-RT feed | 189KB of **binary protobuf** | measured, `nyct/gtfs` |

TRMNL polling accepts JSON, RSS, XML, plaintext and CSV — not protobuf. And the
feed is genuinely live: two fetches 35 seconds apart differed in **185,329 of
~191,000 bytes**, so nothing about it can be precomputed at build time.

A zero-backend version was explored and rejected. It is *technically* possible —
the MTA sends `access-control-allow-origin: *` on both the GTFS-RT and SIRI
endpoints, and TRMNL executes JavaScript in a real browser for up to 5 seconds —
but it fails the two requirements that define this project:

- **User-chosen stations need the full 496-station lookup**, which cannot ship
  in a 5KB template. Baking the lookup down to a known stop list was the trick
  that made zero-backend viable, and configurability removes it.
- **The MTA bus key would sit in every installer's markup**, billing all users'
  SIRI requests against one key.

So: one small backend, one polling URL. The recipe stays free to run (§7).

---

## 3. Architecture

**Two parts.** The recipe lives on TRMNL and owns **configuration and display**;
your server owns **data**. Nothing else is yours to run — no accounts, no
settings database, no OAuth.

```
  HOSTED BY TRMNL — not yours to run        YOUR CLOUDFLARE WORKER
  ----------------------------------        ----------------------
  The form                                   Fetch + decode
    6 card slots, pickers, walk times          284KB protobuf, 168ms measured
  Stored settings           -- settings -->  Resolve + filter
    per user, no database of yours             785KB lookups, walk time, row fit
  Liquid template           <-- ~2KB rows -- /api/board
    loops rows -> HTML, no logic               stateless, settings per request
  Screenshot -> device                       /api/stations, /api/bus-stops
    1-bit dither, 800x480                      picker search, setup only —
    polls every 15 min or more                 never on the polling schedule
```

### Who does what

| Responsibility | Recipe (TRMNL) | Your Worker |
|---|:---:|:---:|
| Form fields and station pickers | yes | |
| Storing each user's settings | yes | |
| Rendering rows into pixels | yes | |
| Fetching the MTA feeds | | yes |
| Decoding protobuf | | yes |
| Station name lookup (785KB) | | yes |
| Walk-time filtering | | yes |
| Deciding which rows fit | | yes |
| Per-card error handling | | yes |

Everything in the right-hand column is code that already exists — **1,915 lines**
of transit logic, against **1,008** that are React-specific and do not port.

Two consequences worth stating plainly:

- **The Liquid template holds no logic.** It loops over rows and prints badge,
  destination and time. If a row is in the JSON it renders; if not, it does not.
  Every decision — what is boardable, what is reachable, what fits — is made
  before the JSON is built.
- **The Worker is stateless.** TRMNL stores each user's settings and sends them
  as parameters on every poll, so there is nothing to persist between requests
  and no user data of yours to secure.

### 3.2 The TRMNL design framework — unresolved

**<https://trmnl.com/framework>.** Not yet reflected in the UI sections of this
spec, which were written assuming hand-authored CSS. Deferred deliberately:
phase 1 is data flow, and the UI is phase 2's problem. Flagged here so the
phase 2 work starts from the framework rather than from §1's assumption.

What is already known to conflict:

- **Markup structure is prescribed, not free.** `screen` -> `view--full` ->
  `layout` -> `columns`/`column`, with `title_bar` as a sibling of `layout`.
  CSS and fonts load from TRMNL's CDN (`plugins.css`).
- **`Item` is the framework's `DepartureRow`** — "a row for lists, schedules,
  and other repeating content, with optional meta text, an index, or an icon",
  with `.item`, `.meta`, `.content`, `.title`, `.label` and emphasis levels
  `item--emphasis-2/3`. The inverted urgent row is plausibly an emphasis
  variant rather than custom CSS.
- **`Columns` plus the Content Limiter overlap `cardCapacity.ts`.** The
  framework measures rendered height at runtime (`data-content-limiter`,
  `data-content-max-height`), hides what does not fit, and can append an
  "and X more" indicator. That directly contradicts this project's stated
  reason for computing capacity in advance — "the panel renders once and is
  screenshotted, so there is no second pass in which a measured value could
  settle." TRMNL *does* run a JS runtime before the screenshot, so a measured
  value can settle there.
- **Dithering is provided** — bit-depth-aware tokens and tiling backgrounds —
  which bears on the dithered "leave in N" indicator in the project TODOs.
- **MIT licensed, runs locally** (`github.com/usetrmnl/trmnl-framework`), so
  phase 2 can develop against it offline.

Three questions to settle before rewriting the UI sections:

1. **Does `Columns` fight a fixed-slot layout?** This board is positional —
   named stations in chosen places — not a stream of items shown until full.
2. **Is "and X more" right for departures?** Hiding a train behind a counter
   may be worse than showing fewer rows cleanly.
3. **Can `Item` express the arrow-clipped railroad badge?** That is a design
   feature carrying direction, not ornament.

If `Columns` handles distribution and overflow, the fixed 3x2 grid in §4 and
the width arithmetic behind it may be solving a problem the framework already
solves. **§4's grid and §6.3's row-count reasoning are provisional until this
is resolved.**

**Recipe, not Third Party plugin.** Recipes are hosted by TRMNL, appear in the
public `/recipes` and `/plugins` directories, support custom form fields, and
need no OAuth2 flow, install callback, management page or markup endpoint. The
only infrastructure is the polling endpoint and the picker endpoints in §5.

### 3.1 Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /api/board` | GET | The polling URL. Takes the user's settings, returns display rows. |
| `POST /api/stations` | POST | `xhrSelectSearch` source for subway/railroad station pickers. |
| `POST /api/bus-stops` | POST | `xhrSelectSearch` source for bus stops, filtered to currently-valid IDs. |

`/api/board` is the only one TRMNL polls on a schedule. The picker endpoints are
hit only while a user is filling in the form.

---

## 4. The form

TRMNL's form builder has **no repeating groups and no array fields** — this is
the single most shaping constraint on the design. A user cannot "add a card"
an arbitrary number of times.

The layout is therefore a **fixed 3x2 grid — three columns, at most two cards
each, six slots**. Each slot is independently configurable; a slot left `Off`
is omitted and its column-mate stretches to the column's full height.

Three columns is not a preference, it is the last column count that renders
readable text. Measured against the real row geometry (`DepartureRow.tsx`:
3px border, 8px padding, 5px gaps, 76px rect badge or 18px bullet, ~38px
time):

| Columns | Column width | Destination, railroad | Destination, subway half-column |
|---|---|---|---|
| 3 | 257px | 108px (~17 chars) | 41px (~6 chars) |
| 4 | 191px | 43px (~6 chars) | **8px (~1 char)** |
| 5 | 152px | 3px | **negative** |

The current board already clips hard at three columns ("STEINWAY via STEINWAY
S" in a ~55px bus column). There is no headroom to spend on a fourth.

This is also stricter than the format it replaces: `columnDisplay` accepts four
or five columns today and silently renders an unreadable board. A fixed grid
makes that state unrepresentable.

Slot-to-grid mapping, which the backend applies rather than the user:

| Slot | Column | Position |
|---|---|---|
| 1, 2 | Left | top, bottom |
| 3, 4 | Middle | top, bottom |
| 5, 6 | Right | top, bottom |

A column with one active slot gives that card double the rows, which
`cardCapacity.ts` already derives from `cardsInColumn` — measured at 5 rows
when a column holds two cards, 13 when it holds one. That behaviour ports
with no new layout logic.

### 4.1 Field list

Per slot *N* in 1..6, all fields grouped under an accordion `Card N`:

```yaml
- keyname: card1_type
  field_type: select
  name: Transit type
  group: Card 1
  optional: true
  options:
    - Off
    - Subway
    - LIRR
    - Metro-North
    - Bus
    - Ferry
  default: Off
  help_text: Leave Off to hide this card.

- keyname: card1_station
  field_type: xhrSelectSearch
  name: Station
  group: Card 1
  depends_on: card1_type
  endpoint: https://<host>/api/stations
  help_text: Type part of a station name.

- keyname: card1_walk_time
  field_type: number
  name: Walk time (minutes)
  group: Card 1
  default: 5
  help_text: Departures you could not reach in this time are hidden.

- keyname: card1_title
  field_type: string
  name: Custom title
  group: Card 1
  optional: true
  help_text: Defaults to the station name.
```

Board-level settings, group `Display`:

```yaml
- keyname: use_24_hour
  field_type: boolean
  name: 24-hour clock
  default: true

- keyname: urgent_threshold
  field_type: number
  name: Highlight departures within (minutes)
  default: 10
  help_text: Rows this close to your leave time are shown inverted.

- keyname: show_leave_in
  field_type: boolean
  name: Show "leave in N minutes"
  default: false
  help_text: >
    The panel refreshes on an interval, so a countdown can be stale by up to
    that interval while a clock time never is.
```

### 4.2 Why `xhrSelectSearch` rather than `select`

A static `select` would need all 496 subway + 241 railroad stops inlined in the
form definition, and bus stops cannot be enumerated at all (they are queried
live from the NY Open Data portal). `xhrSelectSearch` POSTs the user's typed
query to our endpoint and renders the returned options, so the lookup stays on
the server where it already lives.

`depends_on: card1_type` means the station picker's request carries the chosen
transit type, letting one endpoint serve subway, LIRR and Metro-North and
route bus queries to the portal.

### 4.3 What the form deliberately does not expose

- **Subway `lines`.** In `displayConfig.ts` this selects *feeds*, not routes,
  and getting it wrong silently yields an empty card — the single sharpest edge
  in the current config format. The backend derives the feed set from the
  chosen stop's `daytime_routes` instead, so the user never sees it.
- **Multiple stop IDs per card.** Subway complexes and bus corners span several
  IDs. Rather than asking users to understand that, the picker returns one
  entry per *place* and the backend expands it to the full ID set (§5.1).
- **Column/row placement.** Slots fill the 3-column grid in order. Exposing
  geometry would multiply the form size for little gain.

---

## 5. Picker endpoints

### 5.1 `POST /api/stations`

Request body carries sibling settings, including the parent select:

```json
{ "query": "vernon", "settings_custom_fields_values_card1_type": "Subway" }
```

Response is TRMNL's expected array of single-key objects, label to stored value:

```json
[
  { "Vernon Blvd-Jackson Av (7)": "subway:721" },
  { "Times Sq-42 St (1,2,3,7,N,Q,R,W,S)": "subway:127+R16+A27+725+902" }
]
```

Two behaviours matter here:

- **Complex expansion.** Stations sharing a `complex_id` are offered as one
  option whose value carries every stop ID, so a user picking "Times Sq" gets
  all five platform groups merged — the multi-stop behaviour `TransitCard`
  already implements, without the user knowing stop IDs exist.
- **Route disambiguation in the label.** 379 distinct names across 496 records
  means duplicates; appending `daytime_routes` makes the choice unambiguous.

### 5.2 `POST /api/bus-stops`

Bus stops are not bundled — there is one stop in `staticData/bus/route_info.json`
— so this proxies the NY Open Data portal:

```
GET https://data.ny.gov/resource/2ucp-7wg5.json
  ?$where=upper(stop_name) like '%<QUERY>%' AND valid_to > '<today>'
  &$select=route_short_name,stop_id,stop_name,direction,valid_to
```

**The `valid_to` filter is mandatory, not an optimisation.** Unfiltered, a
search for "VERNON" returns stops whose `valid_to` is 2019 — long-retired IDs
that would yield a SIRI `ErrorCondition` and a permanently broken card. This is
the same failure that silently broke this board's own bus card when stop
`700748` was re-IDed to `505506`; on a public plugin it would hit every user who
picked a stale entry.

Because a bus corner is one ID per direction, options are grouped by
`stop_name` and the value carries both IDs, reproducing the two-column bus card.

---

## 6. `GET /api/board` — the polling endpoint

### 6.1 Request

TRMNL interpolates form values into the polling URL via Liquid:

```
https://<host>/api/board
  ?tz={{ trmnl.user.utc_offset }}
  &c1={{ card1_type }}:{{ card1_station }}:{{ card1_walk_time }}:{{ card1_title }}
  &c2={{ card2_type }}:{{ card2_station }}:{{ card2_walk_time }}:{{ card2_title }}
  ...
  &h24={{ use_24_hour }}&urgent={{ urgent_threshold }}&leavein={{ show_leave_in }}
```

### 6.2 Response

Display-ready rows only. No feed data, no station metadata, nothing the template
must interpret. Shown here in the verbose shape for readability; the compact
shape in §6.3 is what ships (`s`/`y`/`n`/`b`/`k`/`h`/`r`, rows as
`[badge, destination, time, urgent]` tuples):

```json
{
  "generated_at": "2026-10-26T14:47:00-04:00",
  "cards": [
    {
      "slot": 1,
      "type": "subway",
      "title": "Vernon Blvd-Jackson Av",
      "bullets": ["7"],
      "columns": [
        {
          "heading": "Manhattan",
          "rows": [
            { "badge": "7", "shape": "bullet", "dest": "34 St-Hudson Yards",
              "time": "14:57", "urgent": true, "leave_in": 2 }
          ]
        },
        { "heading": "Outbound", "rows": [ ... ] }
      ]
    },
    { "slot": 2, "type": "bus", "title": "...", "error": "No such stop: ..." }
  ]
}
```

### 6.3 Payload budget

**Measured, 2026-10-26 — this is no longer an open question.** Serialised from
the exact 39 rows the live board rendered this session:

| Shape | Bytes | % of 5KB cap | Per row |
|---|---|---|---|
| Verbose keys, one object per row | 3,651 | 71% | 93.6 B |
| **Compact keys, rows as tuples** | **1,853** | **36%** | **47.5 B** |

Worst case the 3x2 grid permits — six cards, every one filled to its computed
row limit (60 rows), longest real LIRR branch names throughout — is **3,633
bytes, 71% of the cap.** It fits with no trimming logic.

Two clarifications, because the cap is easy to misread:

- **The cap applies to the response, not to the app.** The 785KB of station
  lookups and the 284KB of feeds fetched per poll never reach TRMNL. The
  backend resolves a stop ID to "Vernon Blvd-Jackson Av" and sends only that
  string.
- **Backend processing is why the payload is small, but it cannot shrink it
  below the content.** 39 rows of badge, destination and time is irreducibly
  39 rows of text. Processing cuts 284KB to 1.9KB; nothing cuts 1.9KB further
  except showing less.

The compact shape is adopted for the ~2x margin it buys, not because the
verbose one fails. The backend still computes rows per card from
`cardCapacity.ts` geometry — which caps rows at what the panel can physically
fit — so the cap only binds if that geometry is bypassed.

### 6.4 Live data, no fallbacks

The current rules carry over unchanged and are not negotiable in the port:

- The endpoint reports what the realtime feeds say. No static timetable
  fallback, no inferring *why* a feed is empty.
- **Empty is not an error.** A card with no departures renders "No upcoming
  trains" — distinct from the error box, which appears only on an actual fetch
  failure.
- **Per-card errors.** One dead stop fails its own card; the other four render.
  `loadTransitData.ts` already produces exactly this shape and ports directly.

Configurable stations make empty cards *more* common — peak-only service (this
board's own LIRR Long Island City card is empty outside rush hour), wrong
platform group, terminal stations. Since the app must not guess why, the
mitigation is in the picker, not the renderer: labels carry route lists so the
user can tell platform groups apart, and the plugin's knowledge-base page
documents the common causes. **The board itself still says only "No upcoming
trains".**

---

## 7. Cost

**$0/month — verified against a real deployment, 2026-10-26.**

An earlier version of this section said $5/month was required, on a CPU spike
that measured protobuf decode at 14.90ms cold against the free tier's 10ms
budget. **That measurement was taken with Node on a Windows laptop, and did
not survive contact with the real runtime.** Deployed on the free plan, a
five-card board returns cleanly — warm, cold, and spanning six feeds — with no
CPU-limit errors at any point. Full numbers in
`trmnl-recipe/spikes/RESULTS.md`.

The lesson is worth keeping: a performance budget measured off-platform is a
hypothesis, not a result.

CPU is still the constraint that would bind first if one did — decode cost
scales with feed size, so a user picking stations across unrelated lines costs
more than one picking a single line. Nothing measured approaches the limit,
but the headroom is unknown rather than proven large. If a future board does
hit it, the paid plan at $5/month is the answer.

Cloudflare Workers free tier is 100,000 requests/day. At TRMNL's 15-minute store
minimum, one installed device is 96 polls/day.

| Installs | Polls/day | % of free tier |
|---|---|---|
| 1 | 96 | 0.1% |
| 100 | 9,600 | 10% |
| 1,000 | 96,000 | 96% |

Roughly 1,000 installs before the free tier binds, plus picker traffic, which is
bursty but only during setup. Beyond that it is $5/month — a problem worth
having, and TRMNL has paid marketplace developers since November 2025.

Workers is the recommendation over Vercel/Netlify hobby tiers, whose terms are
ambiguous about a publicly-listed plugin. One caveat to verify during the spike:
Workers' CPU limit on the free plan, against protobuf decode of ~284KB across
three feeds. Measured fetch time is 168ms; decode is unmeasured.

### 7.1 The MTA key

Only the bus SIRI API needs a key; GTFS-RT feeds are unauthenticated. The key
lives in the backend, never in the markup. Since all users' bus requests bill
against one key, the backend caches SIRI responses per stop for ~60s — several
users watching the same stop then cost one upstream call.

---

## 8. Build order

**Phase 1 proves the pipeline; phase 2 makes it look like the panel.** Every
unknown that can invalidate the architecture is in data flow, config and the
recipe mechanism — not in the UI, which is an 800x480 layout already proven in
production on an 800x480 panel. So phase 1 renders **debug text only**: every
field the template receives, dumped as plain lines, no CSS.

### Phase 1 — prove the data flow

1. ~~**Worker CPU spike.**~~ **Done 2026-10-26.** Free tier rejected on
   measured CPU; paid plan adopted. See `trmnl-recipe/spikes/RESULTS.md` and
   §7.
2. **Extract the view-model boundary.** Make the row-building logic — currently
   inline in `App.tsx`'s `renderTrainList` — a pure function from feed data to
   the §6.2 shape. This is the seam the backend needs, and it is worth doing in
   the existing repo where it stays testable against the live app.
3. **`/api/board` against real settings.** Parse the slot parameters, fetch,
   filter by walk time, emit the compact shape. Verify per-card error isolation
   by pointing one slot at a retired stop ID.
4. **Picker endpoints** (§5), including the `valid_to` filter and complex
   expansion.
5. **Form definition** (§4) in a real recipe, wired to the pickers.
6. **End-to-end on debug markup.** A real device, real settings, the template
   below. Proves settings reach the backend, data reaches the template, and
   refresh works — with nothing to debug but the data.

```liquid
{{ t }}
{% for card in c %}
--- slot {{ card.s }} | {{ card.y }} | {{ card.n }}
{% if card.e %}ERROR: {{ card.e }}{% endif %}
{% for col in card.k %}
  [{{ col.h }}]
  {% for r in col.r %}{{ r[0] }} | {{ r[1] }} | {{ r[2] }}{% if r[3] %} *{% endif %}
  {% endfor %}
{% endfor %}
{% endfor %}
```

### Phase 2 — make it the panel

7. **Liquid template.** Port `DepartureRow` and `TransitCard` markup and CSS,
   and apply the 3x2 grid (§4). Verify against the screenshot pipeline — the
   1-bit conversion is TRMNL's now, not `Lightweight-Eink-Server`'s, so
   dithering must be re-checked rather than assumed.
8. **Submit.** Per TRMNL's process: plugin ID, owner email, rationale, a video
   of installation from scratch, and test credentials, to team@trmnl.com.
   Review is automated (CHEF) then manual.

**One thing phase 1 must not simplify: the row count.** Rows per card is an
input to the payload budget, not styling, so the spike computes it from real
`cardCapacity.ts` geometry (5 rows in a shared column, 13 alone). A spike that
sends three rows per card measures nothing.

### 8.1 Relationship to the existing repo

The dashboard repo keeps working throughout; the port does not replace it.
Step 3 is the only change to existing code, and it is an improvement on its own
terms. `Lightweight-Eink-Server` is untouched and continues to drive the
existing panel.

Open question for later: whether the two eventually converge on one backend,
with the local panel polling the same `/api/board`. Worth deciding only after
the recipe ships.

---

## 9. Open questions

1. ~~**Does a board fit in 5KB?**~~ **Answered 2026-10-26.** The current
   39-row board is 1,853 bytes compact (36% of cap); the worst case the 3x2
   grid permits is 3,633 bytes (71%). No trimming logic needed. See §6.3.
2. ~~**Does protobuf decode fit the Workers free CPU limit?**~~ **Answered
   2026-10-26: no.** Cold decode 14.90ms and all-8-feeds decode 13.52ms both
   exceed the 10ms free budget; the 3-feed warm worst case is 9.26ms, 93% of
   it. Moves to the Workers paid plan at $5/month, where the worst case is 31%
   of budget. Full numbers in `trmnl-recipe/spikes/RESULTS.md`.
3. ~~**How many slots?**~~ **Six**, as a fixed 3x2 grid (§4). Three columns is
   the last count where a destination stays readable; four gives a subway
   destination ~1 character.
4. **Keep the per-card `title` field?** Six slots x four fields is a long form.
   `title` is the only one of the four that is purely cosmetic and already
   defaults to the station name (`TransitCard.tsx:309`). Dropping it saves six
   fields; keeping it helps users who merge stop IDs under one card.
5. **Ferry.** Still schedule-based (`getFerrySchedule.ts`), which conflicts with
   live-data-only. Options: omit ferry from v1, or ship it clearly labelled as
   scheduled. Omitting is the honest default given the rule.
6. **Metro-North terminal coverage.** `cityTerminals.json` holds only Grand
   Central for MTN, which is correct for this board but may mislabel direction
   for users near other terminals. Needs auditing before a public release.

---

## Appendix — verification commands

Re-run these when the facts above look stale.

```bash
# GTFS-RT is live binary, not cacheable
curl -s -o f1.pb https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs
sleep 35
curl -s -o f2.pb https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs
cmp -l f1.pb f2.pb | wc -l    # 2026-10-26: 185,329 differing bytes of ~191,000

# MTA permits browser fetches (why zero-backend was explored)
curl -s -o /dev/null -D - -H "Origin: https://usetrmnl.com" \
  https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs | grep -i access-control
# 2026-10-26: access-control-allow-origin: *

# Bus stop search must filter valid_to or it returns retired IDs
curl -s --get https://data.ny.gov/resource/2ucp-7wg5.json \
  --data-urlencode "\$where=upper(stop_name) like '%VERNON%'" \
  --data-urlencode "\$select=stop_id,stop_name,valid_to" --data-urlencode "\$limit=3"
# 2026-10-26: every result valid_to 2019 — retired stops
```

Payload, measured from the 39 rows the live board actually rendered:

```
verbose JSON : 3651 bytes  71.3% of 5KB   93.6 B/row
compact JSON : 1853 bytes  36.2% of 5KB   47.5 B/row
worst case (6 cards, 60 rows, longest LIRR names): 3633 bytes, 71.0%
```

Lookup sizes, for the payload argument:

| File | Size | Records |
|---|---|---|
| `MTA_Subway_Stations_20251126.geojson` | 369KB | 496 stops, 379 distinct names |
| `railroad_stops_lookup.json` | 168KB | 127 LIRR, 114 MTN |
| `MTA_Rail_Stations_20251126.geojson` | 167KB | — |
| `staticData/bus/route_info.json` | — | 1 stop (bus search must be live) |
