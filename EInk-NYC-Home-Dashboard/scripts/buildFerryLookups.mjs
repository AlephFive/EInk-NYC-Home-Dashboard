/**
 * Flatten NYC Ferry's static GTFS into the two lookups the live feed needs.
 *
 * The realtime feed is nearly anonymous: it identifies a trip by `tripId` and
 * a stop by `stopId`, and **leaves `routeId` empty**. Everything a rider reads
 * — which route this is, where the boat is going, what the landing is called —
 * lives in the static package instead, so the two have to be joined.
 *
 * Verified against the live feed on 2026-10-29: 29 trip updates, every
 * `tripId` present in `trips.txt`, every `stopId` present in `stops.txt`.
 *
 * Two files, matching the subway's `stations.json` pattern:
 *
 *   trips.json   trip_id -> { r: route short name, h: headsign }
 *   stops.json   stop_id -> landing name
 *
 * Why pruned rather than shipping the zip: `stop_times.txt` is 5,146 rows of
 * scheduled times the realtime feed supersedes, and `shapes.txt` is map
 * geometry. Neither is read. The Worker also has no unzip, and parsing a
 * 49KB archive on a 10ms CPU budget to recover ~40KB of lookups is work for
 * build time, not request time.
 *
 * Run via `npm run gen:ferry`, which `npm run build` invokes. Output is
 * committed so neither package regenerates it to build.
 *
 * To refresh when NYC Ferry changes its schedule:
 *   curl -sL http://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx -o ferry-gtfs.zip
 *   node scripts/buildFerryLookups.mjs ferry-gtfs.zip
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../src/staticData/ferry");
const TRIPS_OUT = resolve(OUT_DIR, "trips.json");
const STOPS_OUT = resolve(OUT_DIR, "stops.json");

const source = process.argv[2];

if (!source) {
  console.error("Usage: node scripts/buildFerryLookups.mjs <gtfs.zip>");
  console.error("");
  console.error("Download the current package first:");
  console.error(
    "  curl -sL http://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx -o ferry-gtfs.zip"
  );
  process.exit(1);
}

if (!existsSync(source)) {
  console.error(`No such file: ${source}`);
  process.exit(1);
}

/**
 * Read one member of the zip as text.
 *
 * Shelling out to Python rather than adding an unzip dependency: this runs
 * at build time on a developer's machine, not in the Worker, and the repo
 * already uses Python for one-off data work.
 */
function readMember(zipPath, member) {
  return execFileSync(
    "python",
    [
      "-c",
      [
        "import zipfile,sys",
        "z=zipfile.ZipFile(sys.argv[1])",
        "sys.stdout.write(z.read(sys.argv[2]).decode('utf-8-sig'))",
      ].join("\n"),
      zipPath,
      member,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
}

/**
 * Parse CSV with quoted fields.
 *
 * GTFS stop names carry commas — "Wall St/Pier 11, East River" — so splitting
 * on commas alone silently shifts every later column.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }

  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);

  const [header, ...body] = rows;
  return body.map((values) =>
    Object.fromEntries(header.map((name, i) => [name.trim(), values[i] ?? ""]))
  );
}

const routes = parseCsv(readMember(source, "routes.txt"));
const trips = parseCsv(readMember(source, "trips.txt"));
const stops = parseCsv(readMember(source, "stops.txt"));

/** route_id -> the short name a rider reads ("RS", "ER"). */
const routeNames = new Map(
  routes.map((route) => [
    route.route_id,
    route.route_short_name?.trim() || route.route_long_name?.trim() || route.route_id,
  ])
);

const tripLookup = {};
for (const trip of trips) {
  if (!trip.trip_id) continue;
  tripLookup[trip.trip_id] = {
    r: routeNames.get(trip.route_id) ?? trip.route_id,
    // The headsign is where the boat is going, which is what the row shows.
    // Falling back to the route name keeps a row from rendering blank.
    h: trip.trip_headsign?.trim() || routeNames.get(trip.route_id) || "",
  };
}

const stopLookup = {};
for (const stop of stops) {
  if (!stop.stop_id) continue;
  stopLookup[stop.stop_id] = stop.stop_name?.trim() ?? "";
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(TRIPS_OUT, JSON.stringify(tripLookup), "utf8");
writeFileSync(STOPS_OUT, JSON.stringify(stopLookup), "utf8");

const kb = (path) => (readFileSync(path).length / 1024).toFixed(1);

console.log(`  trips.json   ${Object.keys(tripLookup).length} trips   ${kb(TRIPS_OUT)}KB`);
console.log(`  stops.json   ${Object.keys(stopLookup).length} stops   ${kb(STOPS_OUT)}KB`);
console.log(
  `\nroutes: ${[...new Set(Object.values(tripLookup).map((t) => t.r))].sort().join(", ")}`
);
