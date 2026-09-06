import displayConfig, {
  type TransitCard as TransitCardConfig,
} from "../displayConfig";
import { type TransitData, type TransitErrors } from "../types/transitData";
import { departuresForCard } from "../utils/cardCapacity";
import {
  isBoardable,
  type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate,
} from "../utils/subway";
import { type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate } from "../utils/railroad";
import { type EnrichedBusData } from "../utils/bus";
import { type FerryDeparture } from "../utils/ferry";
import {
  getStationName,
  getDirectionLabels,
  getSubwayRoutes,
} from "../utils/stationLookup";

interface TransitCardProps {
  card: TransitCardConfig;
  /** Cards sharing this card's column, which sets how tall it is. */
  cardsInColumn: number;
  /** True for the last card of the rightmost column, under the footer line. */
  abutsFooter?: boolean;
  transitData: TransitData;
  cardErrors?: TransitErrors;
  lastUpdate?: string;
  onRenderTrainList: (
    trains: (SubwayEnrichedStopTimeUpdate | RailroadEnrichedStopTimeUpdate)[],
    direction: string,
    walkTime: number,
    limit?: number
  ) => React.ReactNode;
  onRenderBusList: (
    buses: EnrichedBusData[],
    walkTime: number,
    limit?: number
  ) => React.ReactNode;
  onRenderFerryList: (
    ferries: FerryDeparture[],
    direction: string,
    walkTime: number,
    limit?: number
  ) => React.ReactNode;
}

/**
 * Renders a fetch failure inside the card. Styled for the 1-bit panel: no
 * color to lean on, so the message is boxed and bold instead.
 */
function CardError({ message }: { message: string }) {
  return (
    <div
      style={{
        marginTop: "6px",
        padding: "6px",
        border: "2px solid #000",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: "bold",
        color: "#000",
        textAlign: "left",
      }}
    >
      <div style={{ marginBottom: "2px" }}>Unavailable</div>
      <div
        style={{
          fontSize: "10px",
          fontWeight: "normal",
          // The panel is a fixed 800x480 with no scrolling, so a long upstream
          // message (the MTA's "No such stop" text repeats the ID three times)
          // must be clamped rather than allowed to push the card past its height.
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          overflowWrap: "anywhere",
        }}
      >
        {message}
      </div>
    </div>
  );
}

// Cards divide their column evenly and clip: `flex: 1 1 0` ignores content
// size, and minHeight/overflow keep a long list from pushing the column past
// the panel's fixed height.
const cardStyle: React.CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
};

/**
 * A card may list several stop IDs (a bus corner is one per direction, a subway
 * complex one per platform group). Data and errors are stored per stop, so a
 * card gathers its own IDs and merges them.
 */
function collectErrors(
  stopIds: string[],
  errors: Record<string, string> | undefined
): string | undefined {
  if (!errors) return undefined;
  const hit = stopIds.map((id) => errors[id]).filter(Boolean);
  return hit.length > 0 ? hit[0] : undefined;
}

/** Merge per-stop arrays into one list, sorted by the given time accessor. */
function mergeSorted<T>(
  parts: (T[] | undefined)[],
  time: (item: T) => number
): T[] {
  return parts
    .filter((p): p is T[] => Array.isArray(p))
    .flat()
    .sort((a, b) => time(a) - time(b));
}

const stopTimeOf = (s: {
  departure?: { time?: number };
  arrival?: { time?: number };
}) => Number(s.departure?.time ?? s.arrival?.time ?? 0);

/**
 * The route bullets a subway card shows in place of a "Subway" type tag: the
 * lines actually serving the station, taken from `daytime_routes` rather than
 * the card's `lines` (which selects feeds and may include routes that do not
 * stop here). Drawn as outlines sharing the 2px border weight of the "Bus" and
 * "LIRR" tags they stand in for, so the header reads as one row of same-weight
 * marks; MTA line colours are not used because the panel is 1-bit and every
 * colour would flatten to the same fill.
 */
function SubwayBullets({ routes }: { routes: string[] }) {
  return (
    <span style={{ display: "inline-flex", gap: "3px", flexShrink: 0 }}>
      {routes.map((route) => (
        <span
          key={route}
          style={{
            fontSize: "13px",
            fontWeight: "bold",
            border: "2px solid #000",
            color: "#000",
            // Deliberately smaller than the neighbouring "Bus"/"LIRR" tag
            // (28px): a circle of that height reads heavier than a rectangle
            // of the same, so it is stepped down. Equal width and height keep
            // the bullet circular.
            width: "24px",
            height: "24px",
            boxSizing: "border-box",
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {route}
        </span>
      ))}
    </span>
  );
}

/**
 * Header height, fixed so the dotted rule lands on the same line across cards
 * whose type marks differ in height. 34px is what the tallest (the 28px
 * "Bus"/"LIRR" tag plus its 4px bottom padding) already occupied.
 */
const HEADER_HEIGHT = 34;

export function TransitCard({
  card,
  cardsInColumn,
  abutsFooter,
  transitData,
  cardErrors,
  onRenderTrainList,
  onRenderBusList,
  onRenderFerryList,
}: TransitCardProps) {
  // Fill the card: an explicit `departures` wins, otherwise fit as many rows
  // as the card's height allows. Subway, ferry and multi-stop bus cards split
  // into columns under a subheading, which costs a row's worth of space.
  const hasSubheading =
    card.transitType === "subway" ||
    card.transitType === "ferry" ||
    card.transitType === "bus";
  const departures =
    card.departures ??
    displayConfig.defaultDepartures ??
    departuresForCard(cardsInColumn, hasSubheading, abutsFooter);

  // Heading: explicit title wins, else the first stop ID's name.
  const primaryStopId = card.stopIds[0];

  if (card.transitType === "ferry") {
    const cardError = collectErrors(card.stopIds, cardErrors?.ferry);
    const parts = card.stopIds.map((id) => transitData.ferry?.[id]);
    const hasData = parts.some(Boolean);
    if (!hasData && !cardError) return null;
    const data = {
      uptown: mergeSorted(
        parts.map((p) => p?.uptown),
        (f) => f.departureTime.getTime()
      ),
      downTown: mergeSorted(
        parts.map((p) => p?.downTown),
        (f) => f.departureTime.getTime()
      ),
    };

    return (
      <div className="card" style={cardStyle}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "6px",
          marginBottom: "4px",
          paddingBottom: "4px",
          borderBottom: "2px dotted #000",
          minWidth: 0,
          // Fixed so the rule sits at the same y on every card. The type marks
          // differ in height — 24px subway bullets against 28px "Bus"/"LIRR"
          // tags — and without this the header grows to fit whichever it holds.
          height: `${HEADER_HEIGHT}px`,
          boxSizing: "border-box",
        }}>
          <span style={{
            fontSize: "13px",
            fontWeight: "bold",
            border: "2px solid #000",
            borderRadius: "4px",
            padding: "2px 6px",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}>
            Ferry
          </span>
          <h2 style={{
            fontSize: "16px",
            margin: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            // Without minWidth the h2 keeps its content's width and the
            // ellipsis above never engages.
            minWidth: 0,
          }}>{card.title ?? primaryStopId}</h2>
        </div>
        {cardError ? (
          <CardError message={cardError} />
        ) : (
          <div
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "2px",
              minWidth: 0,
            }}
          >
            {/* flex-basis 0 keeps the two columns equal whatever they hold */}
            <div style={{ flex: "1 1 0", minWidth: 0 }}>
              <h3 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>Uptown</h3>
              {onRenderFerryList(data.uptown, "uptown", card.walkTime, departures)}
            </div>
            <div style={{ flex: "1 1 0", minWidth: 0 }}>
              <h3 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>Downtown</h3>
              {onRenderFerryList(data.downTown, "downTown", card.walkTime, departures)}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (card.transitType === "subway") {
    const cardError = collectErrors(card.stopIds, cardErrors?.subway);
    const parts = card.stopIds.map((id) => transitData.subway?.[id]);
    const hasData = parts.some(Boolean);
    if (!hasData && !cardError) return null;
    const data = {
      southbound: mergeSorted(
        parts.map((p) => p?.southbound),
        stopTimeOf
      ),
      northbound: mergeSorted(
        parts.map((p) => p?.northbound),
        stopTimeOf
      ),
    };

    const stationName = card.title ?? getStationName(primaryStopId, "subway");
    const directionLabels = getDirectionLabels(primaryStopId);
    // Union across the card's stops, so a merged complex shows every line it
    // covers rather than only the first platform group's.
    const cardRoutes = [
      ...new Set(card.stopIds.flatMap((id) => getSubwayRoutes(id))),
    ];

    return (
      <div className="card" style={cardStyle}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "6px",
          marginBottom: "4px",
          paddingBottom: "4px",
          borderBottom: "2px dotted #000",
          minWidth: 0,
          // Fixed so the rule sits at the same y on every card. The type marks
          // differ in height — 24px subway bullets against 28px "Bus"/"LIRR"
          // tags — and without this the header grows to fit whichever it holds.
          height: `${HEADER_HEIGHT}px`,
          boxSizing: "border-box",
        }}>
          <SubwayBullets routes={cardRoutes} />
          <h2 style={{
            fontSize: "16px",
            margin: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            // Without minWidth the h2 keeps its content's width and the
            // ellipsis above never engages.
            minWidth: 0,
          }}>{stationName}</h2>
        </div>
        {cardError ? (
          <CardError message={cardError} />
        ) : (
          (() => {
            // At a terminal every train in one direction terminates here, so
            // that direction has nothing boardable. Show the single live
            // direction full-width rather than half the card reading "No
            // upcoming trains".
            const directions = [
              {
                key: "S" as const,
                trains: data.southbound,
                label:
                  directionLabels?.southbound ||
                  card.directionNames?.southbound ||
                  "Southbound",
              },
              {
                key: "N" as const,
                trains: data.northbound,
                label:
                  directionLabels?.northbound ||
                  card.directionNames?.northbound ||
                  "Northbound",
              },
            ];

            const live = directions.filter((d) => d.trains.some(isBoardable));
            // If neither direction runs, keep both so the card still explains
            // itself instead of rendering nothing.
            const shown = live.length > 0 ? live : directions;

            return (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginTop: "2px",
                  minWidth: 0,
                }}
              >
                {shown.map((d) => (
                  <div
                    key={d.key}
                    // flex-basis 0 makes the columns equal regardless of their
                    // content; minWidth 0 lets them shrink inside the card.
                    style={{ flex: "1 1 0", minWidth: 0 }}
                  >
                    <h3
                      style={{
                        margin: "0 0 4px 0",
                        fontSize: "13px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {d.label}
                    </h3>
                    {onRenderTrainList(
                      d.trains,
                      d.key,
                      card.walkTime,
                      departures
                    )}
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </div>
    );
  }

  if (
    card.transitType === "railroad-lirr" ||
    card.transitType === "railroad-mtn"
  ) {
    const cardError = collectErrors(card.stopIds, cardErrors?.[card.transitType]);
    const byStop =
      card.transitType === "railroad-lirr"
        ? transitData["railroad-lirr"]
        : transitData["railroad-mtn"];
    const parts = card.stopIds.map((id) => byStop?.[id]);
    const hasData = parts.some(Boolean);
    if (!hasData && !cardError) return null;
    const data = mergeSorted(parts, stopTimeOf);

    const stationName =
      card.title ?? getStationName(primaryStopId, card.transitType);
    const railroadLabel =
      card.transitType === "railroad-lirr" ? "LIRR" : "Metro-North";

    return (
      <div className="card" style={cardStyle}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "6px",
          marginBottom: "4px",
          paddingBottom: "4px",
          borderBottom: "2px dotted #000",
          minWidth: 0,
          // Fixed so the rule sits at the same y on every card. The type marks
          // differ in height — 24px subway bullets against 28px "Bus"/"LIRR"
          // tags — and without this the header grows to fit whichever it holds.
          height: `${HEADER_HEIGHT}px`,
          boxSizing: "border-box",
        }}>
          <span style={{
            fontSize: "13px",
            fontWeight: "bold",
            border: "2px solid #000",
            borderRadius: "4px",
            padding: "2px 6px",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}>
            {railroadLabel}
          </span>
          <h2 style={{
            fontSize: "16px",
            margin: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            // Without minWidth the h2 keeps its content's width and the
            // ellipsis above never engages.
            minWidth: 0,
          }}>{stationName}</h2>
        </div>
        <div style={{ marginTop: "2px" }}>
          {cardError ? (
            <CardError message={cardError} />
          ) : (
            onRenderTrainList(data, "", card.walkTime, departures)
          )}
        </div>
      </div>
    );
  }

  if (card.transitType === "bus") {
    const cardError = collectErrors(card.stopIds, cardErrors?.bus);
    // Keep buses grouped by the configured stop they came from: a bus stop is
    // one side of the street, so a card's stop IDs *are* its directions. SIRI's
    // DirectionRef is not usable for this — it is a per-route 0/1, so two
    // routes' "direction 0" mean unrelated things and one stop can carry both.
    const busGroups = card.stopIds
      .map((id) => ({ stopId: id, buses: transitData.bus?.[id] }))
      .filter((g): g is { stopId: string; buses: EnrichedBusData[] } =>
        Array.isArray(g.buses)
      );
    const hasData = busGroups.length > 0;
    if (!hasData && !cardError) return null;

    const stationName = card.title ?? getStationName(primaryStopId, "bus");

    return (
      <div className="card" style={cardStyle}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "6px",
          marginBottom: "4px",
          paddingBottom: "4px",
          borderBottom: "2px dotted #000",
          minWidth: 0,
          // Fixed so the rule sits at the same y on every card. The type marks
          // differ in height — 24px subway bullets against 28px "Bus"/"LIRR"
          // tags — and without this the header grows to fit whichever it holds.
          height: `${HEADER_HEIGHT}px`,
          boxSizing: "border-box",
        }}>
          <span style={{
            fontSize: "13px",
            fontWeight: "bold",
            border: "2px solid #000",
            borderRadius: "4px",
            padding: "2px 6px",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}>
            Bus
          </span>
          <h2 style={{
            fontSize: "16px",
            margin: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            // Without minWidth the h2 keeps its content's width and the
            // ellipsis above never engages.
            minWidth: 0,
          }}>{stationName}</h2>
        </div>
        {cardError ? (
          <div style={{ marginTop: "2px" }}>
            <CardError message={cardError} />
          </div>
        ) : (
          (() => {
            const columns = busGroups.map(({ stopId, buses }) => ({
              key: stopId,
              buses: [...buses].sort(
                (a, b) =>
                  ((a.expectedArrival ?? a.expectedDeparture)?.getTime() ?? 0) -
                  ((b.expectedArrival ?? b.expectedDeparture)?.getTime() ?? 0)
              ),
            }));

            return (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginTop: "2px",
                  minWidth: 0,
                }}
              >
                {/* No column heading: a stop serves several routes, so a
                    single label can only show the most common destination,
                    which is wrong for the rest of the column. */}
                {columns.map((c) => (
                  <div key={c.key} style={{ flex: "1 1 0", minWidth: 0 }}>
                    {onRenderBusList(c.buses, card.walkTime, departures)}
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </div>
    );
  }

  return null;
}
