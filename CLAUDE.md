# Property Listings Viewer

## Overview

Self-contained property scraper + viewer for UK rental/sale listings with a pluggable provider system (Rightmove, Zoopla, and extensible to others). Enriches listings with nearby amenities via OpenStreetMap Overpass API, serves a React UI with advanced filtering, analytics, mapping, and Telegram alerts.

## Architecture

```
Python backend (server.py:8080)
  ├── Scraping pipeline: scrape_listings.py → fetch_amenities.py
  ├── Alert system: check_new_listings.py → alert_filter.py → format_notify.py → Telegram
  ├── REST API: /api/setup, /api/alerts, /api/telegram/*
  └── Static file server for React SPA

React frontend (ui/)
  ├── Grid / Map / Analytics / Alerts views
  ├── Client-side filtering + sorting (all in App.tsx)
  ├── Amenity badges per property (NearbyBadges)
  └── Leaflet maps for pin selection + property mapping
```

## Key Files

| File | Purpose |
|---|---|
| `server.py` | HTTP server, API endpoints, setup orchestration, cron install |
| `scrape_listings.py` | Main scraper entry point, browser setup, CLI |
| `providers/base.py` | `ListingProvider` base class with shared scrape loop |
| `providers/rightmove.py` | Rightmove provider implementation |
| `providers/zoopla.py` | Zoopla provider implementation |
| `providers/__init__.py` | Provider registry (`PROVIDERS` dict, `get_provider()`) |
| `fetch_amenities.py` | Overpass API queries for nearby amenities |
| `alert_filter.py` | Alert matching logic (haversine, price, beds, etc.) |
| `check_new_listings.py` | Daily alert checker |
| `format_notify.py` | Telegram message formatting |
| `ui/src/components/App/App.tsx` | Main React component, filtering, sorting, routing |
| `ui/src/shared/utils/utils.ts` | Client-side Overpass fallback, haversine, parsing |
| `ui/src/types/listing.d.ts` | TypeScript interfaces for all data types |
| `ui/src/components/NearbyBadges/` | Amenity badge display per property card |
| `ui/src/components/SetupWizard/` | First-time setup UI (city, source, pages, amenities) |

## Data Flow

1. `scrape_listings.py` → `{city}_{type}_listings.json` (property data with coords)
2. `fetch_amenities.py` → `{city}_{type}_amenities.json` (per-property amenity counts)
3. `server.py` symlinks both to `ui/dist/` as `listings.json` and `amenities.json`
4. React app loads both JSON files, renders with client-side filtering/sorting

## Amenities System

Amenities are fetched via the Overpass (OpenStreetMap) API. Configurable types:
- **Always included**: bars/pubs, cafes, supermarkets/shops (counted within 1km radius)
- **Optional "closest" amenities**: climbing gyms, cinemas, gyms/fitness, parks (finds nearest, no distance limit)

Backend: `fetch_amenities.py --amenities climbing,cinema,gym,parks`
Frontend fallback: `utils.ts:fetchNearbyAmenities()` queries Overpass directly if server data unavailable.

## Commute / Work Pin

Users can set a "work location" pin. Each property then shows straight-line distance and optionally driving time via the OSRM public API (`router.project-osrm.org`). Stored in localStorage for persistence.

## Docker

Multi-stage build: Node (UI build) → Python 3.13 (runtime with Playwright + cron). Single service on port 8080 with a data volume for persistence.

## Development

```bash
# Frontend dev
cd ui && npm install && npm run dev

# Backend
pip install -r requirements.txt
python server.py 8080 ui/dist

# Scrape + amenities
python scrape_listings.py --city Manchester --type rent --pages 5 --source all
python scrape_listings.py --city Manchester --type rent --source rightmove
python fetch_amenities.py manchester_rent_listings.json --amenities climbing,cinema
```
