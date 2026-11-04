# Installation video

TRMNL wants the flow from scratch: install, configure, see the board. Aim
for 2–3 minutes. No voiceover needed — captions over a clean screen
recording are enough, and they survive being watched muted.

Record **after** the layout testing in `blockers.md`, so the board on
screen is the board that ships.

## Shots

**1. Install (~15s)**
Plugin page in the TRMNL store → Install. Land on the settings form with
all six slots empty.

**2. One card, slowly (~40s)**
This is the shot that matters — everything after it is repetition.

- Card 1 → Station or stop → type `vernon`
- Pause on the dropdown. The results carry their network: `· Subway`.
  That one search covers all five networks.
- Pick *Vernon Blvd-Jackson Av*.
- Walk time → `5`. Caption: **departures you can't reach are hidden.**
- Save. Show the board with one card live.

**3. Fill the rest (~30s)**
Speed through cards 2–6, one per network so the finished board shows all
five. Suggested, and all verified working during development:

| Slot | Station | Why it's in the video |
| --- | --- | --- |
| 2 | Jamaica · LIRR | Many branches, destinations differ from badges |
| 3 | Grand Central · Metro-North | Names the network in the result |
| 4 | a bus corner | Two columns, one per direction |
| 5 | Wall St/Pier 11 · Ferry | Fifth network |
| 6 | Times Sq-42 St + routes `1,2,3` | Leads into shot 4 |

**4. Route filter (~20s)**
On card 6, show `Routes` empty — twelve routes crowding the card — then
type `1,2,3` and save. Caption: **one station, only the lines you ride.**

**5. The panel (~20s)**
Cut to the physical device. Hold long enough to read it. Point out:

- a highlighted row — **leave now**, counted after walk time
- a diamond bullet beside a circle — same line, running express
- the footer marks naming the networks on screen

**6. Mashup (~15s)**
Put the plugin in a half cell beside another plugin. Shows the layouts are
per-cell designs rather than a scaled-down full screen.

## Don't film

- The Cloudflare Worker, `wrangler`, or any terminal. The reviewer is
  checking the user's experience.
- The API key, the plugin's edit page, or anything with a token in it.
- Hunting for a station you cannot remember. Script the searches.
