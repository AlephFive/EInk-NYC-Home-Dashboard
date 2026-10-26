import subwayColors from "../../staticData/subway/subway_colors.json";

interface SubwayLineColor {
  color: string;
  text_color: string;
}

// Build route color lookup
const lineColors = subwayColors as Record<string, SubwayLineColor>;

/**
 * Get color for a subway line
 * @param routeId - The route/line ID (e.g., "7", "A", "N")
 * @returns Color as hex string (e.g., "#9A38A1") or default purple
 */
export function getSubwayLineColor(routeId: string): string {
  return lineColors[routeId]?.color || "#b933ad"; // Default to purple
}

/**
 * Get text color for a subway line
 * @param routeId - The route/line ID (e.g., "7", "A", "N")
 * @returns Text color as hex string (e.g., "#FFFFFF")
 */
export function getSubwayLineTextColor(routeId: string): string {
  return lineColors[routeId]?.text_color || "#FFFFFF";
}

/**
 * Get both colors for a subway line
 * @param routeId - The route/line ID
 * @returns Object with color and text_color
 */
export function getSubwayLineColors(routeId: string): SubwayLineColor {
  return lineColors[routeId] || {
    color: "#b933ad",
    text_color: "#FFFFFF"
  };
}
