import lirrData from "../../staticData/railroad/lirr/lirr_routes_stops.json";
import mtnData from "../../staticData/railroad/mtn/mtn_routes_stops.json";
import cityTerminals from "../../staticData/railroad/cityTerminals.json";

interface RouteInfo {
  route_long_name: string;
  route_color: string;
  route_text_color: string;
  route_type?: string;
}

// Build route lookups for each railroad
const lirrRoutes = lirrData.routes as Record<string, RouteInfo>;
const mtnRoutes = mtnData.routes as Record<string, RouteInfo>;

/**
 * Get route information (name, color) for a railroad route
 * @param routeId - The route ID
 * @param railroad - The railroad type ("lirr" or "mtn")
 * @returns Route info with name and colors, or null if not found
 */
export function getRailroadRouteInfo(
  routeId: string,
  railroad: "lirr" | "mtn"
): RouteInfo | null {
  const routes = railroad === "lirr" ? lirrRoutes : mtnRoutes;
  return routes[routeId] || null;
}

/**
 * Get the display name for a railroad route
 * @param routeId - The route ID
 * @param railroad - The railroad type ("lirr" or "mtn")
 * @returns Route display name or the route ID if not found
 */
export function getRailroadRouteName(
  routeId: string,
  railroad: "lirr" | "mtn"
): string {
  const routeInfo = getRailroadRouteInfo(routeId, railroad);
  return routeInfo?.route_long_name || routeId;
}

/**
 * Route name trimmed for a compact badge: every LIRR route_long_name ends in
 * "Branch" ("Babylon Branch"), which is redundant once it sits in a route
 * badge and costs scarce horizontal space on a 257px card.
 * @param routeId - The route ID
 * @param railroad - The railroad type ("lirr" or "mtn")
 * @returns Short route label, e.g. "Babylon"
 */
export function getRailroadRouteShortName(
  routeId: string,
  railroad: "lirr" | "mtn"
): string {
  return getRailroadRouteName(routeId, railroad)
    .replace(/\s+Branch$/i, "")
    .trim();
}

/**
 * Get the color for a railroad route (as hex without #)
 * @param routeId - The route ID
 * @param railroad - The railroad type ("lirr" or "mtn")
 * @returns Route color as hex string (e.g., "00985F") or default color
 */
export function getRailroadRouteColor(
  routeId: string,
  railroad: "lirr" | "mtn"
): string {
  const routeInfo = getRailroadRouteInfo(routeId, railroad);
  return routeInfo?.route_color || "0039a6"; // Default to MTA blue
}

/**
 * Get the text color for a railroad route (as hex without #)
 * @param routeId - The route ID
 * @param railroad - The railroad type ("lirr" or "mtn")
 * @returns Route text color as hex string (e.g., "FFFFFF")
 */
export function getRailroadRouteTextColor(
  routeId: string,
  railroad: "lirr" | "mtn"
): string {
  const routeInfo = getRailroadRouteInfo(routeId, railroad);
  return routeInfo?.route_text_color || "FFFFFF";
}

/**
 * Whether a train is heading into the city.
 *
 * GTFS `directionId` cannot answer this: it is absent on roughly a third of
 * LIRR trips, and every Metro-North trip reports 0 regardless of which way it
 * runs. The destination is the reliable signal, so this checks it against the
 * terminals each railroad runs into (`cityTerminals.json`).
 *
 * @param destinationStopId - Terminus of the trip; undefined if it ends here
 * @param railroad - "lirr" or "mtn"
 * @returns true when city-bound, false when outbound, null when unknown
 */
export function isCityBound(
  destinationStopId: string | undefined,
  railroad: "lirr" | "mtn"
): boolean | null {
  if (!destinationStopId) return null;
  const terminals = cityTerminals[railroad] as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(terminals, destinationStopId);
}
