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

## Proposed order

Low risk, clears the lint baseline:

1. Delete the dead `totalSize` reduce (7)
2. Remove the `console.log`s (10)
3. Delete orphaned modules and dead exports, keeping what planned work needs (8, 9, 14)
4. Fix the `any` escapes (13)
5. Drop the pointless `async` (12)
6. Resolve the unused `subwayLine` parameter (20)

Structural, larger diffs:

7. Extract `DepartureRow` / `EmptyRow` into `components/` (3)
8. Move generic helpers into `utils/` (4)
9. Unify the three render functions behind shared filter/urgency helpers (2, 15)
10. Extract fetch orchestration out of `useEffect` (6)
11. `TransitCard.tsx`: extract the repeated header/error skeleton (5)

Deferred to the redesign: 17, 18. Flagged only: 19.

**Note:** deleting `displayMode.ts` (9) means `VITE_DISPLAY_MODE` stops existing — `.env.example`, the README and `CLAUDE.md` all reference it and would need updating in the same change.
