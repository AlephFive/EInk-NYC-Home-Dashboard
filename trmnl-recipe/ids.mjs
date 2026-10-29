import { getStationName, getSubwayRoutes } from "../EInk-NYC-Home-Dashboard/src/utils/stationLookup.ts";
import { readFileSync } from "node:fs";
const ferry = JSON.parse(readFileSync("../EInk-NYC-Home-Dashboard/src/staticData/ferry/stops.json","utf8"));
const rr = JSON.parse(readFileSync("../EInk-NYC-Home-Dashboard/src/staticData/railroad/railroad_stops_lookup.json","utf8"));

console.log("=== Times Sq platform groups ===");
for (const id of ["127","725","902","A27","R16"])
  console.log(`  ${id.padEnd(5)} ${getStationName(id,"subway")?.padEnd(34)} ${getSubwayRoutes(id).join("/")}`);

console.log("\n=== Metro-North 125 St ===");
for (const [k,v] of Object.entries(rr.mtn ?? rr))
  if (/125/.test(JSON.stringify(v))) console.log(" ", k, JSON.stringify(v).slice(0,80));

console.log("\n=== ferry landings matching 'wall|34|90' ===");
for (const [id,name] of Object.entries(ferry))
  if (/Wall|34th|90th/i.test(name)) console.log(`  ${id.padEnd(5)} ${name}`);
