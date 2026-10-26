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
