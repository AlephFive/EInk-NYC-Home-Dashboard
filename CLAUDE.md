# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an E-Ink display dashboard for NYC transit information, supporting subway, railroad (LIRR/Metro-North), bus, and ferry data. The project is built with React, Vite, and TypeScript, and fetches real-time transit data from MTA APIs.

## Development Commands

```bash
# Development server
cd EInk-NYC-Home-Dashboard
npm run dev

# Build (includes TypeScript compilation and protobuf generation)
npm run build

# Lint
npm run lint

# Preview production build
npm run preview

# Generate protobuf TypeScript files (runs automatically during build)
npm run gen:proto
```

## Architecture

### Data Flow Pattern

All transit types follow a consistent architecture:

1. **Configuration** (`displayConfig.ts`): Defines which stops to display using a 2D grid layout
2. **API Fetching** (`utils/{transitType}/fetchTrainData.ts` or `fetchBusData.ts`): Fetches and decodes data
3. **Data Processing** (`utils/{transitType}/index.ts`): Filters and enriches data for display
4. **Rendering** (`App.tsx` → `TransitCard.tsx`): Displays data in a card-based layout

### Transit Type Modules

Each transit type is isolated in `src/utils/{transitType}/`:

- **Subway** (`utils/subway/`):
  - Uses GTFS-realtime protobuf feeds (multiple feeds per line group)
  - `fetchMultipleTrainLines()` batches API calls by feed to minimize requests
  - Filters by direction (N/S) and stop ID
  - Station lookups in `stations.ts`, colors in `subwayColors.ts`

- **Railroad** (`utils/railroad/`):
  - Supports both LIRR and Metro-North
  - `fetchMultipleRailroads()` merges feeds from multiple railroads
  - Each `EnrichedStopTimeUpdate` includes a `railroad` field ("lirr" or "mtn")
  - Route colors and names in `routeLookup.ts`

- **Bus** (`utils/bus/`):
  - Uses SIRI API (JSON-based, not protobuf)
  - Requires `VITE_MTA_API_KEY` environment variable
  - Route metadata in `displayDataLookup.ts`

- **Ferry** (`utils/ferry/`):
  - Schedule-based (no API calls)
  - Static timetables in `getFerrySchedule.ts`
  - Direction-aware (uptown/downtown)

### Protobuf Setup

GTFS-realtime data uses Protocol Buffers:

- **Proto definitions**: `src/protocol/proto/*.proto`
  - `gtfs-realtime.proto`: Base GTFS-RT spec
  - `gtfs-realtime-NYCT.proto`: Subway extensions
  - `gtfs-realtime-MTARR.proto`: Railroad extensions

- **Generated code**: `src/protocol/proto/generated/` (auto-generated, do not edit manually)

- **Generation command**: `npm run gen:proto`
  - Uses `ts-proto` to generate TypeScript from `.proto` files
  - Runs automatically during `npm run build`

### Display Configuration

The `displayConfig.ts` file uses a nested array structure:

```typescript
rowDisplay: [
  [card1, card2],  // Row 1
  [card3],         // Row 2
]
```

Each card specifies:
- `transitType`: "subway" | "railroad-lirr" | "railroad-mtn" | "bus" | "ferry"
- `stopId`: Station/stop identifier
- `lines`: (optional) Filter specific routes
- `walkTime`: Display walk time to the stop
- `directionNames`: (optional) Custom labels for northbound/southbound

### API URLs and Mappings

Static data files contain API configuration:

- `src/staticData/subway/apis.json`: Maps subway lines to feed URLs
- `src/staticData/railroad/apis.json`: Railroad feed URLs
- `src/staticData/bus/apis.json`: Bus API endpoint

## Key Implementation Details

### Type Disambiguation

Both subway and railroad modules export `EnrichedStopTimeUpdate`, but they're different types. Import them with aliases:

```typescript
import { type EnrichedStopTimeUpdate as SubwayEnrichedStopTimeUpdate } from "./utils/subway";
import { type EnrichedStopTimeUpdate as RailroadEnrichedStopTimeUpdate } from "./utils/railroad";
```

Railroad's version adds a `railroad` field to distinguish LIRR from Metro-North.

### Batching Strategy

- **Subway**: Multiple lines may share the same feed. `fetchMultipleTrainLines()` deduplicates feeds to minimize API calls.
- **Railroad**: `fetchMultipleRailroads()` fetches LIRR and Metro-North in parallel, then merges entities.

### Bus Stop ID Lookup

To find bus stop IDs, use the NY Open Data portal:
https://data.ny.gov/Transportation/MTA-Bus-Stops/2ucp-7wg5/

Filter by route name to find stop IDs for specific routes.

### Vite Configuration

The project uses:
- React Compiler plugin (`babel-plugin-react-compiler`)
- Custom GeoJSON loader plugin for `.geojson` files
- ESM module type

## Environment Variables

```bash
# Required for bus data
VITE_MTA_API_KEY=your_api_key_here
```

Get an API key from: https://api.mta.info/
