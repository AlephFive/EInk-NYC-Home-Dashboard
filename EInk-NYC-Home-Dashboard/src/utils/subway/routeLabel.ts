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
 * feed runs it as `SI` and `SS`, but every one of its 21 stations is signed
 * `SIR` and a rider has no idea the two exist. It is one railway, so it gets
 * one label.
 */
const ROUTE_LABELS = new Map([
  // Every shuttle is signed, mapped and announced as S.
  ["GS", "S"], // 42nd St, Times Sq to Grand Central
  ["FS", "S"], // Franklin Av, Brooklyn
  ["H", "S"], //  Rockaway Park, via Broad Channel
  // Staten Island Railway, whichever service pattern the feed reports.
  ["SI", "SIR"],
  ["SS", "SIR"],
]);

export function subwayRouteLabel(routeId: string): string {
  return ROUTE_LABELS.get(routeId) ?? routeId;
}
