import { useState, useEffect } from "react";
import "./App.css";
import {
  fetchMultipleTrainLines,
  getUpcomingTrainsAtStation,
  type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate,
} from "./utils/subway";
import {
  fetchMultipleRailroads,
  getUpcomingTrainsAtStation as getRailroadTrainsAtStation,
  type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate,
} from "./utils/railroad";
import {
  getUpcomingBusesAtStop,
  type EnrichedBusData,
} from "./utils/bus";
import { getUpcomingFerryDepartures, type FerryDeparture } from "./utils/ferry";
import { getRailroadRouteShortName, isCityBound } from "./utils/railroad";
import { isBoardable } from "./utils/subway";
import displayConfig from "./displayConfig";
import { TransitCard } from "./components/TransitCard";
import { type TransitData, type TransitErrors } from "./types/transitData";
import { getDestinationName } from "./utils/stationLookup";

/**
 * One departure line, shared by every transit type so rows are identical in
 * height and column positions across cards.
 *
 * Layout: [badge] [destination, flexible and clipped] [time, right-aligned].
 * The fixed ROW_HEIGHT is what keeps rows uniform — content never dictates it,
 * so a long destination or a two-character bullet cannot make one row taller
 * than its neighbours.
 */
const ROW_HEIGHT = 26;

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "3px",
  marginTop: "4px",
};

function EmptyRow({ label }: { label: string }) {
  return (
    <p
      style={{
        color: "#000",
        fontSize: "13px",
        fontWeight: "bold",
        margin: "4px 0 0 0",
      }}
    >
      {label}
    </p>
  );
}

function DepartureRow({
  badge,
  badgeShape,
  point,
  badgeWidth,
  destination,
  time,
  urgent,
  leaveIn,
}: {
  badge: string;
  /** "bullet" = circular subway disc; "rect" = wider label for routes with names */
  badgeShape: "bullet" | "rect";
  /**
   * Shapes the badge into an arrow pointing this way, for routes where the
   * direction of travel matters. Omitted leaves the badge a plain rectangle.
   */
  point?: "left" | "right";
  /**
   * Fixed badge width, so every row in a list lines up rather than each badge
   * sizing to its own text. Callers compute it from the longest label present.
   */
  badgeWidth?: string;
  destination: string | null;
  time: string;
  urgent: boolean;
  /** Minutes until you should leave; omitted when the setting is off */
  leaveIn?: number;
}) {
  const fg = urgent ? "#fff" : "#000";
  const bg = urgent ? "#000" : "#fff";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "5px",
        height: `${ROW_HEIGHT}px`,
        minHeight: `${ROW_HEIGHT}px`,
        padding: "0 4px",
        boxSizing: "border-box",
        backgroundColor: bg,
        color: fg,
        borderLeft: `3px solid ${fg}`,
        borderRadius: "3px",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontSize: "11px",
          fontWeight: "bold",
          backgroundColor: fg,
          color: bg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          whiteSpace: "nowrap",
          ...(badgeShape === "bullet"
            ? {
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                padding: 0,
              }
            : {
                // Rectangular label for named routes (bus, railroad branches),
                // capped so a long name cannot crowd out the destination.
                height: "18px",
                padding: "0 4px",
                ...(badgeWidth
                  ? { width: badgeWidth }
                  : { maxWidth: "76px" }),
                overflow: "hidden",
                // The badge ellipsizes even though the rest of the row clips
                // hard: a truncated branch name is easy to misread as a
                // different branch, so the cut is worth signalling here.
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "block",
                lineHeight: "18px",
                textAlign: "left",
                ...(point
                  ? {
                      // Cut the badge into an arrowhead so the direction of
                      // travel is the shape of the label, not a separate glyph
                      // competing with it for width. The three corners away
                      // from the point keep the same 2px radius as an
                      // unpointed badge; clip-path trims the rest.
                      borderRadius:
                        point === "right" ? "2px 0 0 2px" : "0 2px 2px 0",
                      // Both paddings clear the taper, so the label starts at
                      // the same x whichever way the badge points — otherwise
                      // the text jogs 5px across the column as the direction
                      // alternates row to row.
                      paddingLeft: "9px",
                      paddingRight: "9px",
                      clipPath:
                        point === "right"
                          ? "polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%)"
                          : "polygon(6px 0, 100% 0, 100% 100%, 6px 100%, 0 50%)",
                    }
                  : { borderRadius: "2px" }),
              }),
        }}
      >
        {badge}
      </span>

      {/* Destination takes the slack and is allowed to clip. It clips hard
          rather than ellipsizing: "..." costs about three characters of the
          very space it is reporting is short, and on a fixed panel a name cut
          mid-word still reads. */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "12px",
          fontWeight: "bold",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textAlign: "left",
        }}
      >
        {destination ?? ""}
      </span>

      {leaveIn !== undefined && (
        <span
          style={{
            fontSize: "11px",
            fontWeight: "bold",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {leaveIn <= 0 ? "now" : `${leaveIn}m`}
        </span>
      )}

      <span
        style={{
          fontSize: "14px",
          fontWeight: "bold",
          flexShrink: 0,
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {time}
      </span>
    </div>
  );
}

const railroadsToFetch = ["lirr", "mtn"]; // LIRR and Metro-North

function App() {
  const [transitData, setTransitData] = useState<TransitData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<TransitErrors>({});
  const [lastUpdate, setLastUpdate] = useState<string>("");

  useEffect(() => {
    const loadTransitData = async () => {
      // Declared outside the try so partial results survive an unexpected throw:
      // whatever loaded before the failure still reaches the panel.
      const newTransitData: TransitData = {
        subway: {},
        "railroad-lirr": {},
        "railroad-mtn": {},
        bus: {},
        ferry: {},
      };

      // Per-card failures, so one failing stop or feed degrades only its own card.
      const newCardErrors: TransitErrors = {
        subway: {},
        "railroad-lirr": {},
        "railroad-mtn": {},
        bus: {},
        ferry: {},
      };

      const toMessage = (err: unknown) =>
        err instanceof Error ? err.message : "Failed to load";

      // Fetch more than we display: departures inside the walk time are dropped
      // after fetching, so an exact-size fetch leaves cards short.
      const fetchLimit = displayConfig.fetchDepartures ?? 8;

      try {
        setLoading(true);
        setError(null);
        setCardErrors({});

        // Collect all stops from displayConfig
        const subwayStops = new Set<string>();
        const subwayLines = new Set<string>();
        const lirrStops = new Set<string>();
        const mtnStops = new Set<string>();
        const busStops = new Set<string>();
        const ferryStops = new Set<string>();

        displayConfig.columnDisplay.forEach((column) => {
          column.forEach((card) => {
            // A card may list several stop IDs; every one is fetched.
            for (const stopId of card.stopIds) {
              if (card.transitType === "subway") {
                subwayStops.add(stopId);
              } else if (card.transitType === "railroad-lirr") {
                lirrStops.add(stopId);
              } else if (card.transitType === "railroad-mtn") {
                mtnStops.add(stopId);
              } else if (card.transitType === "bus") {
                busStops.add(stopId);
              } else if (card.transitType === "ferry") {
                ferryStops.add(stopId);
              }
            }
            if (card.transitType === "subway") {
              card.lines?.forEach((line) => subwayLines.add(line));
            }
          });
        });

        // Fetch subway data. All subway cards share one feed fetch, so a feed
        // failure is attributed to every subway card rather than the whole board.
        if (subwayStops.size > 0) {
          try {
            const data = await fetchMultipleTrainLines(Array.from(subwayLines));

            for (const stopId of subwayStops) {
              const southbound = await getUpcomingTrainsAtStation(
                data.feedMessage,
                stopId,
                "S"
              );
              const northbound = await getUpcomingTrainsAtStation(
                data.feedMessage,
                stopId,
                "N"
              );

              newTransitData.subway![stopId] = {
                southbound: southbound,
                northbound: northbound,
              };
            }

            setLastUpdate(data.metadata.timestamp);
          } catch (err) {
            console.error("Error fetching subway data:", err);
            for (const stopId of subwayStops) {
              newTransitData.subway![stopId] = {
                southbound: [],
                northbound: [],
              };
              newCardErrors.subway![stopId] = toMessage(err);
            }
          }
        }

        // Fetch railroad data. fetchMultipleRailroads settles per railroad, so a
        // single railroad being down only errors that railroad's cards.
        if (lirrStops.size > 0 || mtnStops.size > 0) {
          const railroadCards = [
            { key: "railroad-lirr" as const, railroad: "lirr", stops: lirrStops },
            { key: "railroad-mtn" as const, railroad: "mtn", stops: mtnStops },
          ];

          try {
            const railroadData = await fetchMultipleRailroads(railroadsToFetch);

            for (const { key, railroad, stops } of railroadCards) {
              const failure = railroadData.failures?.[railroad];

              for (const stopId of stops) {
                if (failure) {
                  newTransitData[key]![stopId] = [];
                  newCardErrors[key]![stopId] = failure;
                  continue;
                }

                newTransitData[key]![stopId] = await getRailroadTrainsAtStation(
                  railroadData.feedMessage,
                  stopId,
                  undefined, // routeId
                  railroad // Filter to this railroad only
                );
              }
            }
          } catch (err) {
            console.error("Error fetching railroad data:", err);
            for (const { key, stops } of railroadCards) {
              for (const stopId of stops) {
                newTransitData[key]![stopId] = [];
                newCardErrors[key]![stopId] = toMessage(err);
              }
            }
          }
        }

        // Fetch bus data. Each stop is caught individually: a retired stop ID
        // should degrade its own card, not the whole dashboard.
        if (busStops.size > 0) {
          await Promise.all(
            Array.from(busStops).map(async (stopId) => {
              try {
                newTransitData.bus![stopId] = await getUpcomingBusesAtStop(
                  stopId,
                  fetchLimit
                );
              } catch (err) {
                console.error(`Error fetching bus stop ${stopId}:`, err);
                newTransitData.bus![stopId] = [];
                newCardErrors.bus![stopId] = toMessage(err);
              }
            })
          );
        }

        // Fetch ferry data. Currently schedule-based with no API call, but the
        // per-stop error handling matches the other transit types so switching
        // to a live feed needs no changes here.
        if (ferryStops.size > 0) {
          await Promise.all(
            Array.from(ferryStops).map(async (stopName) => {
              try {
                newTransitData.ferry![stopName] = {
                  uptown: await getUpcomingFerryDepartures(
                    "ER",
                    stopName,
                    "uptown",
                    undefined,
                    fetchLimit
                  ),
                  downTown: await getUpcomingFerryDepartures(
                    "ER",
                    stopName,
                    "downTown",
                    undefined,
                    fetchLimit
                  ),
                };
              } catch (err) {
                console.error(`Error fetching ferry stop ${stopName}:`, err);
                newTransitData.ferry![stopName] = { uptown: [], downTown: [] };
                newCardErrors.ferry![stopName] = toMessage(err);
              }
            })
          );
        }

        setTransitData(newTransitData);
        setCardErrors(newCardErrors);
      } catch (error) {
        console.error("Error fetching transit data:", error);
        setError(error instanceof Error ? error.message : "Unknown error");
        // Commit whatever did load before the throw, so an unexpected failure
        // costs only the cards it actually affected.
        setTransitData(newTransitData);
        setCardErrors(newCardErrors);
      } finally {
        setLoading(false);
      }
    };

    loadTransitData();
  }, []);

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return "N/A";
    return new Date(timestamp * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: !displayConfig.use24HourTime,
    });
  };

  const showLeaveIn = displayConfig.showLeaveIn ?? false;

  const getMinutesUntil = (timestamp?: number) => {
    if (!timestamp) return null;
    const now = Date.now();
    const arrival = timestamp * 1000;
    const minutes = Math.floor((arrival - now) / 60000);
    return minutes;
  };

  const renderTrainList = (
    trains: (SubwayEnrichedStopTimeUpdate | RailroadEnrichedStopTimeUpdate)[],
    _direction: string,
    walkTime: number,
    limit: number = 3
  ) => {
    const threshold = displayConfig.urgentThresholdMinutes ?? 10;

    // A card lists trains you can board, so the time that matters is when the
    // train leaves. At a terminal the two are disjoint: trains ending their run
    // carry only `arrival`, trains starting one carry only `departure`.
    const boardingTime = (
      stop: SubwayEnrichedStopTimeUpdate | RailroadEnrichedStopTimeUpdate
    ) => stop.departure?.time ?? stop.arrival?.time;

    // Trains that terminate here cannot be boarded. Railroad feeds signal this
    // by omitting `departure`; subway feeds do not, so `destinationStopId` —
    // undefined when this stop ends the trip — is the test that works for both.
    const boardable = trains.filter(isBoardable);

    // Filter to trains reachable in the walk time
    const accessibleTrains = boardable.filter((stop) => {
      const minutes = getMinutesUntil(boardingTime(stop));
      return minutes !== null && minutes >= walkTime;
    });

    // Apply limit AFTER filtering
    const limitedTrains = accessibleTrains.slice(0, limit);

    if (limitedTrains.length === 0) {
      return <EmptyRow label="No upcoming trains" />;
    }

    // Railroad badges are sized as one: the longest branch name on this card
    // sets the width for every row, so the destinations line up instead of
    // stepping in and out with each badge. Estimated from character count
    // rather than measured, since the panel renders once and a layout pass to
    // measure text would be its own complication. 6.2px/char suits the 11px
    // bold face; the cap keeps a long name from crowding the destination, and
    // overflowing labels still ellipsize.
    const badgeLabels = limitedTrains.map((stop) => {
      const rr = "railroad" in stop && stop.railroad;
      return rr && stop.routeId
        ? getRailroadRouteShortName(stop.routeId, stop.railroad as "lirr" | "mtn")
        : "";
    });
    const longest = Math.max(0, ...badgeLabels.map((l) => l.length));
    const uniformBadgeWidth =
      longest > 0 ? `${Math.min(76, Math.ceil(longest * 6.2) + 8)}px` : undefined;

    return (
      <div style={listStyle}>
        {limitedTrains.map((stop, index) => {
          const minutes = getMinutesUntil(boardingTime(stop));
          const leaveTime = minutes !== null ? minutes - walkTime : null;
          const isItemUrgent = leaveTime !== null && leaveTime < threshold;

          const isRailroad = "railroad" in stop && stop.railroad;
          const railroad = isRailroad
            ? (stop.railroad as "lirr" | "mtn")
            : undefined;

          // Railroads get the branch name with "Branch" trimmed off; subway
          // keeps its one-character bullet.
          const badgeLabel =
            railroad && stop.routeId
              ? getRailroadRouteShortName(stop.routeId, railroad)
              : stop.routeId ?? "";

          const destination = getDestinationName(
            stop.destinationStopId,
            railroad === "lirr"
              ? "railroad-lirr"
              : railroad === "mtn"
                ? "railroad-mtn"
                : "subway"
          );

          // Railroads only: mark whether the train runs toward a city terminal
          // or out. Derived from the destination, since GTFS directionId is
          // unusable here — see isCityBound().
          const cityBound = railroad ? isCityBound(stop.destinationStopId, railroad) : null;

          return (
            <DepartureRow
              key={index}
              badge={badgeLabel}
              badgeShape={railroad ? "rect" : "bullet"}
              badgeWidth={railroad ? uniformBadgeWidth : undefined}
              point={
                cityBound === true ? "left" : cityBound === false ? "right" : undefined
              }
              destination={destination}
              time={formatTime(boardingTime(stop))}
              urgent={isItemUrgent}
              leaveIn={
                showLeaveIn && leaveTime !== null ? leaveTime : undefined
              }
            />
          );
        })}
      </div>
    );
  };

  const renderFerryList = (
    ferries: FerryDeparture[],
    _direction: string,
    walkTime: number,
    limit: number = 3
  ) => {
    const threshold = displayConfig.urgentThresholdMinutes ?? 10;

    const accessibleFerries = ferries
      .filter((ferry) => ferry.minutesUntil >= walkTime)
      .slice(0, limit);

    if (accessibleFerries.length === 0) {
      return <EmptyRow label="No upcoming ferries" />;
    }

    return (
      <div style={listStyle}>
        {accessibleFerries.map((ferry, index) => {
          const leaveTime = ferry.minutesUntil - walkTime;
          const isItemUrgent = leaveTime < threshold;

          return (
            <DepartureRow
              key={index}
              badge={ferry.route}
              badgeShape="rect"
              // The ferry schedule carries no destination; the card's two
              // columns already say uptown vs downtown.
              destination={ferry.isNextDay ? "+1 day" : null}
              time={ferry.departureTime.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                hour12: !displayConfig.use24HourTime,
              })}
              urgent={isItemUrgent}
              leaveIn={showLeaveIn ? leaveTime : undefined}
            />
          );
        })}
      </div>
    );
  };

  const renderBusList = (
    buses: EnrichedBusData[],
    walkTime: number,
    limit: number = 3
  ) => {
    const threshold = displayConfig.urgentThresholdMinutes ?? 10;

    const busTime = (bus: EnrichedBusData) =>
      bus.expectedArrival || bus.expectedDeparture;
    const busMinutes = (bus: EnrichedBusData) => {
      const t = busTime(bus);
      return t ? Math.floor((t.getTime() - Date.now()) / 60000) : null;
    };

    // Filter buses where arrival time >= walk time
    const accessibleBuses = buses.filter((bus) => {
      const minutes = busMinutes(bus);
      return minutes !== null && minutes >= walkTime;
    });

    // Apply limit AFTER filtering
    const limitedBuses = accessibleBuses.slice(0, limit);

    if (limitedBuses.length === 0) {
      return <EmptyRow label="No upcoming buses" />;
    }

    return (
      <div style={listStyle}>
        {limitedBuses.map((bus, index) => {
          const minutes = busMinutes(bus);
          const leaveTime = minutes !== null ? minutes - walkTime : null;
          const isItemUrgent = leaveTime !== null && leaveTime < threshold;
          const arrivalTime = busTime(bus);

          return (
            <DepartureRow
              key={index}
              badge={bus.routeName}
              badgeShape="rect"
              destination={bus.destination ?? null}
              time={
                arrivalTime
                  ? arrivalTime.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: !displayConfig.use24HourTime,
                    })
                  : "--"
              }
              urgent={isItemUrgent}
              leaveIn={
                showLeaveIn && leaveTime !== null ? leaveTime : undefined
              }
            />
          );
        })}
      </div>
    );
  };

  return (
    <div
      style={{
        width: "800px",
        height: "480px",
        border: "2px solid #000",
        // The panel is screenshotted at exactly this size: `auto` would hide
        // any overflow behind scrollbars that never appear in the PNG, so clip
        // visibly instead.
        overflow: "hidden",
        boxSizing: "border-box",
        padding: "6px",
        position: "relative",
      }}
    >
      {loading && <p>Loading transit data...</p>}

      {/* A top-level failure is shown as a banner above the cards rather than
          instead of them: anything that did load still reaches the panel. */}
      {!loading && error && (
        <p
          style={{
            margin: "0 0 4px 0",
            padding: "4px 6px",
            border: "2px solid #000",
            borderRadius: "4px",
            fontSize: "12px",
            fontWeight: "bold",
            color: "#000",
          }}
        >
          Error: {error}
        </p>
      )}

      {!loading && (
        <div
          style={{
            display: "flex",
            gap: "6px",
            height: "100%",
            minHeight: 0,
          }}
        >
          {/* Columns left-to-right; each stacks its cards top-to-bottom. A
              single-card column stretches that card to the full height. */}
          {displayConfig.columnDisplay.map((column, columnIndex) => (
            <div
              key={`column-${columnIndex}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                flex: 1,
                // A flex item defaults to min-width/min-height: auto, which lets
                // content force it larger. Zeroing both is what makes a column
                // take its share of the board regardless of what is inside it.
                minWidth: 0,
                minHeight: 0,
              }}
            >
              {column.map((card, cardIndex) => (
                <TransitCard
                  key={`${card.transitType}-${card.stopIds.join("+")}-${cardIndex}`}
                  card={card}
                  cardsInColumn={column.length}
                  // Only the bottom card of the last column meets the footer.
                  abutsFooter={
                    columnIndex === displayConfig.columnDisplay.length - 1 &&
                    cardIndex === column.length - 1
                  }
                  transitData={transitData}
                  cardErrors={cardErrors}
                  lastUpdate={lastUpdate}
                  onRenderTrainList={renderTrainList}
                  onRenderBusList={renderBusList}
                  onRenderFerryList={renderFerryList}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {lastUpdate && (
        <p
          style={{
            fontSize: "13px",
            fontWeight: "bold",
            color: "#000",
            position: "absolute",
            bottom: "5px",
            right: "10px",
            margin: 0,
          }}
        >
          Last updated: {lastUpdate}
        </p>
      )}
    </div>
  );
}

export default App;
