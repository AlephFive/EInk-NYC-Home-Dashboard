/**
 * The route label the MTA actually signs, from the feed's internal route id.
 *
 * The feeds name shuttles by their own identifiers — `GS` for the 42nd St
 * shuttle, `FS` for Franklin Av, `H` for Rockaway Park — but every one of
 * them is signed, mapped and announced as **S**. The station table already
 * says `S`, so without this a card's heading bullet and its departure rows
 * disagree on the same card.
 *
 * The Staten Island Railway has the same split for a different reason: the
 * feed runs it as `SI` and `SS`, two service patterns over one line, and a
 * rider has no idea the two exist.
 *
 * It is labelled **SI**, not SIR. The SIR-in-a-circle appears on timetables
 * and the subway map, but the R211 trains now running the line carry a
 * circular `SI` bullet like any other subway route, and new station signage
 * is following. Two characters also fit a bullet, where three do not — so
 * the rider-facing label and the drawable one agree.
 */
const ROUTE_LABELS = new Map([
  // Every shuttle is signed, mapped and announced as S.
  ["GS", "S"], // 42nd St, Times Sq to Grand Central
  ["FS", "S"], // Franklin Av, Brooklyn
  ["H", "S"], //  Rockaway Park, via Broad Channel
  // Staten Island Railway: the two service patterns the feed reports.
  ["SI", "SI"],
  ["SS", "SI"],
  // The station table's own spelling. Normalised for display, but no feed
  // ever reports it — see STATION_TABLE_SPELLINGS.
  ["SIR", "SI"],
]);

/**
 * Keys of `ROUTE_LABELS` that come from the station table rather than a
 * feed. They normalise for display, but reversing a label must never
 * produce one: fetching by `SIR` asks for a route id no feed reports.
 */
const STATION_TABLE_SPELLINGS = new Set(["SIR"]);

export function subwayRouteLabel(routeId: string): string {
  return ROUTE_LABELS.get(routeId) ?? routeId;
}

/**
 * An express run, named by the feed with a trailing `X`.
 *
 * `6X` and `7X` are the two that run today. The MTA draws an express as a
 * diamond and a local as a circle, so the `X` is a *shape*, not part of the
 * route name — a bullet reading "7X" is wrong twice over.
 *
 * The test is deliberately narrow: the whole id must be one character plus
 * the X. A looser `endsWith("X")` would eventually eat a route whose name
 * merely ends in X, and the failure would be silent — a diamond where a
 * rider expects a circle, and a route name a character short.
 */
const EXPRESS_ROUTE = /^([0-9A-Z])X$/;

/**
 * Split a feed route id into the glyph to draw and whether to draw it as a
 * diamond. Every route that is not an express variant keeps its own label,
 * shuttles and SIR included.
 */
export function subwayRouteGlyph(routeId: string): {
  glyph: string;
  isExpress: boolean;
} {
  const express = EXPRESS_ROUTE.exec(routeId);
  if (express) return { glyph: express[1], isExpress: true };
  return { glyph: subwayRouteLabel(routeId), isExpress: false };
}

/**
 * The reverse of `subwayRouteLabel`: every feed route id a rider-facing
 * label stands for.
 *
 * The forward direction is many-to-one — `GS`, `FS` and `H` are all signed
 * `S` — so going back fans out, and **there is no single answer to invert
 * to**. That is the whole reason this exists rather than a lookup by hand:
 * code that needs one id for a label will quietly pick the wrong shuttle.
 *
 * Express variants are included, because a rider asking for the 7 means the
 * 7X too. They are *appended* rather than substituted: asking for the 7 must
 * still match a plain `7`.
 *
 * Only express runs that **actually exist** are emitted. Not every route has
 * one — 6, 7 and F do; the 1 does not — and inventing a `1X` would produce a
 * route id no feed reports, which throws when something tries to resolve it
 * to a feed. `EXPRESS_ROUTES` is the list, and it is asserted against the
 * live feeds in the tests.
 */
const EXPRESS_ROUTES = new Set(["6X", "7X", "FX"]);
const LABEL_TO_ROUTE_IDS = new Map<string, string[]>();
for (const [routeId, label] of ROUTE_LABELS) {
  if (STATION_TABLE_SPELLINGS.has(routeId)) continue;
  const ids = LABEL_TO_ROUTE_IDS.get(label) ?? [];
  ids.push(routeId);
  LABEL_TO_ROUTE_IDS.set(label, ids);
}

// A station-table spelling is not a feed id, but it is what the station
// table hands us, so it has to resolve. Point it at the ids behind the
// label it normalises to: SIR asks for SI and SS, not for itself.
for (const spelling of STATION_TABLE_SPELLINGS) {
  const label = ROUTE_LABELS.get(spelling);
  const ids = label ? LABEL_TO_ROUTE_IDS.get(label) : undefined;
  if (ids) LABEL_TO_ROUTE_IDS.set(spelling, ids);
}

export function subwayRouteIds(label: string): string[] {
  const upper = label.toUpperCase();
  const mapped = LABEL_TO_ROUTE_IDS.get(upper);
  if (mapped) return [...mapped];

  // A plain route stands for itself, plus its express run where one runs.
  const express = `${upper}X`;
  if (EXPRESS_ROUTES.has(express)) return [upper, express];
  return [upper];
}

/**
 * Whether a train's feed route id is one a rider asked for by label.
 *
 * Matches on the label both sides read, so "7" accepts the 7X running
 * express and "S" accepts GS, FS and H.
 */
export function subwayRouteMatches(
  routeId: string,
  wantedLabels: Iterable<string>
): boolean {
  // Normalise before labelling: the lookup is keyed on the feeds' own
  // uppercase ids, so a lowercase id would skip the map and compare raw.
  const upperId = routeId.toUpperCase();
  const upperGlyph = subwayRouteGlyph(upperId).glyph.toUpperCase();

  for (const label of wantedLabels) {
    const upper = label.toUpperCase();
    if (upper === upperId || upper === upperGlyph) return true;
  }
  return false;
}
