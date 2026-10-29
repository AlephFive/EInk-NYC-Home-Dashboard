/**
 * Which protobuf feed a subway route belongs to.
 *
 * Split out from `fetchTrainData.ts` because that module imports the
 * generated protobuf decoder, and this mapping is wanted in places that must
 * not pay for it — the Worker's per-request feed cache, and tests running
 * under `node --experimental-strip-types`, which rejects the generated
 * enums outright.
 *
 * The MTA groups its lines into eight feeds, and a feed returns every line in
 * its group, so these keys decide the Worker's dominant cost: decoding
 * `a_division` alone measured 3.95ms warm against a 10ms CPU budget.
 */

import apis from "../../staticData/subway/apis.json";
import { subwayRouteIds } from "./routeLabel";

/**
 * The feeds an id belongs to, accepting either a feed route id (`FS`) or the
 * label a rider reads (`S`).
 *
 * `lineMappings` is keyed on the feed's own ids, because one label can span
 * three feeds — every shuttle is signed `S`, but GS, FS and H live in
 * a_division, bdfm and ace respectively. A label is therefore expanded
 * first, and resolves only through the ids behind it.
 */
export function feedKeysFor(line: string): string[] {
  const keys = new Set<string>();
  for (const id of subwayRouteIds(line)) {
    const key = apis.lineMappings[id as keyof typeof apis.lineMappings];
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * A cache key naming every feed a set of lines needs.
 *
 * Two cards whose lines differ but whose feeds coincide must share one fetch:
 * 1/2/3, 4/5/6 and 7 are three line sets and one feed. Keying a cache on the
 * lines instead fetches and decodes `a_division` once per card, which is
 * ~4ms of CPU each against a 10ms budget — and produces a board that looks
 * entirely correct, so nothing but this key reveals it.
 *
 * Sorted, so ["7","1"] and ["1","7"] agree.
 */
export function subwayFeedKey(lines: string[]): string {
  const feeds = new Set<string>();
  for (const line of lines) {
    for (const key of feedKeysFor(line)) feeds.add(key);
  }
  return [...feeds].sort().join(",");
}
