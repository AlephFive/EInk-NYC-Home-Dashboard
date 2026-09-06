# EInk-NYC-Home-Dashboard

An 800×480 transit board for a home e-ink panel. Shows NYC subway, LIRR/Metro-North,
bus, and ferry departures, filtered by the walk time to each stop — departures you
could not reach in time are never shown.

The app is a static page rendered by a sibling screenshot server
(`Lightweight-Eink-Server`), which converts it to a 1-bit PNG the panel polls.

## Setup

```bash
cd EInk-NYC-Home-Dashboard
npm install
cp .env.example .env   # then add your MTA API key
npm run dev
```

`VITE_MTA_API_KEY` (from https://api.mta.info/) is required for bus data.
`VITE_DISPLAY_MODE=bw` collapses colors to pure black/white for the panel.

## Configuring what's displayed

Edit `src/displayConfig.ts`. The layout is **column-first**: the outer array is
columns left-to-right, and each inner array holds at most 2 cards stacked top to
bottom.

```ts
columnDisplay: [
  [{ transitType: "subway", stopIds: ["721"], lines: ["7"], walkTime: 10 },
   { transitType: "subway", stopIds: ["127"], lines: ["1","2","3"], walkTime: 15 }],
  [{ transitType: "bus", stopIds: ["505513", "505507"], walkTime: 3 },
   { transitType: "subway", stopIds: ["D43"], lines: ["D","F","N","Q"], walkTime: 5 }],
  [{ transitType: "railroad-lirr", stopIds: ["102"], walkTime: 5, departures: 8 }],
]
```

`stopIds` takes **one or more** IDs, because a single place often has several. A bus
corner is one ID per direction, so listing both puts both directions on one card. Many
subway complexes split by platform group — Times Sq is five IDs — so listing several
merges them. The card is titled after the first ID's station name unless you set
`title`.

That produces a 2x2 block of four cards with a full-height card beside it — a column
holding one card stretches it to the column's whole height. Two columns of two gives
you a 2x2; three columns of two gives 3x2.

`walkTime` is minutes from home to that stop; departures you couldn't reach in time
are filtered out.

Each departure renders as `[route badge] [destination] [time]`, with every row a fixed
height so cards line up. Railroad badges drop the redundant "Branch" suffix ("Babylon
Branch" shows as "Babylon"), and the destination is blank when a train terminates at
that stop — common at a terminal like Grand Central.

`showLeaveIn` adds a "Go in N mins" column to each departure, subtracting `walkTime`
from the arrival. It is **off by default**: the panel is screenshotted on an interval, so a
countdown is stale by up to that interval while the arrival clock time never is. The
walk-time filter applies either way.

**How many departures each card shows** is worked out from the card's height, so a card
alone in a column shows about twice as many as one sharing a column, and re-arranging
the layout needs no retuning. Set `departures` on a card, or `defaultDepartures`
globally, to override it. Subway, ferry and bus cards show two columns, so the number
applies *per column*; railroad cards show a single list.

`fetchDepartures` controls how many are requested per stop for the feeds that take a
limit (bus and ferry). Keep it comfortably above the displayed count — departures
inside your `walkTime` are discarded *after* fetching, so requesting exactly as many as
you display leaves cards short. Subway and railroad ignore it: their GTFS-RT feeds
return every upcoming departure in a single response.

## Finding stop IDs

Every card in `displayConfig.ts` is identified by a `stopId`, and each transit type
draws that ID from a different source. Subway, railroad, and ferry IDs are all in
`src/staticData/` — no API calls needed. Bus IDs come from a live dataset, because
they expire.

### Subway

IDs live in `src/staticData/subway/MTA_Subway_Stations_20251126.geojson`. Search it for
the station name and read `gtfs_stop_id`:

```bash
python -c "
import json
d = json.load(open('src/staticData/subway/MTA_Subway_Stations_20251126.geojson', encoding='utf-8'))
for f in d['features']:
    p = f['properties']
    if 'vernon' in p['stop_name'].lower():
        print(p['gtfs_stop_id'], '|', p['stop_name'], '| routes:', p.get('daytime_routes'))
"
# 721 | Vernon Blvd-Jackson Av | routes: 7
```

Use the ID **without** a direction suffix — `721`, not `721N`/`721S`. The app appends
the suffix itself and queries both directions.

The `daytime_routes` field tells you which lines serve that platform; it's what the
card's `lines` field should list. `lines` selects which MTA feed to download (the MTA
splits the subway across 8 protobuf endpoints), so it's required, and a card whose
`lines` is missing or wrong will fail to load.

### Railroad (LIRR / Metro-North)

IDs are in `src/staticData/railroad/lirr/stops.txt` and `.../mtn/stops.txt`. Both are
CSVs whose first column is `stop_id`, but note they have **different schemas** — LIRR
has 7 columns, Metro-North 11 — so read the header rather than assuming positions.

```bash
grep -i "grand" src/staticData/railroad/lirr/stops.txt
# "349","GCT","Grand Central",...   <- Grand Central Madison (LIRR)

grep -i "grand" src/staticData/railroad/mtn/stops.txt
# 1,0NY,Grand Central,...           <- Grand Central Terminal (Metro-North)
```

Two traps here:

- **The two railroads reuse the same ID space.** LIRR `118` and Metro-North `118` are
  different stations, so the ID alone is meaningless — it's only valid together with
  `transitType: "railroad-lirr"` or `"railroad-mtn"`. Look the ID up in the file for the
  railroad you're configuring.
- **Grand Central is two different stations.** LIRR trains serve Grand Central Madison
  (`349`), Metro-North serves Grand Central Terminal (`1`). Same name, different levels,
  different IDs, different feeds.

Railroad IDs carry no direction suffix — direction is implied by each train's route.

### Bus

Bus IDs come from the live [MTA Bus Stops dataset](https://data.ny.gov/Transportation/MTA-Bus-Stops/2ucp-7wg5/)
on NY Open Data rather than a local file. Filter by `route_short_name` to list a
route's stops.

> **Bus stop IDs expire.** Rows carry `valid_from` / `valid_to`, and the MTA
> periodically retires and re-IDs stops — this dashboard's Q101/Q103 stop was re-IDed
> on 2026-04-12 (`700748` → `505506`), silently breaking the bus card until the config
> was updated. Changing a bus stop means updating **both** `src/displayConfig.ts` and
> the `stops` map in `src/staticData/bus/route_info.json` (the latter supplies the
> card's display name).

To check whether a stop is still current:

```bash
curl -s --get "https://data.ny.gov/resource/2ucp-7wg5.json" \
  --data-urlencode "\$where=stop_id='505506'" \
  --data-urlencode "\$select=route_short_name,stop_id,stop_name,valid_from,valid_to"
```

### Ferry

The `stopId` is the stop **name** as written in
`src/staticData/ferry/schedule.json`, e.g. `"Hunter's Point South"`. Match it exactly,
apostrophes included.

### Checking an ID actually returns data

An ID can be correct and still show nothing — some stops genuinely have no service at
the moment (see "When a card fails"). The quickest check is to run the app and look at
the card. If you want to confirm before configuring, the feeds are public: the GTFS-RT
endpoints in `src/staticData/*/apis.json` need no API key.

## When a card fails

Failures are reported **per card**. A stop or feed that fails renders an "Unavailable"
box in its own card while every other card keeps working — the board never blanks
because one feed is down. An unexpected top-level failure appears as a banner above the
cards rather than replacing them, and whatever data did load is still shown.

**Empty is not a failure.** A card with no departures shows "No upcoming trains" and
nothing more. The dashboard reports what the live feeds say; it doesn't consult static
timetables or guess whether an empty result means the branch doesn't run today, the
last train has gone, or everything left is inside your walk time. Some stops are
genuinely quiet — LIRR's Long Island City, for instance, is peak-direction-only and has
no weekend service at all.

Worth knowing when reading the code: the SIRI bus API reports a bad stop ID as
**HTTP 200** with an `ErrorCondition` in the response body, so failures there are
detected by inspecting the body, not the status code. See `CLAUDE.md` for details.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `tsc -b` + protobuf generation + `vite build` |
| `npm run lint` | ESLint |
| `npm run preview` | Serve the production build |

`npm run build` runs `gen:proto`, which needs `protoc` on PATH. If the `.proto` files
haven't changed, `npx vite build` alone is enough.
