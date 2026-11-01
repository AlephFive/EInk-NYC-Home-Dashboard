# Setting up the recipe — phase 1 (debug)

What this gets you: the board's data on a real device, rendered as plain text.
No styling — that is phase 2, and deliberately so. If a station is wrong or a
card fails, it is visible here with nothing between you and the data.

Three files in this directory go into the plugin:

| File | Where it goes |
|---|---|
| `form.yaml` | Custom Fields |
| `polling-url.txt` | Polling URL (the one-line version) |
| `markup-debug.liquid` | Markup |

---

## 1. Deploy the Worker

From `trmnl-recipe/`:

```bash
npm install
npx wrangler login
npx wrangler secret put MTA_API_KEY   # paste the key from the dashboard's .env
npx wrangler deploy
```

Deploy prints the hostname — something like
`trmnl-nyc-transit.<your-subdomain>.workers.dev`. **That hostname replaces
`REPLACE_ME` in both `form.yaml` (6 occurrences) and the polling URL.**

Check it before going further:

```bash
curl https://<your-host>.workers.dev/health
# {"ok":true}

curl -X POST https://<your-host>.workers.dev/api/stations/subway \
  -H 'content-type: application/json' -d '{"query":"times sq"}'
# [{"Times Sq-42 St (1/2/3/7/S/N/Q/R/W/A/C/E)":"subway:127+725+902+A27+R16"}]
```

**The paid Workers plan is required.** Protobuf decode exceeds the free tier's
10ms CPU budget — see `../spikes/RESULTS.md` for the measurements.

## 2. Create the plugin

On trmnl.com: **Plugins → Private Plugin → New**, strategy **Polling**.

Paste the three files into their boxes, with the hostname replaced. Set the
refresh rate to **15 minutes or slower** — that is the store minimum, and the
reason the board shows clock times rather than a countdown.

## 3. Configure a board

Each card needs only a station. There is no transit type to pick first — one
picker searches all five networks at once and labels each result with its
network, so typing "jamaica" offers the LIRR station, the subway station and
the AirTrain stop together. **Type at least two characters**; one is too
short to search on.

Each slot is named for where it lands, so there is no mapping to remember:

```
Column 1 · Row 1 | Column 2 · Row 1 | Column 3 · Row 1
Column 1 · Row 2 | Column 2 · Row 2 | Column 3 · Row 2
```

A slot is omitted, and its column-mate fills the column, if either its station
is empty or its **Show this card** box is unticked. Unticking is the
non-destructive one — it parks a card with its settings intact, for a summer
ferry or a weekday-only station.

## 4. What to check on the device

The point of the debug markup is that each line is verifiable:

- **Station names** — does each card's heading match what you picked? A bus
  card showing `Bus Stop <id>` rather than a street name means the picked name
  did not survive the polling URL.
- **Walk time** — raise one card's walk time and confirm its earliest
  departures disappear. The filter runs server-side, before the row limit.
- **`*URGENT`** — appears when a departure is within the threshold *after* walk
  time is subtracted, so it marks "you must leave soon", not "it arrives soon".
- **Empty vs. error.** `(no upcoming departures)` is not a failure — it means
  the feed returned nothing for that stop, which is normal for peak-only
  service. `!! ERROR` is a real fetch failure. The two are deliberately
  distinct, and a failing card must not blank the others.
- **Subway terminals** collapse to one direction. At a terminal every train in
  one direction terminates, so nothing there is boardable.
- **A card that vanished rather than erroring** had a station value the server
  could not resolve to a real stop, and was dropped on purpose — a card that
  can only ever show an error is worse than no card. Re-pick the station from
  the dropdown. Values stored before the picker began returning proper
  `{id, name}` pairs are the usual cause, and they cannot be repaired in
  place: the stored text is a display label, not an ID.

## Known gaps in phase 1

- **No styling.** Phase 2 rebuilds this on the TRMNL design framework.
- **Rows per card is a flat 5** (10 for a railroad card), not derived from card
  height. The framework measures height at runtime, so the real number is a
  phase 2 decision.
- **Ferry is omitted.** It is still schedule-based, which conflicts with the
  live-data-only rule. See the spec's open questions.
- **No payload enforcement.** The response reports its size in
  `x-payload-bytes`; it does not yet trim. Measured boards run 1.8KB against a
  5KB cap, so there is room, but a six-card board should be watched.
