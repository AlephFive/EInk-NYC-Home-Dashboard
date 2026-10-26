import displayConfig from "../displayConfig";

/**
 * The two display settings these helpers need.
 *
 * Taken as an argument rather than read from `displayConfig` directly, so the
 * same functions serve the panel — which has one global config — and the TRMNL
 * recipe, where every request carries a different user's settings. The panel
 * passes nothing and gets `displayConfig`, so its behaviour is unchanged.
 */
export interface DisplaySettings {
  /** 24-hour clock when true. */
  use24HourTime?: boolean;
  /** Minutes below which a row is emphasised. */
  urgentThresholdMinutes?: number;
}

const DEFAULT_URGENT_THRESHOLD_MINUTES = 10;

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
export type DepartureTime = number | Date | null | undefined;

const MS_PER_MINUTE = 60_000;

/**
 * Normalise a feed's time to epoch milliseconds. GTFS-RT gives Unix seconds.
 *
 * A zero timestamp is treated as absent rather than as 1970: protobuf encodes
 * an unset int64 as 0, so a stop time missing its arrival can arrive as a
 * literal zero, and rendering that as a 1970 clock time would be worse than
 * showing nothing.
 */
function toEpochMs(time: DepartureTime): number | null {
  if (time === undefined || time === null) return null;
  if (time instanceof Date) {
    const ms = time.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return time === 0 ? null : time * 1000;
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
export function formatClockTime(
  time: DepartureTime,
  settings: DisplaySettings = displayConfig
): string {
  const ms = toEpochMs(time);
  if (ms === null) return "N/A";
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !settings.use24HourTime,
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
export function isUrgent(
  leaveTime: number | null,
  settings: DisplaySettings = displayConfig
): boolean {
  if (leaveTime === null) return false;
  return (
    leaveTime <
    (settings.urgentThresholdMinutes ?? DEFAULT_URGENT_THRESHOLD_MINUTES)
  );
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

/**
 * Whether a stop time is a departure a rider can actually take.
 *
 * Shared by subway and railroad because both GTFS-RT feeds reach this through
 * the same `EnrichedStopTimeUpdate` shape, and the two disagree about trains
 * ending their run:
 *  - Railroad terminals omit `departure` on a terminating train.
 *  - Subway terminals do *not* — at Coney Island all 51 southbound trains carry
 *    both `arrival` and `departure` despite every one of them terminating.
 *
 * So `departure.time` alone would pass 51 dead trains at a subway terminal.
 * `destinationStopId` is the signal that works for both: `extractDataByStop`
 * leaves it undefined when this stop is the last of the trip, whichever feed
 * it came from. Both are required — a boardable train has somewhere to go and
 * a time at which it goes there.
 */
export function isBoardable(stopTime: {
  departure?: { time?: number };
  destinationStopId?: string;
}): boolean {
  return (
    stopTime.departure?.time !== undefined &&
    stopTime.destinationStopId !== undefined
  );
}
