import {
  FeedMessage,
  TripUpdate_StopTimeUpdate,
} from "../../protocol/proto/generated/gtfs-realtime";
import apis from "../../staticData/railroad/apis.json";

export interface TrainDataResponse {
  feedMessage: FeedMessage;
  /** Per-railroad fetch failures, keyed by railroad id. Absent when all succeeded. */
  failures?: Record<string, string>;
  metadata: {
    url: string;
    contentType: string | null;
    dataSize: number;
    timestamp: string;
    entityCount: number;
  };
}

export interface EnrichedStopTimeUpdate extends TripUpdate_StopTimeUpdate {
  routeId?: string;
  tripId?: string;
  railroad?: string; // "lirr" or "mtn"
  /**
   * Stop ID of the trip's last stop. Undefined when this stop *is* the last
   * one, i.e. the train terminates here and has nowhere onward to show.
   */
  destinationStopId?: string;
}

/**
 * Fetches and decodes railroad train data for the specified railroad
 * @param railroad - The railroad identifier (e.g., "lirr", "mtn")
 * @returns Decoded GTFS-realtime FeedMessage with metadata
 * @throws Error if the railroad is not found or fetch fails
 */
export async function fetchTrainData(
  railroad: string
): Promise<TrainDataResponse> {
  // Get the API URL for this railroad
  const apiUrl = apis.apiUrl[railroad as keyof typeof apis.apiUrl];

  if (!apiUrl) {
    throw new Error(`Railroad "${railroad}" not found in API mappings`);
  }

  // Fetch the data
  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch train data: ${response.status} ${response.statusText}`
    );
  }

  // Get the binary data and decode it
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Decode the protobuf message
  const feedMessage = FeedMessage.decode(uint8Array);

  // Return the decoded message with metadata
  return {
    feedMessage,
    metadata: {
      url: apiUrl,
      contentType: response.headers.get("content-type"),
      dataSize: arrayBuffer.byteLength,
      timestamp: feedMessage.header?.timestamp
        ? new Date(feedMessage.header.timestamp * 1000).toLocaleString()
        : "N/A",
      entityCount: feedMessage.entity.length,
    },
  };
}

/**
 * Fetches and merges railroad data for multiple railroads (e.g., both LIRR and Metro-North at Grand Central)
 * @param railroads - Array of railroad identifiers (e.g., ["lirr", "mtn"])
 * @returns Decoded and merged GTFS-realtime FeedMessage with metadata
 * @throws Error if any railroad is not found or fetch fails
 */
export async function fetchMultipleRailroads(
  railroads: string[]
): Promise<TrainDataResponse> {
  if (railroads.length === 0) {
    throw new Error("At least one railroad must be specified");
  }

  // Fetch data from each railroad
  const fetchPromises = railroads.map(async (railroad) => {
    const apiUrl = apis.apiUrl[railroad as keyof typeof apis.apiUrl];

    if (!apiUrl) {
      throw new Error(`Railroad "${railroad}" not found in API mappings`);
    }

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch railroad data from ${railroad}: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const feedMessage = FeedMessage.decode(uint8Array);

    // Tag entities with the railroad they came from
    const enrichedEntities = feedMessage.entity.map((entity) => ({
      ...entity,
      _railroad: railroad, // Internal field to track source
    }));

    return { ...feedMessage, entity: enrichedEntities };
  });

  // Settle rather than all: one railroad being down should not discard the
  // other's data, since each railroad's stops are rendered on separate cards.
  const results = await Promise.allSettled(fetchPromises);

  const feedMessages = results.flatMap((r) =>
    r.status === "fulfilled" ? [r.value] : []
  );

  // Record which railroads failed so callers can report it per card
  const failures: Record<string, string> = {};
  results.forEach((r, index) => {
    if (r.status === "rejected") {
      const reason = r.reason;
      failures[railroads[index]] =
        reason instanceof Error ? reason.message : String(reason);
    }
  });

  if (feedMessages.length === 0) {
    throw new Error(
      `All railroad feeds failed: ${Object.values(failures).join("; ")}`
    );
  }

  // Merge all feed messages
  const mergedEntities = feedMessages.flatMap((feed) => feed.entity);

  // Use the header from the first feed message
  const primaryHeader = feedMessages[0].header;

  const mergedFeedMessage: FeedMessage = {
    header: primaryHeader,
    entity: mergedEntities,
  };

  return {
    feedMessage: mergedFeedMessage,
    failures,
    metadata: {
      url: `Multiple railroads (${railroads.join(", ")})`,
      contentType: "application/x-protobuf",
      dataSize: mergedEntities.length,
      timestamp: primaryHeader?.timestamp
        ? new Date(primaryHeader.timestamp * 1000).toLocaleString()
        : "N/A",
      entityCount: mergedEntities.length,
    },
  };
}

/**
 * Extracts stop time data for a specific stop from the feed message
 * @param feedMessage - The decoded GTFS-realtime FeedMessage
 * @param stopId - The stop ID to filter by
 * @param routeId - Optional route ID to filter by
 * @param railroad - Optional railroad to filter by ("lirr" or "mtn")
 * @returns Array of stop time data for the specified stop with route and railroad information
 */
export async function extractDataByStop(
  feedMessage: FeedMessage,
  stopId: string,
  routeId?: string,
  railroad?: string
): Promise<EnrichedStopTimeUpdate[]> {
  const possibleTrainsOnStation: EnrichedStopTimeUpdate[] = [];

  feedMessage.entity.forEach((entity: any) => {
    // Filter by railroad if provided (important when LIRR and MTN have overlapping stop IDs)
    if (railroad && entity._railroad !== railroad) {
      return;
    }

    // Filter by route if provided
    if (routeId && entity.tripUpdate?.trip?.routeId !== routeId) {
      return;
    }

    const trainRouteId = entity.tripUpdate?.trip?.routeId;
    const tripId = entity.tripUpdate?.trip?.tripId;
    const entityRailroad = entity._railroad; // Get the railroad tag if present

    // The trip's last stop is this train's destination.
    const stopTimeUpdates: TripUpdate_StopTimeUpdate[] =
      entity.tripUpdate?.stopTimeUpdate ?? [];
    const terminusStopId = stopTimeUpdates[stopTimeUpdates.length - 1]?.stopId;

    stopTimeUpdates.forEach((stopTime: TripUpdate_StopTimeUpdate) => {
      if (stopTime.stopId === stopId) {
        possibleTrainsOnStation.push({
          ...stopTime,
          routeId: trainRouteId,
          tripId,
          railroad: entityRailroad,
          // Omit when the train terminates at this very stop.
          destinationStopId:
            terminusStopId === stopId ? undefined : terminusStopId,
        });
      }
    });
  });

  return possibleTrainsOnStation;
}

/**
 * Filters stop time updates to only include trains arriving after the current time
 * @param stopTimes - Array of stop time updates
 * @returns Filtered array containing only future arrivals, sorted by arrival time
 */
export function filterUpcomingTrains(
  stopTimes: EnrichedStopTimeUpdate[]
): EnrichedStopTimeUpdate[] {
  const currentTime = Math.floor(Date.now() / 1000);

  return stopTimes
    .filter((stopTime) => {
      const arrivalTime = stopTime.arrival?.time;
      const departureTime = stopTime.departure?.time;
      const timeToCompare = arrivalTime || departureTime;
      return timeToCompare && timeToCompare > currentTime;
    })
    .sort((a, b) => {
      const timeA = a.arrival?.time || a.departure?.time || 0;
      const timeB = b.arrival?.time || b.departure?.time || 0;
      return timeA - timeB;
    });
}

/**
 * Wrapper function to get upcoming trains at a specific station
 * @param feedMessage - The decoded GTFS-realtime FeedMessage
 * @param stopId - The stop ID to filter by
 * @param routeId - Optional route ID to filter by
 * @param railroad - Optional railroad to filter by ("lirr" or "mtn")
 * @returns Filtered and sorted array of upcoming trains at the specified stop with route information
 */
export async function getUpcomingTrainsAtStation(
  feedMessage: FeedMessage,
  stopId: string,
  routeId?: string,
  railroad?: string
): Promise<EnrichedStopTimeUpdate[]> {
  const stopTimes = await extractDataByStop(feedMessage, stopId, routeId, railroad);
  const upcomingTrains = filterUpcomingTrains(stopTimes);
  return upcomingTrains;
}
