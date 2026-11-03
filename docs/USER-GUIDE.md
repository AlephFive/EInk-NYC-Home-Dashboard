# NYC Transit Board — user guide

A departure board for the five New York networks, filtered by how long it
takes you to walk to the stop. Every row is something you can still catch
if you leave now.

This is the long-form guide. The plugin's own form carries a short
description and help text on every field; this covers the parts that need
examples.

---

## The grid

Six cards, in three columns of two:

```
Column 1 · Row 1   Column 2 · Row 1   Column 3 · Row 1
Column 1 · Row 2   Column 2 · Row 2   Column 3 · Row 2
```

Leave a slot's station blank and its column-mate fills the column,
showing roughly twice as many departures. Unticking **Show this card**
does the same without losing the settings — useful for a station you only
use on weekdays.

---

## Choosing a station

Type at least two characters into **Station or stop** and pick from the
list. One search covers all five networks, and each result says which:

```
Jamaica (E J Z) · Subway
Jamaica (LIRR) · LIRR
```

Two things the picker does for you:

- **A subway complex is offered once.** Times Square spans five platform
  groups; picking it gets all of them, not whichever one you happened to
  match.
- **A bus corner is offered once.** A stop ID is one side of the street,
  so a corner is two IDs, and the card shows one column per direction.

---

## Filtering routes

The **Routes** field narrows a card to the routes you actually ride.
Leave it blank for everything that calls there.

**Comma separated. Spaces around the commas are fine.** Matching ignores
case and accepts the start of a name.

| Network | What to type | Notes |
|---|---|---|
| Subway | `1,2,3` or `A, C, E` | Letters or numbers, as a rider says them |
| Subway shuttles | `S` | Covers all three — 42 St, Franklin Av, Rockaway |
| Staten Island Railway | `SI` | |
| Subway express | `7` | The express is included automatically |
| LIRR | `Babylon` or `Port Jefferson` | The branch name, without "Branch" |
| Metro-North | `Hudson`, `Harlem`, `New Haven` | |
| Bus | `M42` or `Q101, Q103` | The route as signed |
| Ferry | `ER`, `SG`, `AS` | The operator's route code |

**Prefixes work**, which is the fastest way to type a long branch:

```
hud          →  Hudson
far          →  Far Rockaway
port jeff    →  Port Jefferson
```

Be careful with very short ones: `H` matches both **H**arlem and
**H**udson. That is deliberate — a filter that is too generous shows an
extra row, where one that is too strict empties the card and looks
broken.

**The 7 express is not separate.** The MTA runs it as `7X` and the board
draws it as a diamond, but asking for `7` includes it. The same is true
of any express.

---

## Choosing a direction

**Direction** narrows a card to one way. Leave it blank for both.

Most people only ride one way from a given stop, and giving those rows
the whole card is worth more than listing trains they will never take.

- **Subway and bus:** 1 and 2 are the card's left and right columns. The
  heading above each says where it goes — pick one and check.
- **Railroad:** 1 is towards the city, 2 is away from it.

> **At a terminal, direction 1 is empty.** Grand Central and Penn Station
> are where trains *end*, so nothing departs from them towards the city.
> This is correct, not a fault. Use blank or 2 there.

---

## Splitting a station across two cards

A complex like Times Square carries twelve routes, and twelve bullets on
one card tell you less than a few on two. Point both rows of a column at
the same station and filter each:

| | Column 1 · Row 1 | Column 1 · Row 2 |
|---|---|---|
| **Station** | Times Sq-42 St | Times Sq-42 St |
| **Routes** | `1,2,3` | `N,Q,R,W` |
| **Card heading** | Times Sq 123 | Times Sq NQRW |

The same trick splits a station by **direction** rather than by route,
which is the better choice when you take one line both ways:

| | Column 1 · Row 1 | Column 1 · Row 2 |
|---|---|---|
| **Station** | 116 St-Columbia University | 116 St-Columbia University |
| **Direction** | 1 | 2 |
| **Card heading** | Downtown | Uptown |

Each card then shows one direction at full width, so destinations have
room instead of being clipped into two narrow columns.

---

## Ferries

NYC Ferry works like the others, with two differences worth knowing:

- **Landings are listed by name** — Wall St/Pier 11, Hunters Point South,
  East 34th Street. Search the landing, not the route.
- **A quiet landing is normal.** Ferries run far less often than trains,
  and service is seasonal on some routes. An empty ferry card outside
  commuting hours usually means no boat is due, not that something broke.

Route codes go in the **Routes** field if a landing serves more than one
and you only want some. The ones the feed uses:

| Code | Route |
|---|---|
| `ER` | East River |
| `SB` | South Brooklyn |
| `SG` | St. George |
| `RS` | Rockaway |
| `AS` | Astoria |

---

## Walk time

**Walk time** is how long it takes you to reach the stop. Departures you
could not physically reach are hidden, which is the whole point of the
board: every row is catchable.

Set it honestly. Too low and you will see trains you cannot make; too
high and a nearby stop looks emptier than it is.

---

## Display settings

| Setting | What it does |
|---|---|
| **24-hour clock** | 16:45 rather than 4:45 PM |
| **Highlight departures within** | How soon counts as urgent, counted *after* walk time. Highlighted rows are drawn white on black. Lower it if most of the board ends up marked — once half the rows are highlighted, nothing is. |
| **Destination text size** | Smaller shows more of a long station name |
| **Show "leave in N minutes"** | Off by default. A countdown is stale by up to one refresh interval, where a clock time never is. |

---

## When a card looks wrong

**"No upcoming departures"** means the feed answered and had nothing due.
It is not an error. Common causes: peak-only service, service has ended
for the night, or everything due is inside your walk time.

**A card you configured is missing.** Its station could not be resolved —
usually a value saved before a picker change. Re-pick the station.

**A bus card goes quiet while the others are fine.** Bus stop IDs expire;
the MTA retires and re-IDs stops. Re-pick the stop.

**One card shows an error while the rest work.** That is by design — a
failing feed costs its own card and nothing else. An unattended panel
showing five good cards beside one gap beats a blank panel.

---

Source, issues and development notes:
[github.com/AlephFive/EInk-NYC-Home-Dashboard](https://github.com/AlephFive/EInk-NYC-Home-Dashboard)
