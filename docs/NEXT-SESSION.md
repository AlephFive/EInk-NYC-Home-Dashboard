## `trmnlp push` rewrites settings.yml — check the diff

The plugin exists: **524413**, https://trmnl.com/plugin_settings/524413/edit

`push` writes the server's normalised copy back over `src/settings.yml`, and
that round-trip is lossy. After the first push it had:

- `refresh_interval` **900 -> 1440** (15 minutes became 24 hours)
- `recipe_overview` and `categories` **dropped** — the store listing copy
- `placeholder: "1,2,3"` -> `123`, a quoted string read as a number
- em-dashes mojibaked (`—` -> `â€"`), so something reads the file as cp1252

Only the `id` was worth keeping, and it is now committed. **After any push,
`git diff` the file and restore everything but the id.** Do not let the
server's copy stand.

## Station picker: fixed, needs one retest

`depends_on` is not supported on `xhrSelectSearch` — it is an `xhrSelect`
property — and declaring it stopped the widget initialising. The dropdown was
empty and the Worker saw no request at all.

Fixed: `depends_on` removed, and each slot's endpoint now carries its own
slot (`/api/stations?slot=2`) so the Worker reads that card's transit type
rather than the first one it finds. Deployed and verified by hand.

**Still to confirm in the UI**: push the plugin, open card 1, and check the
dropdown now populates. If it does, the question of whether the search widget
renders at all is finally answered yes.

## State

| | |
|---|---|
| Branch | `phase2-layout`, 9 commits ahead of `main`, pushed |
| Worker | deployed and live, but **running phase 1 code** — `main` has moved since |
| CI | green on all three workflows |
| Plugin | never pushed to TRMNL; `src/settings.yml` has no `id` yet |

## What phase 2 produced

The board on TRMNL's framework: three columns, each splittable in two,
direction columns side by side, route badges, outlined urgent rows, per-card
error and empty states. Plus the three mashup layouts, TRMNL X scaling, a demo
board for unconfigured installs, store metadata, and payload trimming.

Renders are in `docs/images/`. The plan and its open questions are in
`docs/PHASE-2-LAYOUT.md`.

## Pick up here

1. **Re-run `/code-review max`.** It died on a rate limit mid-session, so the
   last review pass was self-review only. Worth a second opinion before
   submitting anything.
2. **Merge `phase2-layout` to `main`** (squash, per convention). That triggers
   the Worker deploy, which updates the live endpoint to match.
3. **Push the plugin to TRMNL.** Needs `trmnlp login`, then `trmnlp push`.
   Copy the returned plugin id into `src/settings.yml` **before** enabling the
   push job in `.github/workflows/plugin.yml` — without an id, every run
   creates a new plugin instead of updating one.
4. **See it on the real device**, which is the one thing never yet tested. The
   whole board has only ever been rendered by `trmnlp build --png`.
5. **Submit**, when ready: plugin id, owner email, rationale, a video of
   installation from scratch, and test credentials, to `team@trmnl.com`.

## Known gaps

- **Arrow-shaped railroad badges** were dropped in the port. The dashboard
  clips them into chevrons to carry direction; `label` has no such variant.
  Arguably moot now that duplicate destinations are suppressed, but it is a
  deliberate loss rather than an oversight.
- **The half/quadrant layouts have never been seen at their real size.**
  trmnlp previews every layout at 800x480 regardless, so their cell
  dimensions were derived rather than observed.
- **`trmnlp lint` only validates `label--*` sizes.** Five classes that do not
  exist in v3.4.4 have passed lint silently: `nowrap`, `overflow--hidden`,
  `items--stretch`, `col--start` inside `.content`, and `flex--1` — the last
  used thirteen times across four layouts before being caught. The real
  flex-grow utility is `grow`, and `basis--0` is needed alongside it for an
  even split.
  Check new utility classes against the framework stylesheet directly:
  `curl -s https://trmnl.com/css/3.4.4/plugins.css | grep -F '.classname{'`

## Deferred by decision

- **Caching the MTA feeds across requests.** One fetch returns a whole
  division — 349 stops on `a_division` — so every user on those lines pulls
  identical bytes. Worth doing at ~100 installs, pointless at one, since polls
  are 15 minutes apart. Reasoning and the measured numbers are in the spec,
  §7.2.

## Gotchas worth not rediscovering

- **A deployed Worker runs in UTC.** `wrangler dev` inherits the developer's
  zone, so a timezone bug is invisible locally. CI guards this under `TZ=UTC`.
- **TRMNL refuses to poll a private address**, so a local Worker cannot back
  the preview. `.trmnlp.yml` carries a captured response under `variables:`
  instead — **delete that block once a real polling URL is set**, or the board
  keeps rendering frozen departures.
- **`trmnlp` needs a Windows-style path** for its Docker volume mount;
  `/tmp/...` from Git Bash silently fails to mount.
- **The demo board is what an unconfigured install shows.** It is live data
  from Times Square, Penn Station and Grand Central, flagged `d` so the panel
  labels itself "Example". That also keeps the author's home stations out of
  the public recipe preview.
