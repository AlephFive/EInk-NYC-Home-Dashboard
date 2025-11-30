import ferrySchedule from "../../staticData/ferry/schedule.json";

export type DayType = "weekday" | "weekend";
export type Direction = "uptown" | "downTown";
export type Route = "ER";

export interface FerryDeparture {
  stopName: string;
  route: Route;
  direction: Direction;
  departureTime: Date;
  minutesUntil: number;
  isNextDay?: boolean;
}

/**
 * Determine if today is a weekday or weekend
 */
export function getDayType(): DayType {
  const today = new Date();
  const dayOfWeek = today.getDay();
  // 0 = Sunday, 6 = Saturday
  return dayOfWeek === 0 || dayOfWeek === 6 ? "weekend" : "weekday";
}

/**
 * Get the day type for a specific date
 */
function getDayTypeForDate(date: Date): DayType {
  const dayOfWeek = date.getDay();
  // 0 = Sunday, 6 = Saturday
  return dayOfWeek === 0 || dayOfWeek === 6 ? "weekend" : "weekday";
}

/**
 * Parse a time string like "6:26 AM" into a Date object
 * @param timeStr - Time string to parse (e.g., "6:26 AM")
 * @param daysOffset - Number of days to offset from today (0 = today, 1 = tomorrow, etc.)
 */
function parseTimeString(timeStr: string, daysOffset: number = 0): Date {
  const now = new Date();
  const [time, period] = timeStr.split(" ");
  const [hours, minutes] = time.split(":").map(Number);

  let hour24 = hours;
  if (period === "PM" && hours !== 12) {
    hour24 = hours + 12;
  } else if (period === "AM" && hours === 12) {
    hour24 = 0;
  }

  const departureTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysOffset,
    hour24,
    minutes,
    0
  );

  return departureTime;
}

/**
 * Get upcoming ferry departures at a specific stop
 * Automatically rolls over to next day's schedule if no departures remain today
 * @param route - The ferry route (e.g., "ER")
 * @param stopName - The stop name (e.g., "Wall Street/Pier 11")
 * @param direction - Direction of travel ("uptown" or "downTown")
 * @param dayType - Optional day type override (defaults to current day)
 * @param limit - Maximum number of departures to return (default: 5)
 */
export function getUpcomingFerryDepartures(
  route: Route,
  stopName: string,
  direction: Direction,
  dayType?: DayType,
  limit: number = 5
): FerryDeparture[] {
  // Try to get departures for today first
  const todayDepartures = getDeparturesForDay(
    route,
    stopName,
    direction,
    dayType || getDayType(),
    0, // daysOffset = 0 (today)
    limit
  );

  // If we found departures for today, return them
  if (todayDepartures.length > 0) {
    return todayDepartures;
  }

  // No departures today, try tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDayType = getDayTypeForDate(tomorrow);

  const tomorrowDepartures = getDeparturesForDay(
    route,
    stopName,
    direction,
    tomorrowDayType,
    1, // daysOffset = 1 (tomorrow)
    limit
  );

  // Mark all tomorrow's departures as next day
  return tomorrowDepartures.map((dep) => ({
    ...dep,
    isNextDay: true,
  }));
}

/**
 * Internal helper to get departures for a specific day
 */
function getDeparturesForDay(
  route: Route,
  stopName: string,
  direction: Direction,
  scheduleType: DayType,
  daysOffset: number,
  limit: number
): FerryDeparture[] {
  const now = new Date();

  // Access the schedule data
  const scheduleData = ferrySchedule as any;
  const routeData = scheduleData[route];

  if (!routeData) {
    console.warn(`Ferry route not found: ${route}`);
    return [];
  }

  const dayData = routeData[scheduleType];
  if (!dayData) {
    console.warn(`Schedule type not found: ${scheduleType}`);
    return [];
  }

  const directionData = dayData[direction];
  if (!directionData) {
    console.warn(`Direction not found: ${direction}`);
    return [];
  }

  const stopSchedule = directionData[stopName];
  if (!stopSchedule || !Array.isArray(stopSchedule)) {
    console.warn(`Stop not found: ${stopName}`);
    return [];
  }

  // Parse all times and filter for upcoming departures
  const upcomingDepartures: FerryDeparture[] = stopSchedule
    .map((timeStr: string) => {
      const departureTime = parseTimeString(timeStr, daysOffset);
      const minutesUntil = Math.floor(
        (departureTime.getTime() - now.getTime()) / 60000
      );

      return {
        stopName,
        route,
        direction,
        departureTime,
        minutesUntil,
      };
    })
    .filter((departure: FerryDeparture) => departure.minutesUntil >= 0)
    .slice(0, limit);

  return upcomingDepartures;
}

/**
 * Get all available stops for a route and direction
 */
export function getFerryStops(
  route: Route,
  direction: Direction,
  dayType?: DayType
): string[] {
  const scheduleType = dayType || getDayType();
  const scheduleData = ferrySchedule as any;
  const routeData = scheduleData[route];

  if (!routeData) return [];

  const dayData = routeData[scheduleType];
  if (!dayData) return [];

  const directionData = dayData[direction];
  if (!directionData) return [];

  return Object.keys(directionData);
}
