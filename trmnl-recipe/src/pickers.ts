/**
 * Station search for the recipe's form.
 *
 * TRMNL's `xhrSelectSearch` field POSTs what the user typed to an endpoint and
 * renders the returned options, so the 785KB of station lookups stay on the
 * server. The user types "vernon" and picks a station name; they never see a
 * stop ID.
 *
 * The response shape is TRMNL's: an array of single-key objects, label to
 * stored value — `[{ "Vernon Blvd-Jackson Av (7)": "subway:721" }]`.
 *
 * Two things this layer exists to prevent, both of which otherwise produce a
 * card that looks broken but is not:
 *
 * - **Picking one platform group of a complex.** Times Sq is five stop IDs;
 *   choosing `127` silently shows only the 1/2/3. Complexes are offered as one
 *   option carrying every ID.
 * - **Picking a retired bus stop.** The MTA re-IDs stops and the old ID starts
 *   returning a SIRI error. Bus search filters on `valid_to`.
 */

import subwayStations from "../../EInk-NYC-Home-Dashboard/src/staticData/subway/stations.json";
import railroadStops from "../../EInk-NYC-Home-Dashboard/src/staticData/railroad/railroad_stops_lookup.json";

/** TRMNL's option shape: one key, the label, mapping to the stored value. */
export type PickerOption = Record<string, string>;

/** Most options to return. A long list is unusable in a dropdown. */
const MAX_OPTIONS = 25;

/** The zone the transit network runs in; see `departures.ts` for why it is pinned. */
const NETWORK_TIME_ZONE = "America/New_York";

/** NY Open Data's bus stop dataset. */
const BUS_STOPS_ENDPOINT = "https://data.ny.gov/resource/2ucp-7wg5.json";

/**
 * How long the bus search may wait on NY Open Data.
 *
 * This is the only picker that leaves the Worker, and it runs on a keystroke
 * against a third-party portal we do not control. Cloudflare applies no fetch
 * timeout, so without this a stalled portal holds the request open and the
 * dropdown spins rather than failing. Short, because a search box that has
 * not answered in five seconds has already failed the user.
 */
const BUS_SEARCH_TIMEOUT_MS = 5_000;

interface SubwayStation {
  gtfs_stop_id: string;
  stop_name: string;
  daytime_routes?: string;
  complex_id?: string;
}

interface RailroadStop {
  stop_id: string;
  stop_name: string;
}

const stations = subwayStations as Record<string, SubwayStation>;

/** Case- and punctuation-insensitive contains, for forgiving search. */
function matches(haystack: string, needle: string): boolean {
  const normalise = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalise(haystack).includes(normalise(needle));
}

/** Routes as a readable suffix: "1 2 3" becomes "(1/2/3)". */
function routeSuffix(routes: string | undefined): string {
  if (!routes) return "";
  const list = routes.trim().split(/\s+/).filter(Boolean);
  return list.length > 0 ? ` (${list.join("/")})` : "";
}

/**
 * Subway options, with complexes collapsed into one entry each.
 *
 * A complex's stops can carry different names — Times Sq's `A27` is
 * "42 St-Port Authority Bus Terminal" — so the label takes the name shared by
 * the most stops in the complex, and the routes are the union across all of
 * them. Picking it yields every platform group, which is what a rider means
 * by "Times Sq".
 */
function searchSubway(query: string): PickerOption[] {
  // Every record carries a `complex_id` — 461 of the 496 are their own
  // single-stop "complex" — so grouping by it covers standalone stations too
  // and needs no separate branch. A station without one would be dropped, so
  // it falls back to its own stop ID.
  const complexes = new Map<string, SubwayStation[]>();

  for (const station of Object.values(stations)) {
    const key = station.complex_id ?? station.gtfs_stop_id;
    const group = complexes.get(key) ?? [];
    group.push(station);
    complexes.set(key, group);
  }

  const options: PickerOption[] = [];

  const addGroup = (group: SubwayStation[]) => {
    // Any stop in a complex matching counts: searching "port authority" should
    // find the Times Sq complex even though most of its stops are not named
    // that.
    if (!group.some((station) => matches(station.stop_name, query))) return;

    const nameCounts = new Map<string, number>();
    for (const station of group) {
      nameCounts.set(
        station.stop_name,
        (nameCounts.get(station.stop_name) ?? 0) + 1
      );
    }
    const label = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const routes = new Set<string>();
    for (const station of group) {
      for (const route of (station.daytime_routes ?? "").trim().split(/\s+/)) {
        if (route) routes.add(route);
      }
    }

    const ids = group.map((station) => station.gtfs_stop_id).sort();
    options.push({
      [`${label}${routeSuffix([...routes].join(" "))}`]: `subway:${ids.join("+")}`,
    });
  };

  for (const group of complexes.values()) addGroup(group);

  return options;
}

/** Railroad options, scoped to one railroad. */
function searchRailroad(query: string, railroad: "lirr" | "mtn"): PickerOption[] {
  const lookup = railroadStops as {
    by_id_lirr: Record<string, RailroadStop>;
    by_id_mtn: Record<string, RailroadStop>;
  };
  // LIRR and Metro-North reuse stop IDs — both have a "Grand Central" at
  // different IDs — so the two tables are never merged.
  const stops = railroad === "lirr" ? lookup.by_id_lirr : lookup.by_id_mtn;
  const type = railroad === "lirr" ? "lirr" : "mtn";

  return Object.values(stops)
    .filter((stop) => matches(stop.stop_name, query))
    .map((stop) => ({ [stop.stop_name]: `${type}:${stop.stop_id}` }));
}

interface BusStopRow {
  stop_id: string;
  stop_name: string;
  direction?: string;
  route_short_name?: string;
}

/**
 * Bus options, queried live and filtered to stops still in service.
 *
 * The `valid_to` filter is load-bearing, not an optimisation: an unfiltered
 * search returns stops retired years ago, whose IDs now yield a SIRI
 * `ErrorCondition` and a permanently broken card.
 *
 * A corner is one stop ID per direction sharing a `stop_name`, so rows are
 * grouped by name and the option carries every ID — reproducing the bus card's
 * one-column-per-direction layout.
 */
async function searchBus(query: string): Promise<PickerOption[]> {
  // Escape the quote that would break out of the literal, and the two LIKE
  // wildcards. Without the latter, "100%" matches every stop whose name starts
  // "100" and "a_b" matches any single character between a and b — surprising
  // rather than dangerous, but a search box should match what was typed.
  const escaped = query
    .replace(/'/g, "''")
    .replace(/[%_]/g, (char) => "\\" + char)
    .toUpperCase();
  // The cutoff is a local date, not a UTC one: a Worker runs in UTC, so for
  // the four or five hours after midnight in New York `toISOString()` already
  // reads as tomorrow and would exclude a stop a day before it retires.
  const today = `${new Date().toLocaleDateString("en-CA", {
    timeZone: NETWORK_TIME_ZONE,
  })}T00:00:00.000`;

  const url = new URL(BUS_STOPS_ENDPOINT);
  url.searchParams.set(
    "$where",
    `upper(stop_name) like '%${escaped}%' AND valid_to > '${today}'`
  );
  url.searchParams.set(
    "$select",
    "route_short_name,stop_id,stop_name,direction,valid_to"
  );
  // Generous, because several routes serve one stop and rows are per route.
  url.searchParams.set("$limit", "200");

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(BUS_SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Bus stop search failed: ${response.status} ${response.statusText}`
    );
  }

  const rows = (await response.json()) as BusStopRow[];

  // One corner, several rows: group by name, dedupe IDs, collect routes.
  const corners = new Map<string, { ids: Set<string>; routes: Set<string> }>();
  for (const row of rows) {
    if (!row.stop_id || !row.stop_name) continue;
    const corner = corners.get(row.stop_name) ?? {
      ids: new Set<string>(),
      routes: new Set<string>(),
    };
    corner.ids.add(row.stop_id);
    if (row.route_short_name) corner.routes.add(row.route_short_name);
    corners.set(row.stop_name, corner);
  }

  // Ids are "@"-suffixed with the stop name, because `route_info.json` is a
  // hand-maintained map covering only stops someone added by hand — it holds
  // one entry — so a user-picked stop would otherwise head its card
  // "Bus Stop <id>". The picker already knows the name, so it travels with the
  // ID rather than needing a table that cannot cover user choices.
  return [...corners.entries()].map(([name, { ids, routes }]) => ({
    [`${name}${routeSuffix([...routes].sort().join(" "))}`]:
      `bus:${[...ids].sort().join("+")}@${name}`,
  }));
}

/** Which dataset a search runs against, from the form's transit-type select. */
export type PickerKind = "subway" | "lirr" | "mtn" | "bus" | "ferry";

export function parsePickerKind(value: string | undefined): PickerKind | undefined {
  const aliases: Record<string, PickerKind> = {
    subway: "subway",
    lirr: "lirr",
    "railroad-lirr": "lirr",
    "metro-north": "mtn",
    mtn: "mtn",
    "railroad-mtn": "mtn",
    bus: "bus",
    ferry: "ferry",
  };
  return value ? aliases[value.trim().toLowerCase()] : undefined;
}

/**
 * Search one transit type's stations.
 *
 * @param kind - Which dataset to search, from the slot's transit type
 * @param query - What the user typed; empty returns the first options rather
 *   than nothing, so the dropdown is never blank on open
 */
export async function searchStations(
  kind: PickerKind,
  query: string
): Promise<PickerOption[]> {
  const trimmed = query.trim();

  // Bus search hits a remote dataset, so an empty query would fetch the whole
  // of New York. The others are local and can afford to list.
  if (kind === "bus" && trimmed.length < 2) return [];

  let options: PickerOption[];
  switch (kind) {
    case "subway":
      options = searchSubway(trimmed);
      break;
    case "lirr":
    case "mtn":
      options = searchRailroad(trimmed, kind);
      break;
    case "bus":
      options = await searchBus(trimmed);
      break;
    case "ferry":
      // Ferry is still schedule-based and omitted from v1; see the spec's
      // open questions.
      options = [];
      break;
  }

  return options
    .sort((a, b) => Object.keys(a)[0].localeCompare(Object.keys(b)[0]))
    .slice(0, MAX_OPTIONS);
}
