export type TransitType =
  | "subway"
  | "railroad-lirr"
  | "railroad-mtn"
  | "bus"
  | "ferry";

export interface TransitCard {
  transitType: TransitType;
  /**
   * One or more stop IDs making up this card. A single place often spans
   * several IDs: a bus corner is one ID per direction, and 35 subway complexes
   * (Times Sq is five: R16, A27, 127, 725, 902) split by platform group. All
   * of a card's IDs are fetched and merged into one list.
   *
   * Subway IDs are given without the N/S suffix — the app appends it and
   * queries both directions of each ID.
   */
  stopIds: string[];
  /**
   * Card heading. Defaults to the name of the first entry in `stopIds`; set
   * this when a card's IDs resolve to different names, or the first one reads
   * badly.
   */
  title?: string;
  lines?: string[];
  walkTime: number;
  directionNames?: {
    northbound?: string;
    southbound?: string;
  };
  /**
   * Departures to show on this card, overriding both `defaultDepartures` and
   * the count fitted to the card's height. Subway, ferry and bus cards show
   * two columns, so this is the count *per column*; railroad cards show a
   * single list of this length. Leave unset to fill the card.
   */
  departures?: number;
}

export interface DisplayConfiguration {
  /**
   * Column-first layout: the outer array is columns left-to-right, each inner
   * array holds at most 2 cards stacked top-to-bottom. A column with a single
   * card gives that card the column's full height.
   */
  columnDisplay: TransitCard[][];
  use24HourTime?: boolean;
  urgentThresholdMinutes?: number;
  /**
   * Departures shown per card when a card does not set `departures`. Leave
   * unset — the default — to fit each card's height instead, which is what
   * makes a re-arranged layout work without retuning every card.
   */
  defaultDepartures?: number;
  /**
   * Show the "Go in N mins" line, which subtracts `walkTime` from each arrival.
   * Off by default: the panel is screenshotted on an interval, so a countdown is
   * stale by up to that interval, while the arrival clock time never is. The
   * walk-time filter still applies either way — departures you could not reach
   * are dropped regardless of this setting.
   */
  showLeaveIn?: boolean;
  /**
   * How many departures to request per stop, for the feeds that take a limit
   * (bus and ferry). Must exceed the displayed count: departures inside your
   * walk time are filtered out *after* fetching, so fetching exactly as many
   * as you display leaves the card short. Ignored by subway and railroad,
   * whose GTFS-RT feeds return every upcoming departure in one response.
   */
  fetchDepartures?: number;
}

const displayConfig: DisplayConfiguration = {
  use24HourTime: true,
  urgentThresholdMinutes: 10,
  fetchDepartures: 8,
  showLeaveIn: false,
  columnDisplay: [
    // Column 1: the two subway stops
    [
      {
        transitType: "subway",
        stopIds: ["721"],
        lines: ["7"],
        walkTime: 10,
      },
      {
        // Times Sq-42 St is five separate stop IDs, one per platform group:
        // 127 (1/2/3), R16 (N/Q/R/W), A27 (A/C/E), 725 (7), 902 (shuttle).
        // Listing more of them here would merge them into one card.
        transitType: "subway",
        stopIds: ["127"],
        lines: ["1", "2", "3"],
        walkTime: 15,
      },
    ],
    // Column 2
    [
      {
        transitType: "bus",
        // Borden Av/5 St: one ID per direction, same stop_name on both.
        stopIds: ["505513", "505507"],
        walkTime: 3,
      },
      {
        // Coney Island-Stillwell Av: one stop ID serving four lines (D F N Q),
        // and a true terminal — southbound trains all end here.
        transitType: "subway",
        stopIds: ["D43"],
        lines: ["D", "F", "N", "Q"],
        walkTime: 5,
      },
    ],
    // Column 3: a single card, so it runs the full height
    [
      {
        transitType: "railroad-lirr",
        stopIds: ["102"], // Jamaica — a hub, so departures fan out across branches
        walkTime: 5,
      },
    ],
  ],
};

export default displayConfig;
