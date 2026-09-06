import busDisplayData from "../../staticData/bus/route_info.json";

interface RouteInfo {
  route_long_name: string;
  route_color: string;
  route_desc: string;
}

interface StopInfo {
  stop_name: string;
}

// Build route lookups for each railroad
const routeData = busDisplayData.routes as Record<string, RouteInfo>;
const stopData = busDisplayData.stops as Record<string, StopInfo>;

/**
 * Get route information (name, color) for a railroad route
 * @param routeId - The route ID
 * @param railroad - The railroad type ("lirr" or "mtn")
 * @returns Route info with name and colors, or null if not found
 */
export function getBusRouteInfo(routeId: string): RouteInfo | null {
  return routeData[routeId] || null;
}

export function getBusStopInfo(stopId: string): StopInfo | null {
  return stopData[stopId] || null;
}
