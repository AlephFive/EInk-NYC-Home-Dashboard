/**
 * The route label the MTA actually signs, from the feed's internal route id.
 *
 * The feeds name shuttles by their own identifiers — `GS` for the 42nd St
 * shuttle, `FS` for Franklin Av, `H` for Rockaway Park — but every one of
 * them is signed, mapped and announced as **S**. The station table already
 * says `S`, so without this a card's heading bullet and its departure rows
 * disagree on the same card.
 *
 * Staten Island is left alone: `SIR` is what the railway is called, and it is
 * not a shuttle.
 */
const SHUTTLE_ROUTE_IDS = new Set(["GS", "FS", "H"]);

export function subwayRouteLabel(routeId: string): string {
  return SHUTTLE_ROUTE_IDS.has(routeId) ? "S" : routeId;
}
