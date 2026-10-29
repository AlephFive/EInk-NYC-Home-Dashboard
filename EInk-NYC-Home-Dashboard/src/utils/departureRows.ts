/**
 * Turning feed data into the rows a card displays — without React.
 *
 * `App.tsx` previously computed each row's badge, destination, time and
 * urgency inline while building JSX, which meant the only way to ask "what
 * does this card show?" was to render it. The TRMNL recipe needs exactly that
 * answer as data, and so do tests, so the computation lives here and the
 * components take the result.
 *
 * Every function is pure: same feed data and config in, same rows out. The
 * only ambient input is the clock, which the time helpers in `departures.ts`
 * already own.
 */

import {
  formatClockTime,
  isUrgent,
  leaveTimeFor,
  minutesUntil,
  reachableDepartures,
  isBoardable,
  type DepartureTime,
  type DisplaySettings,
} from "./departures";
import {
  getRailroadRouteShortName,
  isCityBound,
  badgeWidthForLabels,
  type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate,
} from "./railroad";
import { type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate } from "./subway";
import { type EnrichedBusData } from "./bus";
import { type FerryDeparture } from "./ferry";
import { getDestinationName } from "./stationLookup";
import { subwayRouteLabel } from "./subway/routeLabel";

/** A train from either feed family. The two differ only in the `railroad` tag. */
export type TrainStopTime =
  | SubwayEnrichedStopTimeUpdate
  | RailroadEnrichedStopTimeUpdate;

/**
 * One rendered departure, as data.
 *
 * This is deliberately the shape a row needs and nothing more — no feed
 * fields, no stop IDs, no `Date` objects. It serialises directly, which is
 * what lets the same computation feed both the React panel and a JSON
 * endpoint.
 */
export interface DepartureRowData {
  /** Stable identity for React keys; not shown. */
  key: string;
  /** Route label: a subway bullet's character, or a named route. */
  badge: string;
  /** "bullet" for one-character subway routes, "rect" for named ones. */
  badgeShape: "bullet" | "rect";
  /** Shared width so a card's badges line up. Railroad only. */
  badgeWidth?: string;
  /** Arrow direction for railroad badges; absent leaves the badge square. */
  point?: "left" | "right";
  /** Where the train goes. Null when the feed gives nothing to show. */
  destination: string | null;
  /** Clock time, already formatted to the configured 12/24-hour setting. */
  time: string;
  /** Whether the row should be emphasised. */
  urgent: boolean;
  /** Minutes until you should leave. Undefined when the setting is off. */
  leaveIn?: number;
}

/** Options shared by every row builder. */
export interface RowOptions {
  /** Minutes to reach this stop; departures inside it are dropped. */
  walkTime: number;
  /** Most rows to return. */
  limit: number;
  /** Whether to populate `leaveIn`. */
  showLeaveIn: boolean;
  /**
   * Clock format and urgency threshold. Omitted on the panel, which has one
   * global config; supplied per request by the recipe, where each user has
   * their own.
   */
  settings?: DisplaySettings;
}

/** When a train leaves, falling back to arrival. At a terminal only one exists. */
const trainTimeOf = (stop: TrainStopTime): DepartureTime =>
  stop.departure?.time ?? stop.arrival?.time;

/**
 * When a bus is due. SIRI supplies arrival more often than departure.
 *
 * Typed as `Date | undefined` rather than the wider `DepartureTime`, because
 * SIRI gives timestamps the fetch layer has already parsed into `Date`s — and
 * the key below needs `getTime()`, which the wider type does not offer.
 */
const busTimeOf = (bus: EnrichedBusData): Date | undefined =>
  bus.expectedArrival ?? bus.expectedDeparture;

/** The railroad a stop time came from, or undefined for subway. */
function railroadOf(stop: TrainStopTime): "lirr" | "mtn" | undefined {
  return "railroad" in stop && stop.railroad
    ? (stop.railroad as "lirr" | "mtn")
    : undefined;
}

/** The transit type to resolve a destination stop ID against. */
function lookupTypeOf(railroad: "lirr" | "mtn" | undefined) {
  if (railroad === "lirr") return "railroad-lirr" as const;
  if (railroad === "mtn") return "railroad-mtn" as const;
  return "subway" as const;
}

/**
 * Fill in the three fields every row computes the same way.
 *
 * Kept in one place because getting urgency and `leaveIn` consistent across
 * transit types is exactly the drift this module exists to prevent.
 */
function timingFields(
  time: DepartureTime,
  { walkTime, showLeaveIn, settings }: RowOptions
): Pick<DepartureRowData, "time" | "urgent" | "leaveIn"> {
  const leaveTime = leaveTimeFor(minutesUntil(time), walkTime);
  return {
    time: formatClockTime(time, settings),
    urgent: isUrgent(leaveTime, settings),
    leaveIn: showLeaveIn && leaveTime !== null ? leaveTime : undefined,
  };
}

/**
 * Rows for a train list, subway or railroad.
 *
 * Filters to trains you can actually board and actually reach, then describes
 * each one. Badge width is computed across the whole list rather than per row,
 * so destinations start at the same x instead of stepping in and out.
 */
export function trainRows(
  trains: TrainStopTime[],
  options: RowOptions
): DepartureRowData[] {
  const reachable = reachableDepartures(
    trains.filter(isBoardable),
    trainTimeOf,
    options.walkTime,
    options.limit
  );

  const badgeWidth = badgeWidthForLabels(
    reachable.map((stop) => {
      const railroad = railroadOf(stop);
      return railroad && stop.routeId
        ? getRailroadRouteShortName(stop.routeId, railroad)
        : "";
    })
  );

  return reachable.map((stop) => {
    const railroad = railroadOf(stop);
    const cityBound = railroad
      ? isCityBound(stop.destinationStopId, railroad)
      : null;

    return {
      key: stop.tripId ?? `${stop.stopId}-${stop.departure?.time}`,
      badge:
        railroad && stop.routeId
          ? getRailroadRouteShortName(stop.routeId, railroad)
          : subwayRouteLabel(stop.routeId ?? ""),
      badgeShape: railroad ? "rect" : "bullet",
      badgeWidth: railroad ? badgeWidth : undefined,
      point:
        cityBound === true ? "left" : cityBound === false ? "right" : undefined,
      destination: getDestinationName(
        stop.destinationStopId,
        lookupTypeOf(railroad)
      ),
      ...timingFields(trainTimeOf(stop), options),
    };
  });
}

/** Rows for one bus stop's list. */
export function busRows(
  buses: EnrichedBusData[],
  options: RowOptions
): DepartureRowData[] {
  return reachableDepartures(
    buses,
    busTimeOf,
    options.walkTime,
    options.limit
  ).map((bus) => ({
    key: `${bus.routeName}-${busTimeOf(bus)?.getTime()}`,
    badge: bus.routeName,
    badgeShape: "rect" as const,
    destination: bus.destination ?? null,
    ...timingFields(busTimeOf(bus), options),
  }));
}

/** Rows for one ferry direction. */
export function ferryRows(
  ferries: FerryDeparture[],
  options: RowOptions
): DepartureRowData[] {
  return reachableDepartures(
    ferries,
    (ferry) => ferry.departureTime,
    options.walkTime,
    options.limit
  ).map((ferry) => ({
    key: String(ferry.departureTime.getTime()),
    badge: ferry.route,
    badgeShape: "rect" as const,
    // The ferry schedule carries no destination; the card's two columns
    // already say uptown vs downtown.
    destination: ferry.isNextDay ? "+1 day" : null,
    ...timingFields(ferry.departureTime, options),
  }));
}
