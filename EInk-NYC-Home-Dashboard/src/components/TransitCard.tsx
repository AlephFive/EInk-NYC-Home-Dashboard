import { type TransitCard as TransitCardConfig } from "../displayConfig";
import { type TransitData } from "../types/transitData";
import {
  type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate,
} from "../utils/subway";
import {
  type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate,
} from "../utils/railroad";
import { type EnrichedBusData } from "../utils/bus";
import { getStationName, getDirectionLabels } from "../utils/stationLookup";

interface TransitCardProps {
  card: TransitCardConfig;
  transitData: TransitData;
  lastUpdate?: string;
  onRenderTrainList: (
    trains: (SubwayEnrichedStopTimeUpdate | RailroadEnrichedStopTimeUpdate)[],
    direction: string,
    color: string
  ) => React.ReactNode;
  onRenderBusList: (
    buses: EnrichedBusData[],
    color: string
  ) => React.ReactNode;
}

export function TransitCard({
  card,
  transitData,
  lastUpdate,
  onRenderTrainList,
  onRenderBusList,
}: TransitCardProps) {
  if (card.transitType === "ferry") {
    return null; // Skip ferry as requested
  }

  if (card.transitType === "subway") {
    const data = transitData.subway?.[card.stopId];
    if (!data) return null;

    const stationName = getStationName(card.stopId, "subway");
    const directionLabels = getDirectionLabels(card.stopId);

    return (
      <div className="card" style={{ flex: 1 }}>
        <h2>{stationName}</h2>
        <p style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>
          Subway • {card.walkTime} min walk
        </p>
        {lastUpdate && (
          <p style={{ fontSize: "12px", color: "#666" }}>
            Last updated: {lastUpdate}
          </p>
        )}
        <div style={{ display: "flex", gap: "30px", marginTop: "20px" }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginBottom: "10px" }}>
              {directionLabels?.southbound ||
                card.directionNames?.southbound ||
                "Southbound"}
            </h3>
            {onRenderTrainList(data.southbound, "S", "#b933ad")}
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginBottom: "10px" }}>
              {directionLabels?.northbound ||
                card.directionNames?.northbound ||
                "Northbound"}
            </h3>
            {onRenderTrainList(data.northbound, "N", "#b933ad")}
          </div>
        </div>
      </div>
    );
  }

  if (card.transitType === "railroad-lirr" || card.transitType === "railroad-mtn") {
    const data = transitData[card.transitType]?.[card.stopId];
    if (!data) return null;

    const stationName = getStationName(card.stopId, card.transitType);
    const railroadLabel = card.transitType === "railroad-lirr" ? "LIRR" : "Metro-North";

    return (
      <div className="card" style={{ flex: 1 }}>
        <h2>{stationName}</h2>
        <p style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>
          {railroadLabel} • {card.walkTime} min walk
        </p>
        <div style={{ marginTop: "20px" }}>
          <h3 style={{ marginBottom: "10px" }}>Departures (Next 5 trains)</h3>
          {onRenderTrainList(data, "", "#0039a6")}
        </div>
      </div>
    );
  }

  if (card.transitType === "bus") {
    const data = transitData.bus?.[card.stopId];
    if (!data) return null;

    const stationName = getStationName(card.stopId, "bus");

    return (
      <div className="card" style={{ flex: 1 }}>
        <h2>{stationName}</h2>
        <p style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>
          Bus • {card.walkTime} min walk
        </p>
        <div style={{ marginTop: "20px" }}>
          <h3 style={{ marginBottom: "10px" }}>Next {data.length} buses</h3>
          {onRenderBusList(data, "#FFA500")}
        </div>
      </div>
    );
  }

  return null;
}
