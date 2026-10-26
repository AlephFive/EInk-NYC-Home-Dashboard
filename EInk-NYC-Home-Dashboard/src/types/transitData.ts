import {
  type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate,
} from "../utils/subway";
import {
  type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate,
} from "../utils/railroad";
import { type EnrichedBusData } from "../utils/bus";
import { type FerryDeparture } from "../utils/ferry";

/**
 * Per-card fetch errors, keyed by transit type then stop ID. A card with an
 * entry here renders the error in place instead of blanking the whole board.
 */
export interface TransitErrors {
  subway?: { [stopId: string]: string };
  "railroad-lirr"?: { [stopId: string]: string };
  "railroad-mtn"?: { [stopId: string]: string };
  bus?: { [stopId: string]: string };
  ferry?: { [stopName: string]: string };
}

export interface TransitData {
  subway?: {
    [stopId: string]: {
      southbound: SubwayEnrichedStopTimeUpdate[];
      northbound: SubwayEnrichedStopTimeUpdate[];
    };
  };
  "railroad-lirr"?: {
    [stopId: string]: RailroadEnrichedStopTimeUpdate[];
  };
  "railroad-mtn"?: {
    [stopId: string]: RailroadEnrichedStopTimeUpdate[];
  };
  bus?: {
    [stopId: string]: EnrichedBusData[];
  };
  ferry?: {
    [stopName: string]: {
      uptown: FerryDeparture[];
      downTown: FerryDeparture[];
    };
  };
}
