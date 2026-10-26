import { useState, useEffect } from "react";
import "./App.css";
import { type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate } from "./utils/subway";
import { type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate } from "./utils/railroad";
import { type EnrichedBusData } from "./utils/bus";
import { type FerryDeparture } from "./utils/ferry";
import {
  trainRows,
  busRows,
  ferryRows,
  type DepartureRowData,
} from "./utils/departureRows";
import { loadTransitData, TransitLoadError } from "./utils/loadTransitData";
import displayConfig from "./displayConfig";
import { TransitCard } from "./components/TransitCard";
import { DepartureRow, EmptyRow } from "./components/DepartureRow";
import { listStyle } from "./utils/cardCapacity";
import { type TransitData, type TransitErrors } from "./types/transitData";

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

        // Commit whatever loaded before the fault: the banner sits above the
        // cards rather than replacing them, so an unexpected failure costs
        // only the cards it actually affected.
        if (err instanceof TransitLoadError) {
          setTransitData(err.partial.data);
          setCardErrors(err.partial.errors);
          if (err.partial.lastUpdate) setLastUpdate(err.partial.lastUpdate);
        }
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

  /** Shared row options, so every list reads the same config. */
  const rowOptions = (walkTime: number, limit: number) => ({
    walkTime,
    limit,
    showLeaveIn,
  });

  /**
   * Draws a list of already-computed rows, or the empty-state line.
   *
   * The rows arrive as data from `utils/departureRows.ts` — what to show is
   * decided there, and this only turns it into elements.
   */
  const renderRows = (rows: DepartureRowData[], emptyLabel: string) => {
    if (rows.length === 0) return <EmptyRow label={emptyLabel} />;

    return (
      <div style={listStyle}>
        {rows.map(({ key, ...row }) => (
          <DepartureRow key={key} {...row} />
        ))}
      </div>
    );
  };

  const renderTrainList = (
    trains: (SubwayEnrichedStopTimeUpdate | RailroadEnrichedStopTimeUpdate)[],
    _direction: string,
    walkTime: number,
    limit: number = 3
  ) =>
    renderRows(
      trainRows(trains, rowOptions(walkTime, limit)),
      "No upcoming trains"
    );

  const renderFerryList = (
    ferries: FerryDeparture[],
    _direction: string,
    walkTime: number,
    limit: number = 3
  ) =>
    renderRows(
      ferryRows(ferries, rowOptions(walkTime, limit)),
      "No upcoming ferries"
    );

  const renderBusList = (
    buses: EnrichedBusData[],
    walkTime: number,
    limit: number = 3
  ) =>
    renderRows(busRows(buses, rowOptions(walkTime, limit)), "No upcoming buses");

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
