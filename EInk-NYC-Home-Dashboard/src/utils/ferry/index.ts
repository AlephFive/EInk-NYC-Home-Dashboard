/**
 * NYC Ferry, on the operator's live GTFS-realtime feed.
 *
 * `getFerrySchedule.ts` — the static timetable this replaced — is kept for
 * now because the dashboard's own ferry card still reads it. New callers
 * should use the live feed: a printed schedule cannot know a boat is late,
 * so it could only ever claim a departure rather than observe one.
 */

export {
  fetchFerryData,
  extractFerryDataByStop,
  getUpcomingFerriesAtStop,
  getFerryStopName,
  getFerryStops,
  getFerryDestination,
  type EnrichedFerryStopTime,
} from "./fetchFerryData";

export {
  getUpcomingFerryDepartures,
  getDayType,
  type FerryDeparture,
  type DayType,
  type Direction,
  type Route,
} from "./getFerrySchedule";
