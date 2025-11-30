import subwayStationsGeoJSON from "../staticData/subway/MTA_Subway_Stations_20251126.geojson";
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

// Build subway station lookup by gtfs_stop_id (what the API uses)
const subwayStationsByGtfsId: Record<string, SubwayStation> = {};

console.log("Loading subway stations...", subwayStationsGeoJSON);

if (subwayStationsGeoJSON && subwayStationsGeoJSON.features) {
  subwayStationsGeoJSON.features.forEach((feature: any) => {
    const props = feature.properties;
    if (props && props.gtfs_stop_id) {
      subwayStationsByGtfsId[props.gtfs_stop_id] = {
        gtfs_stop_id: props.gtfs_stop_id,
        station_id: props.station_id,
        stop_name: props.stop_name,
        daytime_routes: props.daytime_routes,
        complex_id: props.complex_id,
        north_direction_label: props.north_direction_label,
        south_direction_label: props.south_direction_label,
      };
    }
  });
  console.log(`Loaded ${Object.keys(subwayStationsByGtfsId).length} subway stations`);
} else {
  console.error("Failed to load subway stations GeoJSON");
}

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
    const name = station?.stop_name || `Stop ${stopId}`;
    console.log(`Subway lookup: ${stopId} -> ${name}`, station);
    return name;
  }

  if (transitType === "railroad-lirr" || transitType === "railroad-mtn") {
    // Use separate lookups to avoid ID conflicts between railroads
    const stop = transitType === "railroad-lirr"
      ? railroadStopsByIdLirr[stopId]
      : railroadStopsByIdMtn[stopId];

    if (stop) {
      const name = stop.stop_name;
      const railroad = transitType === "railroad-lirr" ? "LIRR" : "Metro-North";
      console.log(`${railroad} lookup: ${stopId} -> ${name}`, stop);
      return name;
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
 * Get detailed station info
 */
export function getStationInfo(
  stopId: string,
  transitType: "subway" | "railroad-lirr" | "railroad-mtn" | "bus" | "ferry"
): any {
  if (transitType === "subway") {
    return subwayStationsByGtfsId[stopId] || null;
  }

  if (transitType === "railroad-lirr" || transitType === "railroad-mtn") {
    // Use separate lookups to avoid ID conflicts between railroads
    const stop = transitType === "railroad-lirr"
      ? railroadStopsByIdLirr[stopId]
      : railroadStopsByIdMtn[stopId];

    return stop || null;
  }

  return null;
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
