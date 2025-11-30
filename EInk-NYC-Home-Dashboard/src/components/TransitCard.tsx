import { type TransitCard as TransitCardConfig } from "../displayConfig";
import { type TransitData } from "../types/transitData";
import { type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate } from "../utils/subway";
import { type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate } from "../utils/railroad";
import { type EnrichedBusData } from "../utils/bus";
import { type FerryDeparture } from "../utils/ferry";
import { getStationName, getDirectionLabels } from "../utils/stationLookup";

interface TransitCardProps {
  card: TransitCardConfig;
  transitData: TransitData;
  lastUpdate?: string;
  onRenderTrainList: (
    trains: (SubwayEnrichedStopTimeUpdate | RailroadEnrichedStopTimeUpdate)[],
    direction: string,
    walkTime: number,
    limit?: number
  ) => React.ReactNode;
  onRenderBusList: (buses: EnrichedBusData[], walkTime: number) => React.ReactNode;
  onRenderFerryList: (
    ferries: FerryDeparture[],
    direction: string,
    walkTime: number
  ) => React.ReactNode;
}

export function TransitCard({
  card,
  transitData,
  onRenderTrainList,
  onRenderBusList,
  onRenderFerryList,
}: TransitCardProps) {
  if (card.transitType === "ferry") {
    const data = transitData.ferry?.[card.stopId];
    if (!data) return null;

    return (
      <div className="card" style={{ flex: 1 }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          marginBottom: "4px",
          paddingBottom: "4px",
          borderBottom: "2px dotted #000"
        }}>
          <span style={{
            fontSize: "13px",
            fontWeight: "bold",
            border: "2px solid #000",
            borderRadius: "4px",
            padding: "2px 6px",
          }}>
            Ferry
          </span>
          <h2 style={{
            fontSize: "16px",
            margin: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>{card.stopId}</h2>
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>Uptown</h3>
            {onRenderFerryList(data.uptown, "uptown", card.walkTime)}
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>Downtown</h3>
            {onRenderFerryList(data.downTown, "downTown", card.walkTime)}
          </div>
        </div>
      </div>
    );
  }

  if (card.transitType === "subway") {
    const data = transitData.subway?.[card.stopId];
    if (!data) return null;

    const stationName = getStationName(card.stopId, "subway");
    const directionLabels = getDirectionLabels(card.stopId);

    return (
      <div className="card" style={{ flex: 1 }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          marginBottom: "4px",
          paddingBottom: "4px",
          borderBottom: "2px dotted #000"
        }}>
          <span style={{
            fontSize: "13px",
            fontWeight: "bold",
            border: "2px solid #000",
            borderRadius: "4px",
            padding: "2px 6px",
          }}>
            Subway
          </span>
          <h2 style={{
            fontSize: "16px",
            margin: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>{stationName}</h2>
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>
              {directionLabels?.southbound ||
                card.directionNames?.southbound ||
                "Southbound"}
            </h3>
            {onRenderTrainList(data.southbound, "S", card.walkTime, 3)}
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>
              {directionLabels?.northbound ||
                card.directionNames?.northbound ||
                "Northbound"}
            </h3>
            {onRenderTrainList(data.northbound, "N", card.walkTime, 3)}
          </div>
        </div>
      </div>
    );
  }

  if (
    card.transitType === "railroad-lirr" ||
    card.transitType === "railroad-mtn"
  ) {
    const data = transitData[card.transitType]?.[card.stopId];
    if (!data) return null;

    const stationName = getStationName(card.stopId, card.transitType);
    const railroadLabel =
      card.transitType === "railroad-lirr" ? "LIRR" : "Metro-North";

    return (
      <div className="card" style={{ flex: 1 }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          marginBottom: "4px",
          paddingBottom: "4px",
          borderBottom: "2px dotted #000"
        }}>
          <span style={{
            fontSize: "13px",
            fontWeight: "bold",
            border: "2px solid #000",
            borderRadius: "4px",
            padding: "2px 6px",
          }}>
            {railroadLabel}
          </span>
          <h2 style={{
            fontSize: "16px",
            margin: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>{stationName}</h2>
        </div>
        <div style={{ marginTop: "2px" }}>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>Departures</h3>
          {onRenderTrainList(data, "", card.walkTime, 5)}
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
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          marginBottom: "4px",
          paddingBottom: "4px",
          borderBottom: "2px dotted #000"
        }}>
          <span style={{
            fontSize: "13px",
            fontWeight: "bold",
            border: "2px solid #000",
            borderRadius: "4px",
            padding: "2px 6px",
          }}>
            Bus
          </span>
          <h2 style={{
            fontSize: "16px",
            margin: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>{stationName}</h2>
        </div>
        <div style={{ marginTop: "2px" }}>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>
            Next {data.length} buses
          </h3>
          {onRenderBusList(data, card.walkTime)}
        </div>
      </div>
    );
  }

  return null;
}
