// src/types/geojson.d.ts
declare module "*.geojson" {
  import type { FeatureCollection, Point } from "geojson";

  // Shape of the `properties` for your station features
  export interface StationProperties {
    // Core IDs
    gtfs_stop_id: string;
    station_id: string;
    complex_id: string;

    // Descriptive fields
    division: string;
    line: string;
    stop_name: string;
    borough: string;
    cbd: string; // "true"/"false" in your data, but you can change to boolean if you normalize
    daytime_routes: string;
    structure: string;

    // Coords stored as strings in properties
    gtfs_latitude: string;
    gtfs_longitude: string;

    // Direction labels
    north_direction_label: string | null;
    south_direction_label: string | null;

    // Accessibility flags
    ada: string; // "0" | "1"
    ada_northbound: string; // "0" | "1"
    ada_southbound: string; // "0" | "1"
    ada_notes: string | null;

    // System / computed fields (you can type them more strictly if you care)
    ":id"?: string;
    ":version"?: string;
    ":created_at"?: string;
    ":updated_at"?: string;
    ":@computed_region_yamh_8v7k"?: string;
    ":@computed_region_wbg7_3whc"?: string;
    ":@computed_region_kjdx_g34t"?: string;

    // Fallback for anything else in the file
    [key: string]: string | null | undefined;
  }

  const value: FeatureCollection<Point, StationProperties>;
  export default value;
}
