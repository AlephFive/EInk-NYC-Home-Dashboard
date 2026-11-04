# Store listing copy

The long description is already live in `plugin/src/settings.yml` as
`recipe_overview` and reads well — **do not rewrite it**. This file holds
the short fields, plus the pieces a reviewer asks for that are not in the
plugin's own YAML.

## Name

    NYC Transit Board

## Tagline

Current (`settings.yml:18`), and it is the right one:

    NYC departures you can still catch

## Categories

`transit`, `productivity` — already set at `settings.yml:54-56`.

## Long description

Ships as `recipe_overview`, `settings.yml:20-50`. Its argument, in order:
the walk-time filter is the point; stations are searched by name, not stop
ID; clock times beat countdowns on a panel that refreshes on an interval;
live feeds only, with per-card failure; four layouts designed per cell.

One line to add if the store wants a setup link:

    Setup guide: https://brian.ma/nyc-transit-board/

## Screenshots

`docs/images/` already holds device captures. Best candidates:

| File | Shows |
| --- | --- |
| `phase2-board.png` | Full board, six cards, mixed networks — the lead image |
| `phase2-half-horizontal.png` | Mashup cell |
| `phase2-quadrant.png` | Quarter cell |
| `phase2-express-bullets.png` | Circle vs diamond, the MTA express rule |
| `phase2-branching-station.png` | Destinations differing down one card |

Lead with `phase2-board.png`. Shoot a fresh one after the layout testing
in `blockers.md` — these predate the current row styling.

## What a reviewer will ask

**Why a Worker instead of polling the MTA directly?**
Three reasons, all structural. The subway and railroad feeds are
GTFS-realtime protobuf, which Liquid cannot decode. A board needs up to
six stations merged, filtered by walk time and capped per card — that is
real computation, not templating. And the bus SIRI feed needs an API key,
which cannot live in a template users can read.

**What does the Worker store?**
Nothing. No database, no logs of user settings. Each request carries the
board's configuration in its POST body, is answered from the MTA feeds,
and is forgotten.

**Does it need credentials from the user?**
No. The MTA key is the plugin author's and is server-side only
(`buildBoard.ts`); it is never returned to a caller.

**Rate limits?**
One request per panel per refresh, 15 minutes minimum. Feeds are fetched
per transit type and deduplicated, not per station — a six-card board is a
handful of upstream requests, not thirty.
