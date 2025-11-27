import { useState, useEffect } from "react";
import "./App.css";
import {
  fetchMultipleTrainLines,
  getUpcomingTrainsAtStation,
  type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate,
  getSubwayLineColor,
  getSubwayLineTextColor,
} from "./utils/subway";
import {
  fetchMultipleRailroads,
  getUpcomingTrainsAtStation as getRailroadTrainsAtStation,
  type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate,
  type TrainDataResponse,
} from "./utils/railroad";
import {
  getUpcomingBusesAtStop,
  type EnrichedBusData,
} from "./utils/bus";
import {
  getRailroadRouteColor,
  getRailroadRouteTextColor,
  getRailroadRouteName,
} from "./utils/railroad";
import displayConfig from "./displayConfig";
import { TransitCard } from "./components/TransitCard";
import { type TransitData } from "./types/transitData";

const railroadsToFetch = ["lirr", "mtn"]; // LIRR and Metro-North

function App() {
  const [transitData, setTransitData] = useState<TransitData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [showRawData, setShowRawData] = useState(false);
  const [railroadRawData, setRailroadRawData] =
    useState<TrainDataResponse | null>(null);

  useEffect(() => {
    const loadTransitData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Collect all stops from displayConfig (excluding ferry)
        const subwayStops = new Set<string>();
        const subwayLines = new Set<string>();
        const lirrStops = new Set<string>();
        const mtnStops = new Set<string>();
        const busStops = new Set<string>();

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
            }
          });
        });

        const newTransitData: TransitData = {
          subway: {},
          "railroad-lirr": {},
          "railroad-mtn": {},
          bus: {},
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
              southbound: southbound.slice(0, 3),
              northbound: northbound.slice(0, 3),
            };
          }

          setLastUpdate(data.metadata.timestamp);
        }

        // Fetch railroad data
        if (lirrStops.size > 0 || mtnStops.size > 0) {
          const railroadData = await fetchMultipleRailroads(railroadsToFetch);
          setRailroadRawData(railroadData);

          // Process LIRR stops
          for (const stopId of lirrStops) {
            const trains = await getRailroadTrainsAtStation(
              railroadData.feedMessage,
              stopId,
              undefined, // routeId
              "lirr" // Filter by LIRR only
            );
            newTransitData["railroad-lirr"]![stopId] = trains.slice(0, 5);
          }

          // Process Metro-North stops
          for (const stopId of mtnStops) {
            const trains = await getRailroadTrainsAtStation(
              railroadData.feedMessage,
              stopId,
              undefined, // routeId
              "mtn" // Filter by Metro-North only
            );
            newTransitData["railroad-mtn"]![stopId] = trains.slice(0, 5);
          }
        }

        // Fetch bus data
        if (busStops.size > 0) {
          for (const stopId of busStops) {
            const buses = await getUpcomingBusesAtStop(stopId, 5);
            newTransitData.bus![stopId] = buses;
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
    direction: string,
    color: string
  ) => {
    if (trains.length === 0) {
      return (
        <p style={{ color: "#999", fontSize: "14px" }}>No upcoming trains</p>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          marginTop: "15px",
        }}
      >
        {trains.map((stop, index) => {
          const minutes = getMinutesUntil(stop.arrival?.time);

          // Determine if this is a railroad or subway train
          const isRailroad = "railroad" in stop && stop.railroad;

          // Get route-specific colors
          let routeColor: string;
          let routeTextColor: string;
          let routeDisplayName: string | undefined;

          if (isRailroad && stop.routeId) {
            // Railroad train - use railroad colors
            routeColor = `#${getRailroadRouteColor(stop.routeId, stop.railroad as "lirr" | "mtn")}`;
            routeTextColor = `#${getRailroadRouteTextColor(stop.routeId, stop.railroad as "lirr" | "mtn")}`;
            routeDisplayName = getRailroadRouteName(stop.routeId, stop.railroad as "lirr" | "mtn");
          } else if (stop.routeId) {
            // Subway train - use subway colors
            routeColor = getSubwayLineColor(stop.routeId);
            routeTextColor = getSubwayLineTextColor(stop.routeId);
            routeDisplayName = stop.routeId;
          } else {
            // Fallback
            routeColor = `#${color.replace('#', '')}`;
            routeTextColor = "white";
            routeDisplayName = stop.routeId;
          }

          return (
            <div
              key={index}
              style={{
                padding: "15px",
                backgroundColor: "#f5f5f5",
                borderRadius: "8px",
                borderLeft: `4px solid ${routeColor}`,
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
                      gap: "8px",
                    }}
                  >
                    {stop.routeId && (
                      <span
                        style={{
                          fontSize: isRailroad ? "12px" : "16px",
                          fontWeight: "bold",
                          backgroundColor: routeColor,
                          color: routeTextColor,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          minWidth: isRailroad ? "auto" : "24px",
                          textAlign: "center",
                        }}
                      >
                        {routeDisplayName}
                      </span>
                    )}
                    {isRailroad && stop.railroad && (
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: "bold",
                          backgroundColor: "#666",
                          color: "white",
                          padding: "2px 6px",
                          borderRadius: "3px",
                        }}
                      >
                        {stop.railroad.toUpperCase()}
                      </span>
                    )}
                    <div style={{ fontSize: "18px", fontWeight: "bold" }}>
                      {formatTime(stop.arrival?.time)}
                    </div>
                  </div>
                  {minutes !== null && (
                    <div
                      style={{
                        fontSize: "14px",
                        color: "#666",
                        marginTop: "4px",
                      }}
                    >
                      {minutes <= 0
                        ? "Arriving now"
                        : `${minutes} min${minutes !== 1 ? "s" : ""}`}
                    </div>
                  )}
                </div>
                {stop.arrival?.delay !== undefined &&
                  stop.arrival.delay !== 0 && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: stop.arrival.delay > 0 ? "#d32f2f" : "#388e3c",
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

  const renderBusList = (buses: EnrichedBusData[], color: string) => {
    if (buses.length === 0) {
      return (
        <p style={{ color: "#999", fontSize: "14px" }}>No upcoming buses</p>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          marginTop: "15px",
        }}
      >
        {buses.map((bus, index) => {
          const arrivalTime = bus.expectedArrival || bus.expectedDeparture;
          const minutes = arrivalTime
            ? Math.floor((arrivalTime.getTime() - Date.now()) / 60000)
            : null;

          return (
            <div
              key={index}
              style={{
                padding: "15px",
                backgroundColor: "#f5f5f5",
                borderRadius: "8px",
                borderLeft: `4px solid ${color}`,
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
                      gap: "8px",
                      marginBottom: "4px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "16px",
                        fontWeight: "bold",
                        backgroundColor: color,
                        color: "white",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        minWidth: "40px",
                        textAlign: "center",
                      }}
                    >
                      {bus.routeName}
                    </span>
                    <div style={{ fontSize: "14px", color: "#666" }}>
                      to {bus.destination}
                    </div>
                  </div>
                  {arrivalTime && (
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: "bold",
                        marginTop: "4px",
                      }}
                    >
                      {arrivalTime.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  )}
                  {minutes !== null && (
                    <div
                      style={{
                        fontSize: "14px",
                        color: "#666",
                        marginTop: "4px",
                      }}
                    >
                      {minutes <= 0
                        ? "Arriving now"
                        : `${minutes} min${minutes !== 1 ? "s" : ""}`}
                      {bus.stopsAway > 0 && ` (${bus.stopsAway} stops away)`}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: "#666" }}>
                  {bus.distanceAway}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <h1>NYC Home Dashboard</h1>
      {lastUpdate && (
        <p style={{ fontSize: "14px", color: "#666", marginBottom: "20px" }}>
          Last updated: {lastUpdate}
        </p>
      )}
      {loading && <p>Loading train data...</p>}
      {error && <p style={{ color: "red" }}>Error: {error}</p>}

      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
          {/* Render rows and columns from displayConfig */}
          {displayConfig.rowDisplay.map((row, rowIndex) => (
            <div
              key={`row-${rowIndex}`}
              style={{
                display: "flex",
                gap: "30px",
                flexWrap: "wrap",
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
                />
              ))}
            </div>
          ))}

          {/* Raw Railroad API Data */}
          <div className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2>Raw Railroad API Data</h2>
              <button
                onClick={() => setShowRawData(!showRawData)}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#0039a6",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                {showRawData ? "Hide" : "Show"} JSON
              </button>
            </div>
            {showRawData && (
              <div style={{ marginTop: "20px" }}>
                {railroadRawData ? (
                  <pre
                    style={{
                      backgroundColor: "#f5f5f5",
                      padding: "15px",
                      borderRadius: "8px",
                      overflow: "auto",
                      maxHeight: "600px",
                      fontSize: "12px",
                      fontFamily: "monospace",
                    }}
                  >
                    {JSON.stringify(railroadRawData, null, 2)}
                  </pre>
                ) : (
                  <p style={{ color: "#999", marginTop: "10px" }}>
                    No railroad data available
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;
