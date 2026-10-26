#!/usr/bin/env python3
"""
Convert GTFS routes.txt and stops.txt files to JSON format.

This script reads the GTFS static data files for LIRR and Metro-North
and converts them to JSON format that can be easily imported in JavaScript/TypeScript.
"""

import csv
import json
import os
from pathlib import Path


def csv_to_dict_list(csv_file_path):
    """
    Convert a CSV file to a list of dictionaries.

    Args:
        csv_file_path: Path to the CSV file

    Returns:
        List of dictionaries where each dict represents a row
    """
    result = []

    with open(csv_file_path, 'r', encoding='utf-8') as csvfile:
        # Try different delimiters
        sample = csvfile.read(1024)
        csvfile.seek(0)

        # Detect delimiter (comma or quote-comma)
        if '","' in sample:
            reader = csv.DictReader(csvfile, quotechar='"')
        else:
            reader = csv.DictReader(csvfile)

        for row in reader:
            # Clean up the keys (remove quotes if present)
            cleaned_row = {k.strip('"'): v.strip('"') if isinstance(v, str) else v
                          for k, v in row.items()}
            result.append(cleaned_row)

    return result


def convert_railroad_data(railroad_name, base_path):
    """
    Convert routes and stops data for a specific railroad.

    Args:
        railroad_name: Name of the railroad (e.g., 'lirr', 'mtn')
        base_path: Base path to the railroad directory

    Returns:
        Dictionary with routes and stops data indexed by ID
    """
    railroad_path = base_path / railroad_name

    data = {
        'railroad': railroad_name,
        'routes': {},
        'stops': {}
    }

    # Convert routes.txt
    routes_file = railroad_path / 'routes.txt'
    if routes_file.exists():
        print(f"Converting {railroad_name}/routes.txt...")
        routes_list = csv_to_dict_list(routes_file)
        # Convert list to dict with route_id as key
        for route in routes_list:
            route_id = route.get('route_id')
            if route_id:
                # Remove route_id from the data since it's now the key
                route_data = {k: v for k, v in route.items() if k != 'route_id'}
                data['routes'][route_id] = route_data
        print(f"  Found {len(data['routes'])} routes")

    # Convert stops.txt
    stops_file = railroad_path / 'stops.txt'
    if stops_file.exists():
        print(f"Converting {railroad_name}/stops.txt...")
        stops_list = csv_to_dict_list(stops_file)
        # Convert list to dict with stop_id as key
        for stop in stops_list:
            stop_id = stop.get('stop_id')
            if stop_id:
                # Remove stop_id from the data since it's now the key
                stop_data = {k: v for k, v in stop.items() if k != 'stop_id'}
                data['stops'][stop_id] = stop_data
        print(f"  Found {len(data['stops'])} stops")

    return data


def create_stop_lookup(stops_data):
    """
    Create a lookup dictionary for stops by stop_id and stop_code.

    Since LIRR and Metro-North have overlapping stop IDs, we create
    separate by_id lookups for each railroad to avoid conflicts.

    Args:
        stops_data: List of all stops from all railroads

    Returns:
        Dictionary with separate lookups by railroad and by code
    """
    lookup = {
        'by_id_lirr': {},
        'by_id_mtn': {},
        'by_code': {}
    }

    for railroad_data in stops_data:
        railroad = railroad_data['railroad']
        # stops is now a dict with stop_id as keys
        for stop_id, stop in railroad_data['stops'].items():
            stop_with_railroad = {**stop, 'railroad': railroad, 'stop_id': stop_id}

            # Add to railroad-specific id lookup
            if railroad == 'lirr':
                lookup['by_id_lirr'][stop_id] = stop_with_railroad
            elif railroad == 'mtn':
                lookup['by_id_mtn'][stop_id] = stop_with_railroad

            # Add to code lookup
            if stop.get('stop_code'):
                lookup['by_code'][stop['stop_code']] = stop_with_railroad

    return lookup


def main():
    """Main conversion function."""
    # Get the script directory
    script_dir = Path(__file__).parent

    print("=" * 60)
    print("GTFS to JSON Converter")
    print("=" * 60)
    print()

    # Convert data for each railroad
    railroads = ['lirr', 'mtn']
    all_data = []

    for railroad in railroads:
        data = convert_railroad_data(railroad, script_dir)
        all_data.append(data)

    print()
    print("=" * 60)
    print("Writing JSON files...")
    print("=" * 60)
    print()

    # Write individual JSON files in each railroad's folder
    for data in all_data:
        railroad = data['railroad']
        railroad_dir = script_dir / railroad
        output_file = railroad_dir / f'{railroad}_routes_stops.json'

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        print(f"[OK] Written {railroad}/{railroad}_routes_stops.json")

    # Write combined JSON file in parent directory
    combined_file = script_dir / 'railroad_all_data.json'
    with open(combined_file, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, indent=2, ensure_ascii=False)

    print(f"[OK] Written railroad_all_data.json")

    # Create stop lookup file in parent directory
    stop_lookup = create_stop_lookup(all_data)
    lookup_file = script_dir / 'railroad_stops_lookup.json'

    with open(lookup_file, 'w', encoding='utf-8') as f:
        json.dump(stop_lookup, f, indent=2, ensure_ascii=False)

    print(f"[OK] Written railroad_stops_lookup.json")
    print(f"  - {len(stop_lookup['by_id_lirr'])} LIRR stops indexed by ID")
    print(f"  - {len(stop_lookup['by_id_mtn'])} Metro-North stops indexed by ID")
    print(f"  - {len(stop_lookup['by_code'])} stops indexed by code")

    print()
    print("=" * 60)
    print("Conversion complete!")
    print("=" * 60)
    print()
    print("Generated files:")
    print("  - lirr/lirr_routes_stops.json: LIRR routes and stops")
    print("  - mtn/mtn_routes_stops.json: Metro-North routes and stops")
    print("  - railroad_all_data.json: All railroad data combined")
    print("  - railroad_stops_lookup.json: Stop lookup by ID and code")
    print()


if __name__ == '__main__':
    main()
