/**
 * Flatten the subway station GeoJSON into a plain stop-ID-keyed JSON map.
 *
 * Two reasons this exists rather than importing the `.geojson` directly:
 *
 * 1. **The Worker has no Vite.** The dashboard reads the GeoJSON through a
 *    custom Vite plugin (`vite.config.ts`); the TRMNL recipe is a Cloudflare
 *    Worker and cannot. Plain JSON imports work in both.
 * 2. **Most of the file is unused.** The GeoJSON carries geometry and a wide
 *    property set; `stationLookup.ts` reads seven fields. Pruning to those
 *    takes 369KB to ~92KB, which matters for a Worker bundle.
 *
 * Run via `npm run gen:stations`, which `npm run build` invokes. The output is
 * committed so neither package has to regenerate it to build.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(
  here,
  "../src/staticData/subway/MTA_Subway_Stations_20251126.geojson"
);
const OUTPUT = resolve(here, "../src/staticData/subway/stations.json");

/** The fields `stationLookup.ts` reads. Everything else is dropped. */
function pruneStation(properties) {
  return {
    gtfs_stop_id: properties.gtfs_stop_id,
    station_id: properties.station_id ?? "",
    stop_name: properties.stop_name ?? `Stop ${properties.gtfs_stop_id}`,
    daytime_routes: properties.daytime_routes,
    complex_id: properties.complex_id,
    north_direction_label: properties.north_direction_label,
    south_direction_label: properties.south_direction_label,
  };
}

const geojson = JSON.parse(readFileSync(SOURCE, "utf8"));

if (!geojson?.features?.length) {
  throw new Error(`No features found in ${SOURCE}`);
}

const stations = {};
for (const feature of geojson.features) {
  const properties = feature.properties;
  // A record without a GTFS stop ID cannot be looked up, so it is not useful
  // here even though it is valid GeoJSON.
  if (properties?.gtfs_stop_id) {
    stations[properties.gtfs_stop_id] = pruneStation(properties);
  }
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(stations), "utf8");

const before = readFileSync(SOURCE).length;
const after = readFileSync(OUTPUT).length;
console.log(
  `stations.json: ${Object.keys(stations).length} stops, ` +
    `${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`
);
