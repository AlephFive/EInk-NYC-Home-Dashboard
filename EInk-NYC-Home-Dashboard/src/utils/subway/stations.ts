import data from "../../protocol/MTA_Subway_Stations_20251126.geojson";

export interface StationDetails {
  gtfs_station_id: string;
  name: string;
  northDirectionLabel: string;
  southDirectionLabel: string;
}

export const getStationDetails: (gtfs_station_id: string) => StationDetails = (
  gtfs_station_id
) => {
  const stationData = data.features.find(
    (element) => element.properties.gtfs_stop_id === gtfs_station_id
  );

  const selectedData: StationDetails = {
    gtfs_station_id: stationData?.properties.gtfs_stop_id || "0",
    name: stationData?.properties.stop_name || "Invalid station",
    northDirectionLabel:
      stationData?.properties.north_direction_label || "North",
    southDirectionLabel:
      stationData?.properties.south_direction_label || "South",
  };

  return selectedData;
};
