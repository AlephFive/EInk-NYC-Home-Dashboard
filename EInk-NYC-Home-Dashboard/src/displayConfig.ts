export type TransitType =
  | "subway"
  | "railroad-lirr"
  | "railroad-mtn"
  | "bus"
  | "ferry";

export interface TransitCard {
  transitType: TransitType;
  stopId: string;
  lines?: string[];
  walkTime: number;
  directionNames?: {
    northbound?: string;
    southbound?: string;
  };
}

export interface DisplayConfiguration {
  rowDisplay: TransitCard[][];
}

const displayConfig: DisplayConfiguration = {
  rowDisplay: [
    // Row 1: Two subway cards
    [
      {
        transitType: "subway",
        stopId: "721",
        lines: ["7"],
        walkTime: 10,
      },
      {
        transitType: "subway",
        stopId: "G24",
        lines: ["G"],
        walkTime: 15,
      },
    ],
    // Row 2: Railroad and Bus
    [
      {
        transitType: "railroad-lirr",
        stopId: "118", // Long Island City
        lines: ["1", "7"],
        walkTime: 5,
      },
      {
        transitType: "bus",
        stopId: "700748",
        walkTime: 3,
      },
    ],
    // Row 3: Ferry
    [
      {
        transitType: "ferry",
        stopId: "Hunter's Point South",
        walkTime: 5,
      },
      {
        transitType: "railroad-lirr",
        stopId: "349",
        walkTime: 5,
      },
    ],
  ],
};

export default displayConfig;
