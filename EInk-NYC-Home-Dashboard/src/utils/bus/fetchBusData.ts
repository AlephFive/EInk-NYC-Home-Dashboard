import apis from "../../staticData/bus/apis.json";

// SIRI Response Types
export interface BusDataResponse {
  data: SiriResponse;
  metadata: {
    url: string;
    timestamp: string;
    stopId: string;
  };
}

export interface SiriResponse {
  Siri: {
    ServiceDelivery: {
      ResponseTimestamp: string;
      StopMonitoringDelivery: Array<{
        MonitoredStopVisit?: MonitoredStopVisit[];
        ErrorCondition?: {
          Description?: string;
          OtherError?: { ErrorText?: string };
        };
      }>;
    };
  };
}

export interface MonitoredStopVisit {
  RecordedAtTime: string;
  MonitoringRef: string;
  MonitoredVehicleJourney: {
    LineRef: string;
    DirectionRef: string;
    PublishedLineName: string;
    OperatorRef: string;
    OriginRef: string;
    OriginName: string;
    DestinationRef: string;
    DestinationName: string;
    Monitored: boolean;
    VehicleRef?: string;
    MonitoredCall: {
      StopPointRef: string;
      StopPointName: string;
      VisitNumber: number;
      Extensions: {
        Distances: {
          PresentableDistance: string;
          DistanceFromCall: number;
          StopsFromCall: number;
          CallDistanceAlongRoute: number;
        };
      };
      ExpectedArrivalTime?: string;
      ExpectedDepartureTime?: string;
      ArrivalProximityText?: string;
    };
  };
}

export interface EnrichedBusData {
  stopId: string;
  stopName: string;
  routeId: string;
  routeName: string;
  direction: string;
  destination: string;
  expectedArrival?: Date;
  expectedDeparture?: Date;
  distanceAway: string;
  stopsAway: number;
  monitored: boolean;
}

/**
 * Fetches bus arrival data for a specific stop
 * @param stopId - The MTA Bus stop ID (MonitoringRef)
 * @param maxVisits - Maximum number of upcoming buses to return (default: 5)
 * @returns Bus arrival data in SIRI format with metadata
 * @throws Error if the fetch fails
 */
export async function fetchBusData(
  stopId: string,
  maxVisits: number = 5
): Promise<BusDataResponse> {
  const apiKey = import.meta.env.VITE_MTA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "MTA API key not found. Please set VITE_MTA_API_KEY in your .env file"
    );
  }

  // Build the API URL with query parameters
  const url = new URL(apis.apiUrl);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("MonitoringRef", stopId);
  url.searchParams.set("MaximumStopVisits", maxVisits.toString());

  // Fetch the data
  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `Failed to fetch bus data: ${response.status} ${response.statusText}`
    );
  }

  // Parse the JSON response
  const data: SiriResponse = await response.json();

  // The SIRI API reports bad stop IDs as HTTP 200 with an ErrorCondition in the
  // body, so a failed lookup is otherwise indistinguishable from "no buses due".
  const errorCondition =
    data.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.ErrorCondition;

  if (errorCondition) {
    const errorText =
      errorCondition.OtherError?.ErrorText ||
      errorCondition.Description ||
      "Unknown error";
    throw new Error(`Bus stop ${stopId}: ${errorText}`);
  }

  // Return the data with metadata
  return {
    data,
    metadata: {
      url: url.toString(),
      timestamp:
        data.Siri?.ServiceDelivery?.ResponseTimestamp ||
        new Date().toISOString(),
      stopId,
    },
  };
}

/**
 * Extracts and enriches bus arrival data from SIRI response
 * @param response - The SIRI response from fetchBusData
 * @returns Array of enriched bus arrival data
 */
export function extractBusArrivals(
  response: BusDataResponse
): EnrichedBusData[] {
  const enrichedData: EnrichedBusData[] = [];

  const stopVisits =
    response.data.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]
      ?.MonitoredStopVisit || [];

  for (const visit of stopVisits) {
    const journey = visit.MonitoredVehicleJourney;
    const call = journey.MonitoredCall;

    enrichedData.push({
      stopId: call.StopPointRef,
      stopName: call.StopPointName,
      routeId: journey.LineRef,
      routeName: journey.PublishedLineName,
      direction: journey.DirectionRef,
      destination: journey.DestinationName,
      expectedArrival: call.ExpectedArrivalTime
        ? new Date(call.ExpectedArrivalTime)
        : undefined,
      expectedDeparture: call.ExpectedDepartureTime
        ? new Date(call.ExpectedDepartureTime)
        : undefined,
      distanceAway: call.Extensions?.Distances?.PresentableDistance || "N/A",
      stopsAway: call.Extensions?.Distances?.StopsFromCall || 0,
      monitored: journey.Monitored,
    });
  }

  return enrichedData;
}

/**
 * Filters bus arrivals to only include upcoming buses
 * @param arrivals - Array of enriched bus arrival data
 * @returns Filtered array containing only future arrivals
 */
export function filterUpcomingBuses(
  arrivals: EnrichedBusData[]
): EnrichedBusData[] {
  const now = new Date();

  return arrivals
    .filter((arrival) => {
      const arrivalTime = arrival.expectedArrival || arrival.expectedDeparture;
      return arrivalTime && arrivalTime > now;
    })
    .sort((a, b) => {
      const timeA =
        (a.expectedArrival || a.expectedDeparture)?.getTime() || 0;
      const timeB =
        (b.expectedArrival || b.expectedDeparture)?.getTime() || 0;
      return timeA - timeB;
    });
}

/**
 * Convenience function to get upcoming buses at a specific stop
 * @param stopId - The MTA Bus stop ID
 * @param maxVisits - Maximum number of upcoming buses to return
 * @returns Filtered and sorted array of upcoming bus arrivals
 */
export async function getUpcomingBusesAtStop(
  stopId: string,
  maxVisits: number = 5
): Promise<EnrichedBusData[]> {
  const response = await fetchBusData(stopId, maxVisits);
  const arrivals = extractBusArrivals(response);
  return filterUpcomingBuses(arrivals);
}
