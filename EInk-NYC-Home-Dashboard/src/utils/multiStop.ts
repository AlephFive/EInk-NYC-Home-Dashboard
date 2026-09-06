/**
 * Helpers for cards that cover several stop IDs.
 *
 * A single place often spans more than one stop: a bus corner is one ID per
 * direction, and a subway complex one per platform group. Fetched data and
 * errors stay keyed by individual stop — which is what keeps one dead stop
 * from taking down its neighbours — so a card gathers its own IDs and merges
 * them at render time.
 */

/**
 * The first error among a card's stops, if any of them failed.
 *
 * One message is enough: the card can only show one, and a card whose stops
 * all failed is no more broken than one with a single failure.
 */
export function collectErrors(
  stopIds: string[],
  errors: Record<string, string> | undefined
): string | undefined {
  if (!errors) return undefined;
  return stopIds.map((id) => errors[id]).find(Boolean);
}

/**
 * Flatten per-stop lists into one, ordered by time.
 *
 * @param parts - One list per stop; undefined entries (stops that never
 *   returned) are skipped rather than treated as empty
 * @param time - Reads the sort key from an item
 */
export function mergeSorted<T>(
  parts: (T[] | undefined)[],
  time: (item: T) => number
): T[] {
  return parts
    .filter((part): part is T[] => Array.isArray(part))
    .flat()
    .sort((a, b) => time(a) - time(b));
}

/**
 * Sort key for a GTFS-RT stop time: when the vehicle leaves, falling back to
 * when it arrives. At a terminal only one of the two is present.
 */
export const stopTimeOf = (stopTime: {
  departure?: { time?: number };
  arrival?: { time?: number };
}) => Number(stopTime.departure?.time ?? stopTime.arrival?.time ?? 0);
