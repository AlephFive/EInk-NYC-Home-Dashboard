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
  type TrainDataResponse,
} from "./utils/railroad";

const vernonBlvdStopId = 721;
const grandCentral7TrainStopId = 723; // 7 train platform
const grandCentral456StopId = 631; // 4/5/6 train platform
const trainLinesToFetch = ["7", "4", "5", "6"]; // 7 for Vernon Blvd, 4/5/6 for Grand Central

// Railroad stop IDs (placeholder - adjust as needed)
const grandCentralRailroadStopId = "349"; // Grand Central Terminal for railroads
const railroadsToFetch = ["lirr", "mtn"]; // LIRR and Metro-North

function App() {
  const [vernonSouthbound, setVernonSouthbound] = useState<
    SubwayEnrichedStopTimeUpdate[]
  >([]);
  const [vernonNorthbound, setVernonNorthbound] = useState<
    SubwayEnrichedStopTimeUpdate[]
  >([]);
  const [gcSouthbound, setGcSouthbound] = useState<
    SubwayEnrichedStopTimeUpdate[]
  >([]);
  const [gcNorthbound, setGcNorthbound] = useState<
    SubwayEnrichedStopTimeUpdate[]
  >([]);
  const [gcRailroadDepartures, setGcRailroadDepartures] = useState<
    RailroadEnrichedStopTimeUpdate[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [railroadLastUpdate, setRailroadLastUpdate] = useState<string>("");
  const [showRawData, setShowRawData] = useState(false);
  const [railroadRawData, setRailroadRawData] =
    useState<TrainDataResponse | null>(null);

  useEffect(() => {
    const loadTrainData = async () => {
      try {
        setLoading(true);
        setError(null);

        const data = await fetchMultipleTrainLines(trainLinesToFetch);

        // Vernon Blvd
        const vernonSouth = await getUpcomingTrainsAtStation(
          data.feedMessage,
          vernonBlvdStopId.toString(),
          "S",
          "7"
        );
        const vernonNorth = await getUpcomingTrainsAtStation(
          data.feedMessage,
          vernonBlvdStopId.toString(),
          "N",
          "7"
        );

        // Grand Central - combine both platforms (7 train + 4/5/6 trains)
        const gc7South = await getUpcomingTrainsAtStation(
          data.feedMessage,
          grandCentral7TrainStopId.toString(),
          "S"
        );
        const gc7North = await getUpcomingTrainsAtStation(
          data.feedMessage,
          grandCentral7TrainStopId.toString(),
          "N"
        );
        const gc456South = await getUpcomingTrainsAtStation(
          data.feedMessage,
          grandCentral456StopId.toString(),
          "S"
        );
        const gc456North = await getUpcomingTrainsAtStation(
          data.feedMessage,
          grandCentral456StopId.toString(),
          "N"
        );

        // Merge trains from both platforms
        const gcSouth = [...gc7South, ...gc456South].sort((a, b) => {
          const timeA = a.arrival?.time || a.departure?.time || 0;
          const timeB = b.arrival?.time || b.departure?.time || 0;
          return timeA - timeB;
        });
        const gcNorth = [...gc7North, ...gc456North].sort((a, b) => {
          const timeA = a.arrival?.time || a.departure?.time || 0;
          const timeB = b.arrival?.time || b.departure?.time || 0;
          return timeA - timeB;
        });

        setVernonSouthbound(vernonSouth.slice(0, 3));
        setVernonNorthbound(vernonNorth.slice(0, 3));
        setGcSouthbound(gcSouth.slice(0, 3));
        setGcNorthbound(gcNorth.slice(0, 3));
        setLastUpdate(data.metadata.timestamp);

        // Fetch railroad data for Grand Central
        const railroadData = await fetchMultipleRailroads(railroadsToFetch);

        // Store the raw railroad data for display
        console.log("Setting railroad raw data:", railroadData);
        setRailroadRawData(railroadData);

        console.log("Railroad data fetched:", {
          totalEntities: railroadData.feedMessage.entity.length,
          metadata: railroadData.metadata,
        });

        // Log some sample stop IDs to see the format
        const sampleStops = railroadData.feedMessage.entity
          .slice(0, 10)
          .flatMap(
            (entity) =>
              entity.tripUpdate?.stopTimeUpdate.map((st) => st.stopId) || []
          );
        console.log("Sample stop IDs:", sampleStops);

        const gcRailroad = await getRailroadTrainsAtStation(
          railroadData.feedMessage,
          grandCentralRailroadStopId
        );

        console.log("GC Railroad trains found:", gcRailroad.length);
        console.log("GC Railroad trains:", gcRailroad);

        setGcRailroadDepartures(gcRailroad.slice(0, 5));
        setRailroadLastUpdate(railroadData.metadata.timestamp);
      } catch (error) {
        console.error("Error fetching train data:", error);
        setError(error instanceof Error ? error.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    loadTrainData();
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
                    }}
                  >
                    {stop.routeId && (
                      <span
                        style={{
                          fontSize: "16px",
                          fontWeight: "bold",
                          backgroundColor: color,
                          color: "white",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          minWidth: "24px",
                          textAlign: "center",
                        }}
                      >
                        {stop.routeId}
                      </span>
                    )}
                    {"railroad" in stop && stop.railroad && (
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
          {/* Vernon Blvd */}
          <div className="card">
            <h2>Vernon Blvd - Jackson Av</h2>
            <div style={{ display: "flex", gap: "30px", marginTop: "20px" }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginBottom: "10px" }}>To Manhattan</h3>
                {renderTrainList(vernonSouthbound, "S", "#b933ad")}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginBottom: "10px" }}>To Flushing</h3>
                {renderTrainList(vernonNorthbound, "N", "#b933ad")}
              </div>
            </div>
          </div>

          {/* Grand Central Subway */}
          <div className="card">
            <h2>Grand Central - 42 St (Subway)</h2>
            <div style={{ display: "flex", gap: "30px", marginTop: "20px" }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginBottom: "10px" }}>To Hudson Yards</h3>
                {renderTrainList(gcSouthbound, "S", "#b933ad")}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginBottom: "10px" }}>To Flushing</h3>
                {renderTrainList(gcNorthbound, "N", "#b933ad")}
              </div>
            </div>
          </div>

          {/* Grand Central Railroad */}
          <div className="card">
            <h2>Grand Central Terminal (Railroad)</h2>
            {railroadLastUpdate && (
              <p style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>
                Last updated: {railroadLastUpdate}
              </p>
            )}
            <div style={{ marginTop: "20px" }}>
              <h3 style={{ marginBottom: "10px" }}>
                Departures (Next 5 trains)
              </h3>
              {renderTrainList(gcRailroadDepartures, "", "#0039a6")}
            </div>
          </div>

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
