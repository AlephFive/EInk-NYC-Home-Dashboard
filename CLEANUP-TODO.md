# Code quality cleanup — candidates

Working notes for the `code-quality-cleanup` branch. Temporary: delete this file when
the branch is done, folding anything still outstanding into `CLAUDE.md`'s planned work.

Phase 1 lists everything spotted. Phase 2 gives each a verdict with evidence. Nothing
here is actioned yet — verdicts are a proposal for Shao-en to greenlight.

---

## Phase 1 — identified

1. `App.tsx` is 764 lines doing orchestration, rendering and layout
2. Three render functions ~80% identical
3. `DepartureRow` / `EmptyRow` are components living in `App.tsx`
4. Generic helpers (`mergeSorted`, `collectErrors`, `stopTimeOf`, `mostCommon`) live in `TransitCard.tsx`
5. `TransitCard.tsx` is 573 lines with four near-identical card branches
6. Fetch orchestration inside `useEffect` is module-sized
7. Dead `totalSize` reduce in `subway/fetchTrainData.ts`
8. Nine exported functions with no callers
9. Three modules with zero importers: `displayMode.ts`, `subway/stations.ts`, `subway/subwayColors.ts`
10. `console.log` on every station lookup, in production
11. Seven pre-existing lint errors
12. `extractDataByStop` / `getUpcomingTrainsAtStation` are `async` but never await
13. `: any` escapes in three files
14. `getStationInfo` returns `any`
15. Duplicated `urgentThresholdMinutes ?? 10` in three places
16. Subway and railroad `fetchTrainData.ts` are near-duplicates of each other
17. Magic numbers scattered through the layout styles
18. Inline styles throughout rather than a shared style module
19. No tests anywhere
20. `subwayLine` parameter on `extractDataByStop` is never passed

---

## Phase 2 — evaluated

| # | Verdict | Evidence and reasoning |
|---|---|---|
| 1 | **REAL** | `wc -l` = 764. Mixes four concerns. The parent issue behind 2, 3 and 6. |
| 2 | **REAL** | `renderTrainList:451`, `renderFerryList:556`, `renderBusList:600`. Each repeats the same filter-by-walkTime → slice → map → urgency shape; `>= walkTime` and `slice(0, limit)` appear three times each. |
| 3 | **REAL** | Both are components, not helpers, and are used only by cards. Belong in `components/`. |
| 4 | **REAL** | None are card-specific. `mergeSorted` and `stopTimeOf` are generic list utilities. |
| 5 | **REAL** | 573 lines. The four branches repeat the same header/error/body skeleton; the header markup is duplicated four times verbatim. |
| 6 | **REAL** | The `useEffect` body runs ~200 lines and is testable in isolation only if extracted. |
| 7 | **REAL** | `subway/fetchTrainData.ts:157-161`. Computes `totalSize` by summing `mergedEntities.length` per feed — meaningless, and its own comment admits it estimates. Source of two of the seven lint errors. |
| 8 | **REAL, partly** | Verified no callers: `getSubwayLineColor(s)`, `getSubwayLineTextColor`, `getStationInfo`, `isDisplayBlackAndWhite`, `getDisplayBackgroundColor`, `getFerryStops`, `getBusRouteInfo`, `getRailroadRouteColor`. **But** the colour helpers become live again if the redesign uses line colours, and `getFerryStops` when ferry goes live. Delete the clearly-dead; keep what planned work needs. |
| 9 | **REAL** | Zero importers each. `displayMode.ts` is fully orphaned — the 1-bit conversion happens in the screenshot server via ImageMagick, so `VITE_DISPLAY_MODE` does nothing. That is also **doc drift**: `.env.example` and the README still document the variable. |
| 10 | **REAL** | `stationLookup.ts:35,52,80,93`. Line 35 logs the entire parsed GeoJSON on import; 80 and 93 fire on every lookup. Noise in the only place errors would be visible. |
| 11 | **REAL** | 7 errors, all pre-existing: 5 × `no-explicit-any`, 2 × `no-unused-vars`. Fixing 7 and 13 clears all of them. |
| 12 | **REAL, cosmetic** | Eight `export async function`s; `extractDataByStop` and `getUpcomingTrainsAtStation` do pure array work. Callers must `await` for no reason. Harmless but misleading about cost. |
| 13 | **REAL** | `railroad/fetchTrainData.ts:186`, `stationLookup.ts:38`. The railroad one exists because entities are tagged with a non-proto `_railroad` field — fixable with a proper intersection type. |
| 14 | **REAL** | `stationLookup.ts:129` returns `any`, so callers get no checking. Also unused (see 8), so deleting it resolves both. |
| 15 | DISMISSED | Three occurrences of a one-line default read. Folds into 2 for free; not worth its own item. |
| 16 | DISMISSED | They look similar but differ meaningfully: subway appends N/S suffixes, railroad tags entities by source and settles per railroad. Merging them would need a config-object abstraction that obscures both. Duplication here is honest. |
| 17 | **REAL, low** | Row heights and header heights are already named constants; padding and gaps are not. Worth doing *with* the redesign, not before it — the values will change. |
| 18 | DISMISSED | Real, but converting inline styles to a system is the redesign (planned work #6), not cleanup. Doing it now means doing it twice. |
| 19 | **REAL, out of scope** | No test infrastructure at all. Adding a framework is its own decision, not a cleanup task — flag and leave. |
| 20 | **REAL** | `extractDataByStop(feedMessage, stopId, subwayLine?)` — `App.tsx` never passes the third argument, so the filter is dead. Deliberate (it is why rerouted trains still show), but an unused parameter that reads as a supported feature. Either remove it or document why it must stay unused. |

---

## Extraction list

Items 2, 3 and 4 named the *areas*; these are the specific functions, each verified as
repeated or misplaced. Proposed homes assume `utils/` for logic and `components/` for
rendering.

### Repeated logic — extract to `utils/departures.ts`

| Extract | Repeated at | Note |
|---|---|---|
| `minutesUntil(time)` | `App.tsx:443` (as `getMinutesUntil`, seconds) and `:611` (inline, `Date`) | Two implementations of the same idea, one taking Unix seconds and one a `Date`. One helper accepting both. |
| `formatClockTime(time)` | `:434`, `:586`, `:643` | Three `toLocaleTimeString` calls with identical options, each repeating `hour12: !displayConfig.use24HourTime` (`:437`, `:589`, `:646`). |
| `leaveTimeFor(minutes, walkTime)` + `isUrgent(leaveTime)` | `:505-506`, `:575-576`, `:631-632` | The same two lines three times, plus `urgentThresholdMinutes ?? 10` read separately in each render function. |
| `reachableWithin(items, walkTime, limit, timeOf)` | `renderTrainList:473`, `renderFerryList:565`, `renderBusList:617` | The filter-then-slice shape, identical but for how each type reads its time. A `timeOf` accessor parameterises the difference. |

### Misplaced generic helpers — move out of `TransitCard.tsx` to `utils/`

`mergeSorted`, `stopTimeOf`, `collectErrors`, `mostCommon`. None are card-specific;
`mergeSorted` and `mostCommon` are generic list utilities. Note `mostCommon` is currently
**unused** — the bus column heading that consumed it was removed — so it should be deleted
rather than moved.

### Components living in `App.tsx` — move to `components/`

`DepartureRow` and `EmptyRow`, plus the `ROW_HEIGHT` and `listStyle` constants they own.

### Repeated markup — extract to a `CardShell` component

The card header block is duplicated **four times verbatim** in `TransitCard.tsx` (grep for
`borderBottom: "2px dotted #000"` — four identical hits at the ferry, subway, railroad and
bus branches). Each branch also repeats the same skeleton: resolve `cardError`, map
`card.stopIds` to data, bail if neither, render header, then render either `CardError` or
the body (`:200`, `:281`, `:412`, `:478`). A shell taking a type mark, title and body
would collapse all four.

### Deliberately not extracted

- The two `fetchTrainData.ts` modules (item 16) — differences are real, not incidental.
- `SubwayBullets` and `CardError` — already extracted, single-use but correctly placed.

---

## Proposed order

### Low risk — DONE (lint baseline now clean, 7 errors -> 0)

1. ~~Delete the dead `totalSize` reduce (7)~~ — also removed the `dataSize` metadata
   field it fed, which nothing read, from both fetchers.
2. ~~Remove the `console.log`s (10)~~ — the `console.warn` for a missing stop is kept;
   that is the retired-stop-ID signal.
3. ~~Delete orphaned modules and dead exports (8, 9, 14)~~ — deleted `subway/stations.ts`
   (superseded, and importing a path that does not exist) and `displayMode.ts`
   (redundant: the server does the 1-bit conversion, `renderer.ts:110`), plus
   `getStationInfo`. **Kept** `subwayColors.ts` and its exports for the redesign, and
   `getFerryStops` for the live-ferry work.
4. ~~Fix the `any` escapes (13)~~ — `TaggedEntity` for the railroad's `_railroad` field,
   a `FerryScheduleData` shape for the schedule JSON, typed GeoJSON properties. The last
   of these caught two genuinely-optional fields being assigned to required ones.
5. ~~Drop the pointless `async` (12)~~ — `extractDataByStop` and
   `getUpcomingTrainsAtStation` in both fetchers, plus the three now-redundant `await`s.
6. ~~Resolve the unused `subwayLine` parameter (20)~~ — documented rather than removed:
   it must stay unused, because matching on stop ID alone is what makes rerouted trains
   appear.

Structural, larger diffs:

7. Extract `DepartureRow` / `EmptyRow` into `components/` (3)
8. Move generic helpers into `utils/` (4)
9. Unify the three render functions behind shared filter/urgency helpers (2, 15)
10. Extract fetch orchestration out of `useEffect` (6)
11. `TransitCard.tsx`: extract the repeated header/error skeleton (5)

Deferred to the redesign: 17, 18. Flagged only: 19.

**Note:** deleting `displayMode.ts` (9) means `VITE_DISPLAY_MODE` stops existing — `.env.example`, the README and `CLAUDE.md` all reference it and would need updating in the same change.
