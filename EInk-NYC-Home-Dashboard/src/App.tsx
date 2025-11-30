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
  getBusRouteInfo,
} from "./utils/bus";
import { getUpcomingFerryDepartures, type FerryDeparture } from "./utils/ferry";
import {
  getRailroadRouteColor,
  getRailroadRouteTextColor,
  getRailroadRouteName,
} from "./utils/railroad";
import displayConfig from "./displayConfig";
import { TransitCard } from "./components/TransitCard";
import { type TransitData } from "./types/transitData";
import { getDisplayColor } from "./utils/displayMode";

const railroadsToFetch = ["lirr", "mtn"]; // LIRR and Metro-North

function App() {
  const [transitData, setTransitData] = useState<TransitData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("");

  useEffect(() => {
    const loadTransitData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Collect all stops from displayConfig
        const subwayStops = new Set<string>();
        const subwayLines = new Set<string>();
        const lirrStops = new Set<string>();
        const mtnStops = new Set<string>();
        const busStops = new Set<string>();
        const ferryStops = new Set<string>();

        displayConfig.rowDisplay.forEach((row) => {
          row.forEach((card) => {
            if (card.transitType === "subway") {
              subwayStops.add(card.stopId);
              card.lines?.forEach((line) => subwayLines.add(line));
            } else if (card.transitType === "railroad-lirr") {
              lirrStops.add(card.stopId);
            } else if (card.transitType === "railroad-mtn") {
              mtnStops.add(card.stopId);
            } else if (card.transitType === "bus") {
              busStops.add(card.stopId);
            } else if (card.transitType === "ferry") {
              ferryStops.add(card.stopId);
            }
          });
        });

        const newTransitData: TransitData = {
          subway: {},
          "railroad-lirr": {},
          "railroad-mtn": {},
          bus: {},
          ferry: {},
        };

        // Fetch subway data
        if (subwayStops.size > 0) {
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
        }

        // Fetch railroad data
        if (lirrStops.size > 0 || mtnStops.size > 0) {
          const railroadData = await fetchMultipleRailroads(railroadsToFetch);

          // Process LIRR stops
          for (const stopId of lirrStops) {
            const trains = await getRailroadTrainsAtStation(
              railroadData.feedMessage,
              stopId,
              undefined, // routeId
              "lirr" // Filter by LIRR only
            );
            newTransitData["railroad-lirr"]![stopId] = trains;
          }

          // Process Metro-North stops
          for (const stopId of mtnStops) {
            const trains = await getRailroadTrainsAtStation(
              railroadData.feedMessage,
              stopId,
              undefined, // routeId
              "mtn" // Filter by Metro-North only
            );
            newTransitData["railroad-mtn"]![stopId] = trains;
          }
        }

        // Fetch bus data
        if (busStops.size > 0) {
          for (const stopId of busStops) {
            const buses = await getUpcomingBusesAtStop(stopId, 5);
            newTransitData.bus![stopId] = buses;
          }
        }

        // Fetch ferry data (from schedule, no API call)
        if (ferryStops.size > 0) {
          for (const stopName of ferryStops) {
            const uptown = getUpcomingFerryDepartures(
              "ER",
              stopName,
              "uptown",
              undefined,
              2
            );
            const downTown = getUpcomingFerryDepartures(
              "ER",
              stopName,
              "downTown",
              undefined,
              2
            );
            newTransitData.ferry![stopName] = {
              uptown,
              downTown,
            };
          }
        }

        setTransitData(newTransitData);
      } catch (error) {
        console.error("Error fetching transit data:", error);
        setError(error instanceof Error ? error.message : "Unknown error");
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

    // Filter trains where arrival time >= walk time
    const accessibleTrains = trains.filter((stop) => {
      const minutes = getMinutesUntil(stop.arrival?.time);
      return minutes !== null && minutes >= walkTime;
    });

    // Apply limit AFTER filtering
    const limitedTrains = accessibleTrains.slice(0, limit);

    if (limitedTrains.length === 0) {
      return (
        <p style={{
          color: "#000",
          fontSize: "13px",
          fontWeight: "bold"
        }}>
          No upcoming trains
        </p>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          marginTop: "6px",
        }}
      >
        {limitedTrains.map((stop, index) => {
          const minutes = getMinutesUntil(stop.arrival?.time);

          // Calculate if this specific item is urgent
          const leaveTime = minutes !== null ? minutes - walkTime : null;
          const isItemUrgent = leaveTime !== null && leaveTime < threshold;

          // Determine if this is a railroad or subway train
          const isRailroad = "railroad" in stop && stop.railroad;

          // Get route-specific colors
          let routeColor: string;
          let routeTextColor: string;
          let routeDisplayName: string | undefined;

          if (isRailroad && stop.routeId) {
            // Railroad train - use railroad colors
            routeColor = getDisplayColor(
              `#${getRailroadRouteColor(
                stop.routeId,
                stop.railroad as "lirr" | "mtn"
              )}`
            );
            routeTextColor = getDisplayColor(
              `#${getRailroadRouteTextColor(
                stop.routeId,
                stop.railroad as "lirr" | "mtn"
              )}`
            );
            routeDisplayName = getRailroadRouteName(
              stop.routeId,
              stop.railroad as "lirr" | "mtn"
            );
          } else if (stop.routeId) {
            // Subway train - force white on black
            routeColor = "#000000";
            routeTextColor = "#FFFFFF";
            routeDisplayName = stop.routeId;
          } else {
            // Fallback
            routeColor = "#000000";
            routeTextColor = "#FFFFFF";
            routeDisplayName = stop.routeId;
          }

          return (
            <div
              key={index}
              style={{
                padding: "6px",
                backgroundColor: isItemUrgent ? "#000" : "#fff",
                borderRadius: "4px",
                borderLeft: isItemUrgent
                  ? `3px solid #000`
                  : `3px solid ${routeColor}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    {stop.routeId && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: "bold",
                          backgroundColor: isItemUrgent ? "#fff" : routeColor,
                          color: isItemUrgent ? "#000" : routeTextColor,
                          padding: "0",
                          borderRadius: "50%",
                          textAlign: "center",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "18px",
                          height: "18px",
                          flexShrink: 0,
                        }}
                      >
                        {routeDisplayName}
                      </span>
                    )}
                    {isRailroad && stop.railroad && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: "bold",
                          backgroundColor: isItemUrgent ? "#fff" : "#666",
                          color: isItemUrgent ? "#000" : "white",
                          padding: "1px 3px",
                          borderRadius: "2px",
                        }}
                      >
                        {stop.railroad.toUpperCase()}
                      </span>
                    )}
                    <div
                      style={{
                        fontSize: "15px",
                        fontWeight: "bold",
                        textAlign: "left",
                        color: isItemUrgent ? "#fff" : undefined,
                      }}
                    >
                      {formatTime(stop.arrival?.time)}
                    </div>
                  </div>
                  {minutes !== null && (
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: "bold",
                        color: isItemUrgent ? "#fff" : "#000",
                        marginTop: "2px",
                        textAlign: "left",
                      }}
                    >
                      {(() => {
                        const leaveTime = minutes - walkTime;
                        if (leaveTime <= 0) return "Go now";
                        return `Go in ${leaveTime} min${leaveTime !== 1 ? "s" : ""}`;
                      })()}
                    </div>
                  )}
                </div>
                {stop.arrival?.delay !== undefined &&
                  stop.arrival.delay !== 0 && (
                    <div
                      style={{
                        fontSize: "10px",
                        color: isItemUrgent
                          ? "#fff"
                          : getDisplayColor(
                              stop.arrival.delay > 0 ? "#d32f2f" : "#388e3c"
                            ),
                        fontWeight: "bold",
                      }}
                    >
                      {stop.arrival.delay > 0 ? "+" : ""}
                      {Math.floor(stop.arrival.delay / 60)} min
                    </div>
                  )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderFerryList = (
    ferries: FerryDeparture[],
    _direction: string,
    walkTime: number
  ) => {
    const threshold = displayConfig.urgentThresholdMinutes ?? 10;

    // Filter ferries where arrival time >= walk time
    const accessibleFerries = ferries.filter((ferry) => {
      return ferry.minutesUntil >= walkTime;
    });

    if (accessibleFerries.length === 0) {
      return (
        <p style={{
          color: "#000",
          fontSize: "13px",
          fontWeight: "bold"
        }}>
          No upcoming ferries
        </p>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          marginTop: "6px",
        }}
      >
        {accessibleFerries.map((ferry, index) => {
          const minutes = ferry.minutesUntil;

          // Calculate if this specific item is urgent
          const leaveTime = minutes - walkTime;
          const isItemUrgent = leaveTime < threshold;

          return (
            <div
              key={index}
              style={{
                padding: "6px",
                backgroundColor: isItemUrgent ? "#000" : "#fff",
                borderRadius: "4px",
                borderLeft: "3px solid #000000",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "bold",
                        backgroundColor: isItemUrgent ? "#FFFFFF" : "#000000",
                        color: isItemUrgent ? "#000000" : "#FFFFFF",
                        padding: "1px 4px",
                        borderRadius: "2px",
                        minWidth: "24px",
                        textAlign: "center",
                      }}
                    >
                      {ferry.route}
                    </span>
                    <div
                      style={{
                        fontSize: "15px",
                        fontWeight: "bold",
                        textAlign: "left",
                        color: isItemUrgent ? "#fff" : undefined,
                      }}
                    >
                      {ferry.departureTime.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: !displayConfig.use24HourTime,
                      })}
                      {ferry.isNextDay && (
                        <span style={{ marginLeft: "4px" }}>+1</span>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: "bold",
                      color: isItemUrgent ? "#fff" : "#000",
                      marginTop: "2px",
                      textAlign: "left",
                    }}
                  >
                    {(() => {
                      const leaveTime = minutes - walkTime;
                      if (leaveTime <= 0) return "Go now";
                      return `Go in ${leaveTime} min${leaveTime !== 1 ? "s" : ""}`;
                    })()}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderBusList = (buses: EnrichedBusData[], walkTime: number) => {
    const threshold = displayConfig.urgentThresholdMinutes ?? 10;

    // Filter buses where arrival time >= walk time
    const accessibleBuses = buses.filter((bus) => {
      const arrivalTime = bus.expectedArrival || bus.expectedDeparture;
      const minutes = arrivalTime
        ? Math.floor((arrivalTime.getTime() - Date.now()) / 60000)
        : null;
      return minutes !== null && minutes >= walkTime;
    });

    if (accessibleBuses.length === 0) {
      return (
        <p style={{
          color: "#000",
          fontSize: "13px",
          fontWeight: "bold"
        }}>
          No upcoming buses
        </p>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          marginTop: "6px",
        }}
      >
        {accessibleBuses.map((bus, index) => {
          const arrivalTime = bus.expectedArrival || bus.expectedDeparture;
          const minutes = arrivalTime
            ? Math.floor((arrivalTime.getTime() - Date.now()) / 60000)
            : null;

          // Calculate if this specific item is urgent
          const leaveTime = minutes !== null ? minutes - walkTime : null;
          const isItemUrgent = leaveTime !== null && leaveTime < threshold;

          // Get route display data
          const routeInfo = getBusRouteInfo(bus.routeName);
          // Force black background with white text for buses
          const routeColor = "#000000";
          const routeTextColor = "#FFFFFF";
          const routeLongName = routeInfo?.route_long_name || null;

          return (
            <div
              key={index}
              style={{
                padding: "6px",
                backgroundColor: isItemUrgent ? "#000" : "#fff",
                borderRadius: "4px",
                borderLeft: `3px solid ${routeColor}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      marginBottom: "2px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "bold",
                        backgroundColor: isItemUrgent ? "#fff" : routeColor,
                        color: isItemUrgent ? "#000" : routeTextColor,
                        padding: "1px 4px",
                        borderRadius: "2px",
                        minWidth: "24px",
                        textAlign: "center",
                      }}
                    >
                      {bus.routeName}
                    </span>
                    {routeLongName && (
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: "bold",
                          color: isItemUrgent ? "#fff" : "#000",
                        }}
                      >
                        {routeLongName}
                      </div>
                    )}
                    {!routeLongName && (
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: "bold",
                          color: isItemUrgent ? "#fff" : "#000",
                        }}
                      >
                        to {bus.destination}
                      </div>
                    )}
                  </div>
                  {arrivalTime && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "15px",
                          fontWeight: "bold",
                          textAlign: "left",
                          color: isItemUrgent ? "#fff" : undefined,
                        }}
                      >
                        {arrivalTime.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: !displayConfig.use24HourTime,
                        })}
                      </div>
                      {minutes !== null && (
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: "bold",
                            color: isItemUrgent ? "#fff" : "#000",
                          }}
                        >
                          {(() => {
                            const leaveTime = minutes - walkTime;
                            if (leaveTime <= 0) return "Go now";
                            return `Go in ${leaveTime} min${leaveTime !== 1 ? "s" : ""}`;
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
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
        overflow: "auto",
        boxSizing: "border-box",
        padding: "6px",
        position: "relative",
      }}
    >
      {loading && <p>Loading transit data...</p>}
      {error && <p style={{ color: "red" }}>Error: {error}</p>}

      {!loading && !error && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            height: "100%",
          }}
        >
          {/* Render rows and columns from displayConfig */}
          {displayConfig.rowDisplay.map((row, rowIndex) => (
            <div
              key={`row-${rowIndex}`}
              style={{
                display: "flex",
                gap: "6px",
                flex: 1,
              }}
            >
              {row.map((card, cardIndex) => (
                <TransitCard
                  key={`${card.transitType}-${card.stopId}-${cardIndex}`}
                  card={card}
                  transitData={transitData}
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
