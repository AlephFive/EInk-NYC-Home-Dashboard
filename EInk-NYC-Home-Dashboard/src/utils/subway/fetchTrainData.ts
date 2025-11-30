import {
  FeedMessage,
  TripUpdate_StopTimeUpdate,
} from "../../protocol/proto/generated/gtfs-realtime";
import apis from "../../staticData/subway/apis.json";

export interface TrainDataResponse {
  feedMessage: FeedMessage;
  metadata: {
    url: string;
    contentType: string | null;
    dataSize: number;
    timestamp: string;
    entityCount: number;
  };
}

export interface StopTimeData {
  stopId: string;
  stopName?: string;
  arrivalTime?: Date;
  departureTime?: Date;
  delay?: number;
  routeId?: string;
  tripId?: string;
  direction?: string;
}

export interface EnrichedStopTimeUpdate extends TripUpdate_StopTimeUpdate {
  routeId?: string;
  tripId?: string;
}

/**
 * Fetches and decodes MTA train data for the specified train line(s)
 * @param trainLine - The train line letter/number (e.g., "7", "A", "L")
 * @returns Decoded GTFS-realtime FeedMessage with metadata
 * @throws Error if the train line is not found or fetch fails
 */
export async function fetchTrainData(
  trainLine: string
): Promise<TrainDataResponse> {
  // Look up the API key for this train line
  const apiKey = apis.lineMappings[trainLine as keyof typeof apis.lineMappings];

  if (!apiKey) {
    throw new Error(`Train line "${trainLine}" not found in API mappings`);
  }

  // Get the API URL for this key
  const apiUrl = apis.apiUrl[apiKey as keyof typeof apis.apiUrl];

  if (!apiUrl) {
    throw new Error(`API URL not found for key "${apiKey}"`);
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
 * Fetches and merges MTA train data for multiple train lines with minimal API calls
 * @param trainLines - Array of train line letters/numbers (e.g., ["7", "4", "5", "6"])
 * @returns Decoded and merged GTFS-realtime FeedMessage with metadata
 * @throws Error if any train line is not found or fetch fails
 */
export async function fetchMultipleTrainLines(
  trainLines: string[]
): Promise<TrainDataResponse> {
  if (trainLines.length === 0) {
    throw new Error("At least one train line must be specified");
  }

  // Map train lines to their API keys and collect unique API keys
  const apiKeySet = new Set<string>();
  const apiKeyToUrl = new Map<string, string>();

  for (const line of trainLines) {
    const apiKey = apis.lineMappings[line as keyof typeof apis.lineMappings];

    if (!apiKey) {
      throw new Error(`Train line "${line}" not found in API mappings`);
    }

    const apiUrl = apis.apiUrl[apiKey as keyof typeof apis.apiUrl];

    if (!apiUrl) {
      throw new Error(`API URL not found for key "${apiKey}"`);
    }

    apiKeySet.add(apiKey);
    apiKeyToUrl.set(apiKey, apiUrl);
  }

  // Fetch data from each unique API endpoint
  const fetchPromises = Array.from(apiKeySet).map(async (apiKey) => {
    const apiUrl = apiKeyToUrl.get(apiKey)!;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch train data from ${apiKey}: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    return FeedMessage.decode(uint8Array);
  });

  // Wait for all fetches to complete
  const feedMessages = await Promise.all(fetchPromises);

  // Merge all feed messages
  const mergedEntities = feedMessages.flatMap((feed) => feed.entity);

  // Use the header from the first feed message
  const primaryHeader = feedMessages[0].header;

  const mergedFeedMessage: FeedMessage = {
    header: primaryHeader,
    entity: mergedEntities,
  };

  // Calculate total data size
  const totalSize = feedMessages.reduce((sum, _feed, _index) => {
    // We don't have the original arrayBuffer sizes here, so we'll estimate
    return sum + mergedEntities.length;
  }, 0);

  return {
    feedMessage: mergedFeedMessage,
    metadata: {
      url: `Multiple APIs (${apiKeySet.size} endpoints)`,
      contentType: "application/x-protobuf",
      dataSize: totalSize,
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
 * @param stopId - The stop ID to filter by (e.g., "127N", "127S")
 * @param subwayLine - Optional subway line to filter by (e.g., "7", "A"). If not provided, shows all lines
 * @returns Array of stop time data for the specified stop with route information
 */
export async function extractDataByStop(
  feedMessage: FeedMessage,
  stopId: string,
  subwayLine?: string
): Promise<EnrichedStopTimeUpdate[]> {
  const possibleTrainsOnStation: EnrichedStopTimeUpdate[] = [];

  feedMessage.entity.forEach((entity) => {
    // Filter by subway line if provided
    if (subwayLine && entity.tripUpdate?.trip?.routeId !== subwayLine) {
      return;
    }

    const routeId = entity.tripUpdate?.trip?.routeId;
    const tripId = entity.tripUpdate?.trip?.tripId;

    entity.tripUpdate?.stopTimeUpdate.forEach((stopTime) => {
      if (stopTime.stopId === stopId) {
        possibleTrainsOnStation.push({
          ...stopTime,
          routeId,
          tripId,
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
  const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds (Unix timestamp)

  return stopTimes
    .filter((stopTime) => {
      const arrivalTime = stopTime.arrival?.time;
      const departureTime = stopTime.departure?.time;

      // Use arrival time if available, otherwise use departure time
      const timeToCompare = arrivalTime || departureTime;

      // Only include if the time is in the future
      return timeToCompare && timeToCompare > currentTime;
    })
    .sort((a, b) => {
      const timeA = a.arrival?.time || a.departure?.time || 0;
      const timeB = b.arrival?.time || b.departure?.time || 0;
      return timeA - timeB;
    });
}

/**
 * Wrapper function to get upcoming trains at a specific station with direction
 * @param feedMessage - The decoded GTFS-realtime FeedMessage
 * @param stopId - The stop ID without direction (e.g., "721")
 * @param direction - Direction: "N" for northbound or "S" for southbound
 * @param subwayLine - Optional subway line to filter by (e.g., "7", "A"). If not provided, shows all lines
 * @returns Filtered and sorted array of upcoming trains at the specified stop with route information
 */
export async function getUpcomingTrainsAtStation(
  feedMessage: FeedMessage,
  stopId: string,
  direction: "N" | "S",
  subwayLine?: string
): Promise<EnrichedStopTimeUpdate[]> {
  const stopIdWithDirection = `${stopId}${direction}`;

  // Extract stop data for the specific stop with direction
  const stopTimes = await extractDataByStop(
    feedMessage,
    stopIdWithDirection,
    subwayLine
  );

  // Filter to only show upcoming trains
  const upcomingTrains = filterUpcomingTrains(stopTimes);

  return upcomingTrains;
}
