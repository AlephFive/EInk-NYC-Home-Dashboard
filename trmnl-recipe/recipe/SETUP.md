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

Each card needs a transit type and a station. The station picker only populates
after a type is chosen, since it searches that type's dataset.

Slots map to the 3x2 grid in order:

```
Card 1 | Card 3 | Card 5     (top row)
Card 2 | Card 4 | Card 6     (bottom row)
```

A slot left **Off** is omitted, and its column-mate fills the column.

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
