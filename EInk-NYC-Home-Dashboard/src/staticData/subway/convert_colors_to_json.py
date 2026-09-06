#!/usr/bin/env python3
"""
Convert MTA subway colors CSV to JSON format.

Reads MTA_Colors_20251126.csv and creates a JSON file with line colors,
filtered to only include New York City Subway lines.
"""

import csv
import json
from pathlib import Path


def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def calculate_text_color(bg_hex):
    """
    Calculate appropriate text color (black or white) based on background color.
    Uses the W3C contrast formula.
    """
    r, g, b = hex_to_rgb(bg_hex)

    # Calculate relative luminance
    luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

    # Use white text for dark backgrounds, black for light backgrounds
    return "#FFFFFF" if luminance < 0.5 else "#000000"


def main():
    """Convert CSV to JSON."""
    script_dir = Path(__file__).parent
    csv_file = script_dir / "MTA_Colors_20251126.csv"
    json_file = script_dir / "subway_colors.json"

    print("=" * 60)
    print("MTA Subway Colors CSV to JSON Converter")
    print("=" * 60)
    print()

    # Read the CSV file
    line_colors = {}

    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        for row in reader:
            operator = row['Operator']

            # Only process New York City Subway rows
            if operator != "New York City Subway":
                continue

            service = row['Service']
            hex_color = row['Hex color']

            # Calculate text color
            text_color = calculate_text_color(hex_color)

            # Split service into individual lines (e.g., "A,C,E" -> ["A", "C", "E"])
            lines = [line.strip() for line in service.split(',')]

            # Add color data for each line
            for line in lines:
                line_colors[line] = {
                    "color": hex_color,
                    "text_color": text_color
                }
                print(f"Added {line}: {hex_color} (text: {text_color})")

    # Add SR and SF shuttle services using the same color as S
    if "S" in line_colors:
        s_color_data = line_colors["S"]
        line_colors["SR"] = s_color_data.copy()
        line_colors["SF"] = s_color_data.copy()
        print(f"Added SR: {s_color_data['color']} (same as S shuttle)")
        print(f"Added SF: {s_color_data['color']} (same as S shuttle)")

    # Write the JSON file
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(line_colors, f, indent=2, ensure_ascii=False)

    print()
    print("=" * 60)
    print(f"Conversion complete!")
    print("=" * 60)
    print()
    print(f"Output: {json_file.name}")
    print(f"Total lines: {len(line_colors)}")
    print()


if __name__ == '__main__':
    main()
