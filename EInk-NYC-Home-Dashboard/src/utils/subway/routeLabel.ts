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
  // Staten Island Railway, whichever service pattern the feed reports, and
  // the SIR form the station table uses.
  ["SI", "SI"],
  ["SS", "SI"],
  ["SIR", "SI"],
]);

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
