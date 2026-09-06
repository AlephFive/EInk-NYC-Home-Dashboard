import { useState, useEffect } from "react";
import "./App.css";
import {
  isBoardable,
  type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate,
} from "./utils/subway";
import {
  getRailroadRouteShortName,
  isCityBound,
  badgeWidthForLabels,
  type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate,
} from "./utils/railroad";
import { type EnrichedBusData } from "./utils/bus";
import { type FerryDeparture } from "./utils/ferry";
import {
  minutesUntil,
  formatClockTime,
  leaveTimeFor,
  isUrgent,
  reachableDepartures,
  type DepartureTime,
} from "./utils/departures";
import { loadTransitData } from "./utils/loadTransitData";
import displayConfig from "./displayConfig";
import { TransitCard } from "./components/TransitCard";
import { DepartureRow, EmptyRow } from "./components/DepartureRow";
import { listStyle } from "./utils/cardCapacity";
import { type TransitData, type TransitErrors } from "./types/transitData";
import { getDestinationName } from "./utils/stationLookup";

function App() {
  const [transitData, setTransitData] = useState<TransitData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<TransitErrors>({});
  const [lastUpdate, setLastUpdate] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setCardErrors({});

      try {
        const result = await loadTransitData();
        if (cancelled) return;

        setTransitData(result.data);
        setCardErrors(result.errors);
        if (result.lastUpdate) setLastUpdate(result.lastUpdate);
      } catch (err) {
        // Per-type failures are already recorded per card; reaching here means
        // something unexpected broke, which is worth a banner of its own.
        console.error("Error fetching transit data:", err);
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const showLeaveIn = displayConfig.showLeaveIn ?? false;

  /** Builds one card's list, or the empty-state line when nothing is reachable. */
  const renderDepartures = <T,>(
    items: T[],
    timeOf: (item: T) => DepartureTime,
    walkTime: number,
    limit: number,
    emptyLabel: string,
    toRow: (item: T, leaveTime: number | null) => React.ReactNode
  ) => {
    const reachable = reachableDepartures(items, timeOf, walkTime, limit);
    if (reachable.length === 0) return <EmptyRow label={emptyLabel} />;

    return (
      <div style={listStyle}>
        {reachable.map((item) =>
          toRow(item, leaveTimeFor(minutesUntil(timeOf(item)), walkTime))
        )}
      </div>
    );
  };

  const renderTrainList = (
    trains: (SubwayEnrichedStopTimeUpdate | RailroadEnrichedStopTimeUpdate)[],
    _direction: string,
    walkTime: number,
    limit: number = 3
  ) => {
    // A card lists trains you can board, so the time that matters is when the
    // train leaves. At a terminal the two are disjoint: trains ending their run
    // carry only `arrival`, trains starting one carry only `departure`.
    const boardable = trains.filter(isBoardable);
    const timeOf = (
      stop: SubwayEnrichedStopTimeUpdate | RailroadEnrichedStopTimeUpdate
    ) => stop.departure?.time ?? stop.arrival?.time;

    // Railroad badges share one width per card, set by the longest branch name,
    // so destinations line up instead of stepping in and out with each badge.
    const uniformBadgeWidth = badgeWidthForLabels(
      reachableDepartures(boardable, timeOf, walkTime, limit).map((stop) =>
        "railroad" in stop && stop.railroad && stop.routeId
          ? getRailroadRouteShortName(
              stop.routeId,
              stop.railroad as "lirr" | "mtn"
            )
          : ""
      )
    );

    return renderDepartures(
      boardable,
      timeOf,
      walkTime,
      limit,
      "No upcoming trains",
      (stop, leaveTime) => {
        const railroad =
          "railroad" in stop && stop.railroad
            ? (stop.railroad as "lirr" | "mtn")
            : undefined;

        const cityBound = railroad
          ? isCityBound(stop.destinationStopId, railroad)
          : null;

        return (
          <DepartureRow
            key={stop.tripId ?? `${stop.stopId}-${stop.departure?.time}`}
            badge={
              railroad && stop.routeId
                ? getRailroadRouteShortName(stop.routeId, railroad)
                : stop.routeId ?? ""
            }
            badgeShape={railroad ? "rect" : "bullet"}
            badgeWidth={railroad ? uniformBadgeWidth : undefined}
            point={
              cityBound === true ? "left" : cityBound === false ? "right" : undefined
            }
            destination={getDestinationName(
              stop.destinationStopId,
              railroad === "lirr"
                ? "railroad-lirr"
                : railroad === "mtn"
                  ? "railroad-mtn"
                  : "subway"
            )}
            time={formatClockTime(timeOf(stop))}
            urgent={isUrgent(leaveTime)}
            leaveIn={showLeaveIn && leaveTime !== null ? leaveTime : undefined}
          />
        );
      }
    );
  };

  const renderFerryList = (
    ferries: FerryDeparture[],
    _direction: string,
    walkTime: number,
    limit: number = 3
  ) =>
    renderDepartures(
      ferries,
      (ferry) => ferry.departureTime,
      walkTime,
      limit,
      "No upcoming ferries",
      (ferry, leaveTime) => (
        <DepartureRow
          key={ferry.departureTime.getTime()}
          badge={ferry.route}
          badgeShape="rect"
          // The ferry schedule carries no destination; the card's two columns
          // already say uptown vs downtown.
          destination={ferry.isNextDay ? "+1 day" : null}
          time={formatClockTime(ferry.departureTime)}
          urgent={isUrgent(leaveTime)}
          leaveIn={showLeaveIn && leaveTime !== null ? leaveTime : undefined}
        />
      )
    );

  const renderBusList = (
    buses: EnrichedBusData[],
    walkTime: number,
    limit: number = 3
  ) =>
    renderDepartures(
      buses,
      (bus) => bus.expectedArrival ?? bus.expectedDeparture,
      walkTime,
      limit,
      "No upcoming buses",
      (bus, leaveTime) => (
        <DepartureRow
          key={`${bus.routeName}-${(bus.expectedArrival ?? bus.expectedDeparture)?.getTime()}`}
          badge={bus.routeName}
          badgeShape="rect"
          destination={bus.destination ?? null}
          time={formatClockTime(bus.expectedArrival ?? bus.expectedDeparture)}
          urgent={isUrgent(leaveTime)}
          leaveIn={showLeaveIn && leaveTime !== null ? leaveTime : undefined}
        />
      )
    );

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
