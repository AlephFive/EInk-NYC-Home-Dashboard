// Generated from the station GeoJSON by `npm run gen:stations`. Plain JSON
// rather than the .geojson, because the TRMNL Worker has no Vite plugin to
// read the latter — and because the pruned form is a quarter of the size.
import subwayStations from "../staticData/subway/stations.json";
import railroadStopsLookup from "../staticData/railroad/railroad_stops_lookup.json";
import { getBusStopInfo } from "./bus/displayDataLookup";

// Subway station lookup
interface SubwayStation {
  gtfs_stop_id: string;
  station_id: string;
  stop_name: string;
  daytime_routes?: string;
  complex_id?: string;
  north_direction_label?: string;
  south_direction_label?: string;
}

// Railroad stop lookup
interface RailroadStop {
  stop_code: string;
  stop_name: string;
  stop_desc?: string;
  stop_lat: string;
  stop_lon: string;
  zone_id?: string;
  stop_url: string;
  location_type?: string;
  parent_station?: string;
  wheelchair_boarding: string;
  railroad: string;
  stop_id: string;
}

// Subway station lookup, keyed by gtfs_stop_id — what the feeds use.
const subwayStationsByGtfsId = subwayStations as Record<string, SubwayStation>;

// Railroad station lookup (separate indexes for LIRR and Metro-North to handle ID conflicts)
const railroadStopsByIdLirr = railroadStopsLookup.by_id_lirr as Record<
  string,
  RailroadStop
>;
const railroadStopsByIdMtn = railroadStopsLookup.by_id_mtn as Record<
  string,
  RailroadStop
>;

/**
 * Get station name by ID for any transit type
 * @param stopId - The stop/station ID
 * @param transitType - Type of transit
 * @returns Station name or the ID if not found
 */
export function getStationName(
  stopId: string,
  transitType: "subway" | "railroad-lirr" | "railroad-mtn" | "bus" | "ferry"
): string {
  if (transitType === "subway") {
    const station = subwayStationsByGtfsId[stopId];
    return station?.stop_name || `Stop ${stopId}`;
  }

  if (transitType === "railroad-lirr" || transitType === "railroad-mtn") {
    // Use separate lookups to avoid ID conflicts between railroads
    const stop = transitType === "railroad-lirr"
      ? railroadStopsByIdLirr[stopId]
      : railroadStopsByIdMtn[stopId];

    if (stop) {
      return stop.stop_name;
    }

    const railroad = transitType === "railroad-lirr" ? "LIRR" : "Metro-North";
    console.warn(`Stop ${stopId} not found for ${railroad}`);
    return `Stop ${stopId}`;
  }

  if (transitType === "bus") {
    const stopInfo = getBusStopInfo(stopId);
    return stopInfo?.stop_name || `Bus Stop ${stopId}`;
  }

  return `Stop ${stopId}`;
}

/**
 * Get all routes/lines that serve a subway station
 * @param stopId - The GTFS stop ID
 * @returns Array of route names (e.g., ["7", "N", "W"])
 */
export function getSubwayRoutes(stopId: string): string[] {
  const station = subwayStationsByGtfsId[stopId];
  if (station?.daytime_routes) {
    return station.daytime_routes.split(" ");
  }
  return [];
}

/**
 * Resolve a destination stop ID to a display name.
 *
 * Subway IDs from the realtime feed carry a direction suffix (`726N`) that the
 * station table does not use, so it is stripped before lookup.
 *
 * @param stopId - Terminus stop ID, or undefined if the train terminates here
 * @param transitType - Which lookup table to consult
 * @returns Station name, or null when unknown or not applicable
 */
export function getDestinationName(
  stopId: string | undefined,
  transitType: "subway" | "railroad-lirr" | "railroad-mtn"
): string | null {
  if (!stopId) return null;

  if (transitType === "subway") {
    const bare = stopId.replace(/[NS]$/, "");
    return subwayStationsByGtfsId[bare]?.stop_name ?? null;
  }

  const stop =
    transitType === "railroad-lirr"
      ? railroadStopsByIdLirr[stopId]
      : railroadStopsByIdMtn[stopId];
  return stop?.stop_name ?? null;
}

/**
 * Get direction labels for a subway station
 * @param stopId - The GTFS stop ID
 * @returns Object with northbound and southbound labels, or null if not found
 */
export function getDirectionLabels(
  stopId: string
): { northbound: string; southbound: string } | null {
  const station = subwayStationsByGtfsId[stopId];
  if (station?.north_direction_label && station?.south_direction_label) {
    return {
      northbound: station.north_direction_label,
      southbound: station.south_direction_label,
    };
  }
  return null;
}
