import {
  type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate,
} from "../utils/subway";
import {
  type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate,
} from "../utils/railroad";
import { type EnrichedBusData } from "../utils/bus";
import { type FerryDeparture } from "../utils/ferry";

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
