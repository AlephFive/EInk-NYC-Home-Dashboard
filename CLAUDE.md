# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an E-Ink display dashboard for NYC transit information, supporting subway, railroad (LIRR/Metro-North), bus, and ferry data. The project is built with React, Vite, and TypeScript, and fetches real-time transit data from MTA APIs.

## Design Constraints

- **This project is intended for public release.** Solutions must generalize — solve
  the class of problem, not the one instance in front of you. No personal values
  (a specific stop, station, or address) hardcoded into logic; those belong in
  `displayConfig.ts`, and the logic reads the config.
- **When fixing a failure mode for one transit type, check whether the other four
  share it.** The per-card error handling below is the worked example: it began as a
  bus-only fix and was generalized once the same silent-failure class was found in
  subway, railroad, and ferry.
- **Live data only.** The dashboard reports what the realtime feeds actually say. It
  does not fall back to static timetables to predict departures, and does not infer
  *why* a feed is empty — an empty feed only proves the feed is empty.

## Planned Work (TODO)

Not yet implemented — do not treat these as describing current behavior.

1. **Move the ferry to a live API.** Currently schedule-based (`getFerrySchedule.ts`
   reading `staticData/ferry/schedule.json`). The fetch path in `App.tsx` already
   handles ferry stops per-stop with error capture, so the orchestration will not need
   to change. The ferry schedule carries no destination, so its rows leave that column
   empty; a live feed may supply one.

2. **Reconsider how "go in N mins" is presented.** Currently disabled
   (`showLeaveIn: false` in `displayConfig.ts`) — the walk-time *filter* still applies,
   only the countdown is hidden. Subtracting walk time is what makes this better than
   the MTA's own app, so the aim is to bring it back in a form that survives the panel's
   refresh interval: a countdown is stale by up to that interval, while a "leave at
   12:47" clock time never is.

   **Prefer a graphical indicator to a text line.** A dithered or filling progress bar
   could convey "leave in N" in a fraction of the horizontal space text costs — valuable
   at 257px per card, and `DepartureRow` currently gives the countdown its own `Nm`
   column. The panel is 1-bit, so shading must come from dithering patterns rather than
   true grays; the screenshot server already dithers via ImageMagick, so any CSS pattern
   needs checking against that pipeline rather than assumed to survive it.

   Related: `urgentThresholdMinutes` is a fixed 10 minutes, so with typical walk times
   most rows invert to solid black — on a 1-bit panel where inversion is the only
   emphasis, that means nothing stands out. A threshold relative to `walkTime` would
   fire proportionally.

3. **Restore the delay indicator.** The row rewrite dropped the `+N min` delay display
   that previously sat at the right of each train row. Roughly 40% of LIRR stop-time
   updates carry a nonzero `arrival.delay` on an ordinary day, so it is real
   information; it needs a place in the three-column row that does not crowd the
   destination.

4. **Show destination only when departures actually differ.** Verified against live
   feeds: every northbound 7 at Vernon Blvd goes to Flushing-Main St and every
   southbound to 34 St-Hudson Yards, so the label repeats down the column and adds
   nothing. At LIRR Jamaica there are 13 distinct destinations and it is essential. The
   generalizable rule is to render the destination when a card's list holds more than
   one distinct value — that also covers branching subway lines (the A, the 5). Subway
   column headers already carry MTA's own wayfinding text via `getDirectionLabels()`.

   A second redundancy shows at railroad terminals: a branch's trains usually end at the
   branch's namesake station, so badge and destination repeat ("Hempstead | Hempstead"
   on 7 of 8 rows at Grand Central). Suppressing the destination when it matches the
   badge, or dropping the branch badge in favour of the destination, would recover that
   space.

5. **Restructure `App.tsx` and extract shared helpers.** The file is ~800 lines doing
   fetch orchestration, three render functions, the `DepartureRow`/`EmptyRow` components
   and the board layout. Concretely:
   - `DepartureRow` and `EmptyRow` are components living in `App.tsx`; they belong in
     `components/`.
   - `renderTrainList`, `renderBusList` and `renderFerryList` are ~80% the same shape —
     filter by walk time, slice to the limit, map to rows, compute urgency. The filtering
     and urgency logic should be one helper the three share.
   - `mergeSorted`, `collectErrors`, `stopTimeOf` and `mostCommon` sit in
     `TransitCard.tsx` but are not card-specific; they belong in `utils/`.
   - The fetch orchestration in the `useEffect` is long enough to be its own module.

   `utils/cardCapacity.ts` is the shape to aim for: one job, named constants, documented
   reasoning.

6. **Redesign the visuals.** The styling is functional but unpolished. The card header
   (type badge + station name) and the section headings still use the original ad-hoc
   styling, and nothing has been designed as a system.

## Development Commands

```bash
# Development server
cd EInk-NYC-Home-Dashboard
npm run dev

# Build (includes TypeScript compilation and protobuf generation)
npm run build

# Lint
npm run lint

# Preview production build
npm run preview

# Generate protobuf TypeScript files (runs automatically during build)
npm run gen:proto
```

## Architecture

### Data Flow Pattern

All transit types follow a consistent architecture:

1. **Configuration** (`displayConfig.ts`): Defines which stops to display using a 2D grid layout
2. **API Fetching** (`utils/{transitType}/fetchTrainData.ts` or `fetchBusData.ts`): Fetches and decodes data
3. **Data Processing** (`utils/{transitType}/index.ts`): Filters and enriches data for display
4. **Rendering** (`App.tsx` → `TransitCard.tsx`): Displays data in a card-based layout

### Transit Type Modules

Each transit type is isolated in `src/utils/{transitType}/`:

- **Subway** (`utils/subway/`):
  - Uses GTFS-realtime protobuf feeds (multiple feeds per line group)
  - `fetchMultipleTrainLines()` batches API calls by feed to minimize requests
  - Filters by direction (N/S) and stop ID
  - Station lookups in `stations.ts`, colors in `subwayColors.ts`

- **Railroad** (`utils/railroad/`):
  - Supports both LIRR and Metro-North
  - `fetchMultipleRailroads()` merges feeds from multiple railroads
  - Each `EnrichedStopTimeUpdate` includes a `railroad` field ("lirr" or "mtn")
  - Route colors and names in `routeLookup.ts`

- **Bus** (`utils/bus/`):
  - Uses SIRI API (JSON-based, not protobuf)
  - Requires `VITE_MTA_API_KEY` environment variable
  - Route metadata in `displayDataLookup.ts`
  - `fetchBusData()` throws on a body-level `ErrorCondition` — see "SIRI error
    handling" below.

- **Ferry** (`utils/ferry/`):
  - Schedule-based (no API calls) — **intended to move to a live feed**. The fetch
    path in `App.tsx` already handles ferry stops per-stop with error capture, so
    swapping the schedule lookup for an API call needs no orchestration changes.
  - Static timetables in `getFerrySchedule.ts`
  - Direction-aware (uptown/downtown)

### Protobuf Setup

GTFS-realtime data uses Protocol Buffers:

- **Proto definitions**: `src/protocol/proto/*.proto`
  - `gtfs-realtime.proto`: Base GTFS-RT spec
  - `gtfs-realtime-NYCT.proto`: Subway extensions
  - `gtfs-realtime-MTARR.proto`: Railroad extensions

- **Generated code**: `src/protocol/proto/generated/` (auto-generated, do not edit manually)

- **Generation command**: `npm run gen:proto`
  - Uses `ts-proto` to generate TypeScript from `.proto` files
  - Runs automatically during `npm run build`

### Display Configuration

The `displayConfig.ts` file is **column-first**: the outer array is columns
left-to-right, each inner array holds at most 2 cards stacked top-to-bottom.

```typescript
columnDisplay: [
  [card1, card2],  // Column 1: two stacked cards
  [card3, card4],  // Column 2
  [card5],         // Column 3: one card, full height
]
```

A column with a single card stretches that card to the column's full height, which is
how the current board renders a 2x2 block beside one tall card.

**Card size is independent of content in both axes.** Flex items default to
`min-width`/`min-height: auto`, which lets content force them larger, so columns and
cards both set `minWidth: 0` and `minHeight: 0` alongside `flex`, with
`overflow: hidden` to clip. Card headers additionally need `minWidth: 0` on the flex
row and the `<h2>` for their `text-overflow: ellipsis` to engage — without it the
heading keeps its content's width and never truncates. The root box is
`overflow: hidden`, not `auto`: the panel is screenshotted at exactly 800x480, so
scrollbars would silently hide overflow from the PNG.

Verified in Chromium with a deliberately long station name: three equal 257px columns,
the title ellipsized, and no overflow on the root.

Each card specifies:
- `transitType`: "subway" | "railroad-lirr" | "railroad-mtn" | "bus" | "ferry"
- `stopIds`: one or more stop IDs. A place often spans several: a bus corner is one ID
  per direction, and 35 subway complexes split by platform group (Times Sq is five —
  `127`, `R16`, `A27`, `725`, `902`). Every listed ID is fetched and merged into the
  card. Subway IDs omit the N/S suffix; the app appends it per ID.
- `title`: (optional) card heading, defaulting to the first ID's station name — set it
  when a card's IDs resolve to different names
- `lines`: (subway) which MTA feeds to fetch — see "Subway feed groupings" note below
- `walkTime`: Display walk time to the stop
- `directionNames`: (optional) Custom labels for northbound/southbound
- `departures`: (optional) departures shown on this card, overriding `defaultDepartures`

**How many departures a card shows is computed from its height**, in
`utils/cardCapacity.ts`, so a re-arranged layout needs no retuning: a card alone in a
column gets roughly twice the rows of one sharing a column. The calculation is derived
from the layout's fixed geometry rather than measured, because the panel renders once
and is screenshotted — there is no second pass in which a measured value could settle.
That means its constants mirror the styles (26px rows, 34px header, 6px gaps, the
absolutely-positioned footer's 27px) and must be updated alongside them; they are
gathered in that one file for the purpose. `departures` on a card, or the global
`defaultDepartures`, override the computed value.

Other top-level options: `use24HourTime`, `urgentThresholdMinutes`, and
`fetchDepartures` (requested per stop for bus and ferry). `fetchDepartures` must exceed
the displayed count because departures inside `walkTime` are filtered out after
fetching. Subway and railroad have no fetch limit — their GTFS-RT feeds return all
upcoming departures in one response.

`lines` selects which protobuf feed to download, not which routes to display: the MTA
groups subway lines into 8 feeds, and a feed returns every line in its group. It is
effectively required on a subway card — omitting it means no feed is fetched.

### API URLs and Mappings

Static data files contain API configuration:

- `src/staticData/subway/apis.json`: Maps subway lines to feed URLs
- `src/staticData/railroad/apis.json`: Railroad feed URLs
- `src/staticData/bus/apis.json`: Bus API endpoint

## Key Implementation Details

### Type Disambiguation

Both subway and railroad modules export `EnrichedStopTimeUpdate`, but they're different types. Import them with aliases:

```typescript
import { type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate } from "./utils/subway";
import { type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate } from "./utils/railroad";
```

Railroad's version adds a `railroad` field to distinguish LIRR from Metro-North.

### Batching Strategy

- **Subway**: Multiple lines may share the same feed. `fetchMultipleTrainLines()` deduplicates feeds to minimize API calls.
- **Railroad**: `fetchMultipleRailroads()` fetches LIRR and Metro-North in parallel, then merges entities.

### Bus Stop ID Lookup

To find bus stop IDs, use the NY Open Data portal:
https://data.ny.gov/Transportation/MTA-Bus-Stops/2ucp-7wg5/

Filter by route name to find stop IDs for specific routes.

**Bus stop IDs expire.** Each row carries `valid_from` / `valid_to`, and the MTA
retires and re-IDs stops. The dashboard's Q101/Q103 stop was re-IDed on 2026-04-12
(`700748` "BORDEN AV/CENTER BLVD" → `505506` "CENTER BLVD/BORDEN AV" — same corner,
cross-streets swapped), which silently broke the bus card. When changing a bus stop,
update **both** `displayConfig.ts` and the `stops` map in
`staticData/bus/route_info.json` — the latter supplies the card's display name via
`getBusStopInfo()`, and a missed update falls back to `Bus Stop <id>`.

Query the portal's API to check a stop is still current:

```bash
curl -s --get "https://data.ny.gov/resource/2ucp-7wg5.json" \
  --data-urlencode "\$where=stop_id='505506'" \
  --data-urlencode "\$select=route_short_name,stop_id,stop_name,valid_from,valid_to"
```

### Departure rows

Every transit type renders departures through one shared `DepartureRow` component in
`App.tsx`, so rows are identical in height and column positions across all cards:

```
[badge] [destination — flexible, clipped] [time — right-aligned]
```

- **Fixed `ROW_HEIGHT`** (26px) is what keeps rows uniform. Content never dictates
  height, so a long destination cannot make one row taller than its neighbours.
- **Badge shape** is `"bullet"` (18px circle) for subway's one-character routes and
  `"rect"` (capped at 76px, ellipsized) for named routes — bus lines, railroad branches.
  Railroad badges use `getRailroadRouteShortName()`, which strips the trailing "Branch"
  from `route_long_name`: "Babylon Branch" becomes "Babylon".
- **Destination** comes from `destinationStopId`, recorded by both `extractDataByStop()`
  implementations as the trip's final `stopTimeUpdate`. Resolve it with
  `getDestinationName()` in `stationLookup.ts`, which strips the subway's N/S suffix
  before looking the station up.
- **Departures only.** A card lists trains you can *board*, so `renderTrainList` filters
  with `isBoardable()` and reads `departure.time` in preference to `arrival.time`.
  **The two feed families disagree about terminating trains:** LIRR omits `departure` on
  a train ending its run, but the subway does not — at Coney Island all 51 southbound
  trains carry both `arrival` and `departure` while every one of them terminates. So
  `isBoardable()` tests `destinationStopId`, which `extractDataByStop` leaves undefined
  when this stop ends the trip, and that works for both feeds. Testing `departure` alone
  silently passes 51 dead trains at a subway terminal.
- **Terminals collapse to one column.** A subway card normally shows two direction
  columns, but at a terminal every train in one direction terminates there and nothing
  is boardable — Flushing-Main St has 8 northbound stop times and 0 boardable. The card
  renders only the live direction, full width, instead of half the card reading "No
  upcoming trains". If neither direction runs, both are kept so the card still explains
  itself.
- **Direction columns are `flex: 1 1 0` with `minWidth: 0`.** Without the explicit basis
  and min-width they size to their content and overflow the card — the same trap as the
  outer columns. This matters at terminals, where the two are disjoint: a train ending
  its run carries only `arrival`, one starting carries only `departure`. Grand Central
  had 12 of 28 upcoming stop times as arrivals; because the renderer keyed on
  `arrival.time`, the card was showing 11 arrivals and 1 departure — the opposite of
  what a rider needs.

### Error handling: per-card, not global

Every transit type reports failures **per card**. A failing stop or feed renders an
"Unavailable" box in its own card (`CardError` in `TransitCard.tsx`) while the rest of
the board keeps working — important for an unattended wall panel, where a global error
would blank the whole display.

- `TransitErrors` (`types/transitData.ts`) mirrors `TransitData`'s shape, keyed by
  transit type then stop ID, with a message string per failing card.
- `App.tsx` builds it during the fetch pass and passes it to each `TransitCard`.
- **Per-stop fetches** (bus, and ferry once live) catch individually, so one dead stop
  ID only affects its own card.
- **Shared-feed fetches** (subway, railroad) have no per-stop request to isolate, so a
  feed failure is attributed to every card of that type.
- `fetchMultipleRailroads()` uses `Promise.allSettled` and returns a `failures` map
  keyed by railroad, so a Metro-North outage does not discard LIRR data. It throws only
  when *every* railroad fails.

**Empty is not an error.** A card with no departures shows "No upcoming trains/buses/
ferries" — the app does not guess whether that means no service today, service ended,
or everything is inside the walk time. Only an actual fetch failure shows the error box.

**Nothing blanks the board.** A top-level failure renders as a banner *above* the cards,
not instead of them, and `App.tsx` commits partial results from its `catch` — so an
unexpected throw costs only the cards it actually affected. Error text in `CardError` is
line-clamped because the panel is a fixed 800x480 with no scrolling: upstream messages
can be long (the MTA's "No such stop" text repeats the stop ID three times) and must not
push a card past its height.

### Card headers

Headers are a fixed `HEADER_HEIGHT` (34px), so the dotted rule beneath them lands on the
same line across a row of cards. Without it the header sizes to its content and the rule
sits 4px higher on subway cards, whose 24px route bullets are shorter than the 28px
"Bus"/"LIRR" tags.

Each card leads with a type tag — "Bus", "LIRR", "Metro-North" — except **subway cards,
which show route bullets instead**: the lines serving the station, as filled circles.
They come from `getSubwayRoutes()` (the station table's `daytime_routes`), not the card's
`lines` field, because `lines` selects *feeds* and can name routes that do not stop there.
For a card merging several stop IDs the bullets are the union across all of them. They are
drawn as outlined circles sharing the 2px border of the "Bus"/"LIRR" tags they stand in
for, at 24px against those tags' 28px — a circle of equal height reads heavier than a
rectangle, so it is stepped down. Being outlined also keeps them distinct from the filled
bullets in the departure rows below. MTA line colours are unused
because the panel is 1-bit and every colour would flatten to the same fill.

### Multi-stop cards

`TransitData` and `TransitErrors` stay keyed by individual stop ID, so per-stop error
isolation still works. `TransitCard` gathers its own `stopIds`, merges their lists with
`mergeSorted()`, and surfaces the first error among them. Consequences:

- **Bus cards get one column per configured stop ID**, labelled with the most common
  destination among its buses ("HUNTERS POINT CENTER BL" / "ASTORIA"). Grouping is by
  stop ID, **not** by `DirectionRef`: that field is GTFS `direction_id`, a per-*route*
  0/1 meaning outbound/inbound relative to each route's own definition. Two routes'
  "direction 0" are unrelated, and one stop ID can carry both values — Flatbush Av/Park
  Pl serves B69 at `DirectionRef=0` and B41 at `DirectionRef=1` from a single ID. Since
  a bus stop is one side of the street, a card's stop IDs *are* its directions.
- **Railroad route badges are shaped as arrows** — the badge itself is clipped into a
  chevron pointing left for city-bound trains and right for outbound ones, so direction
  is carried by the label rather than a separate glyph competing for width. The three
  corners away from the point keep the same 2px radius as an unpointed badge. Every
  badge in a card shares one width, estimated from the longest branch name present
  (~6.2px per character at the 11px bold face, capped at 76px), so destinations line up
  in a column instead of stepping in and out. The cap is load-bearing: the destination
  column is already at 95px with the longest names clipping, so a wider badge would
  trade one truncation for another. Driven by `isCityBound()` in `utils/railroad/routeLookup.ts`, which checks the trip's
  destination against `staticData/railroad/cityTerminals.json`. GTFS `directionId`
  cannot do this: it is absent on ~32% of LIRR trips, and **every** Metro-North trip
  reports `directionId: 0` regardless of direction, putting Grand Central and New Haven
  in the same bucket. On LIRR alone the field is meaningful (1 = city-bound, 0 = out),
  but the destination check works for both railroads with full coverage. The list holds
  Penn Station, Grand Central, Atlantic Terminal, Long Island City and Hunterspoint Ave
  for LIRR, and Grand Central for Metro-North; it deliberately excludes Yankees-E 153
  St, which is a ballpark shuttle stop rather than a commuter terminal.
- **Text clips hard rather than ellipsizing.** An "..." costs roughly three characters
  of the very width it is reporting is short, and on a fixed panel a name cut mid-word
  still reads. Two exceptions keep the ellipsis: the card *headers*, which have room for
  it, and the **route badge**, where a truncated branch name is easy to misread as a
  different branch.
- **Neither the railroad nor the bus card has a per-column subheading.** The railroad's
  said only "Departures", which the card header already conveys. A bus column's heading
  could only name one destination, but a stop serves several routes going different
  places, so the label was wrong for most of the column rather than merely redundant.
  Bus destinations therefore clip hard in a ~55px column; that is accepted.
- **Bus rows carry no direction marker.** One was tried and removed: with columns
  grouped by stop ID, every row in a column already shares a direction, so the arrow was
  redundant and cost width the destination needed. Beware that `StopPointRef` in the
  SIRI response is prefixed (`MTA_505513`), so it does not match the bare ID in the
  config — group on the configured ID.
- **The dataset's compass `direction` field goes up to 4** (N/S/E/W) per stop, but it is
  not in the SIRI response and is unused here.
- **A bus corner's two IDs share a `stop_name`.** Both sides of Borden Av/5 St are
  "BORDEN AV/5 ST", which is why they belong on one card rather than two
  indistinguishable ones.
- Both IDs must be listed in `staticData/bus/route_info.json` or the header falls back
  to `Bus Stop <id>`.

### Subway station nuances

- **A station name can map to several stop IDs.** "Times Sq-42 St" is four separate
  records — `127` (1/2/3), `R16` (N/Q/R/W), `725` (7), `902` (the shuttle) — sharing a
  `complex_id`. A card takes one `stopId`, so it shows one platform group, not the whole
  complex. Configuring the "wrong" one is silent: you get real trains, just not the line
  you meant.
- **One stop ID can serve many lines.** Coney Island-Stillwell Av (`D43`) carries D, F,
  N and Q on a single ID. The card's `lines` must list every one whose feed you need,
  since `lines` selects *feeds*: D/F come from `bdfm`, N/Q from `nqrw`. Omit a line and
  its trains simply never appear — `127` with `lines: ["1","2","3"]` returns 23
  departures per direction, but fetching only D/F/N/Q returns zero for it.
- **`north_direction_label` / `south_direction_label`** in the station GeoJSON give MTA's
  own wayfinding text ("Manhattan", "Last Stop", "Hudson Yards"), which the cards use in
  place of "Northbound"/"Southbound". Note "Last Stop" is a *label*, not a reliable
  terminal test — trust the feed, not the label.

### SIRI error handling

The bus API reports a bad stop ID as **HTTP 200** with the failure in the response
body, not as an error status:

```json
{"Siri":{"ServiceDelivery":{"StopMonitoringDelivery":[{"ErrorCondition":
  {"OtherError":{"ErrorText":"No such stop: MTA NYCT_700748. ..."}}}]}}}
```

A `!response.ok` check therefore passes, `MonitoredStopVisit` is absent, and the
optional-chained extraction yields `[]` — indistinguishable from "no buses due".
`fetchBusData()` checks for `ErrorCondition` explicitly and throws; do not remove
that check, and note `MonitoredStopVisit` is optional on the response type because
it is genuinely absent in error responses.

### Vite Configuration

The project uses:
- React Compiler plugin (`babel-plugin-react-compiler`)
- Custom GeoJSON loader plugin for `.geojson` files
- ESM module type

## Environment Variables

```bash
# Required for bus data
VITE_MTA_API_KEY=your_api_key_here
```

Get an API key from: https://api.mta.info/

Only the **bus** SIRI API needs a key. The GTFS-RT protobuf feeds (subway, LIRR,
Metro-North) are unauthenticated — the MTA dropped that requirement in Aug 2023, so
older examples that send `x-api-key` on those endpoints are out of date.
