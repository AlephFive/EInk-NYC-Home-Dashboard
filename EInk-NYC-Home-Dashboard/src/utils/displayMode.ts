/**
 * Display mode utilities for 2-bit black and white display
 * All colors are converted to pure black (#000000) or pure white (#FFFFFF)
 */

const isBlackAndWhite = import.meta.env.VITE_DISPLAY_MODE === "bw";

/**
 * Converts any color to pure black or pure white based on luminance
 * @param hexColor - Color in hex format (e.g., "#FF5733" or "FF5733")
 * @returns Pure black (#000000) or pure white (#FFFFFF)
 */
function hexToBlackOrWhite(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace("#", "");

  // Parse RGB values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate luminance (perceived brightness)
  // Using standard luminance formula: 0.299R + 0.587G + 0.114B
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

  // If luminance is above middle gray (128), use white; otherwise use black
  return luminance > 128 ? "#FFFFFF" : "#000000";
}

/**
 * Returns the appropriate color based on display mode
 * @param color - Original color in hex format
 * @returns Pure black or white if BW mode, original if color mode
 */
export function getDisplayColor(color: string): string {
  if (!isBlackAndWhite) {
    return color.startsWith("#") ? color : `#${color}`;
  }

  return hexToBlackOrWhite(color);
}

/**
 * Returns the appropriate background color based on display mode
 */
export function getDisplayBackgroundColor(color: string): string {
  if (!isBlackAndWhite) {
    return color;
  }

  return hexToBlackOrWhite(color);
}

/**
 * Check if display is in black and white mode
 */
export function isDisplayBlackAndWhite(): boolean {
  return isBlackAndWhite;
}
