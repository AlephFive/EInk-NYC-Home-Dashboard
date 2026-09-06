import displayConfig from "../displayConfig";

/**
 * Shared logic for turning a departure time into what a card shows.
 *
 * Every transit type answers the same three questions — when does it leave,
 * can I still reach it, and should it look urgent — but each stores its time
 * differently: GTFS-RT gives Unix seconds, SIRI and the ferry schedule give
 * `Date`. These helpers take either, so the per-type render code differs only
 * in how it reaches for its own time field.
 */

/** A departure time as any of the shapes the feeds provide. */
export type DepartureTime = number | Date | undefined;

const MS_PER_MINUTE = 60_000;

/** Normalise a feed's time to epoch milliseconds. GTFS-RT uses seconds. */
function toEpochMs(time: DepartureTime): number | null {
  if (time === undefined) return null;
  return time instanceof Date ? time.getTime() : time * 1000;
}

/**
 * Whole minutes from now until `time`, negative once it has passed.
 * @returns null when there is no time to measure
 */
export function minutesUntil(time: DepartureTime): number | null {
  const ms = toEpochMs(time);
  if (ms === null) return null;
  return Math.floor((ms - Date.now()) / MS_PER_MINUTE);
}

/**
 * Clock time as the board shows it, honouring `use24HourTime`.
 * @returns "N/A" when there is no time to format
 */
export function formatClockTime(time: DepartureTime): string {
  const ms = toEpochMs(time);
  if (ms === null) return "N/A";
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !displayConfig.use24HourTime,
  });
}

/**
 * Minutes until you must leave to catch a departure: what is left after the
 * walk to the stop. Negative means it is already unreachable.
 */
export function leaveTimeFor(
  minutes: number | null,
  walkTime: number
): number | null {
  return minutes === null ? null : minutes - walkTime;
}

/** Whether a departure is close enough that the row should be emphasised. */
export function isUrgent(leaveTime: number | null): boolean {
  if (leaveTime === null) return false;
  return leaveTime < (displayConfig.urgentThresholdMinutes ?? 10);
}

/**
 * The departures a rider could actually still catch, capped for display.
 *
 * Filtering happens *before* the cap so the card fills with reachable
 * departures rather than being padded with ones already out of reach.
 *
 * @param items - Departures for one stop, already sorted by time
 * @param timeOf - Reads the departure time from an item
 * @param walkTime - Minutes needed to reach the stop
 * @param limit - Most rows to return
 */
export function reachableDepartures<T>(
  items: T[],
  timeOf: (item: T) => DepartureTime,
  walkTime: number,
  limit: number
): T[] {
  return items
    .filter((item) => {
      const minutes = minutesUntil(timeOf(item));
      return minutes !== null && minutes >= walkTime;
    })
    .slice(0, limit);
}
