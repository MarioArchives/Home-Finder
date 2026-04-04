# Property Listings Viewer

A self-contained property scraper and viewer that overcomes Rightmove/Zoopla's limited filtering. Scrapes listings, enriches them with nearby amenities, and serves a feature-rich UI with advanced filtering, analytics, and mapping.

## Quick Start (Docker)

```bash
# Build
docker build -t property-viewer .

# Run for Manchester rentals (default)
docker run -p 8080:8080 property-viewer

# Run for a different city
docker run -p 8080:8080 -e CITY="London" -e LISTING_TYPE="rent" -e PAGES=10 property-viewer

# With Telegram notifications for alerts
docker run -p 8080:8080 \
  -e TELEGRAM_BOT_TOKEN="your-bot-token" \
  -e TELEGRAM_CHAT_ID="your-chat-id" \
  -v property-data:/app/data \
  property-viewer
```

On startup the container:
1. Scrapes listings for the configured city
2. Fetches nearby amenities (bars, cafes, shops, climbing gyms)
3. Serves the UI at `http://localhost:8080`

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CITY` | `Manchester` | City to scrape |
| `LISTING_TYPE` | `rent` | `rent` or `buy` |
| `PAGES` | `42` | Max pages to scrape per source |
| `SOURCE` | `rightmove` | `rightmove`, `zoopla`, or `both` |
| `TELEGRAM_BOT_TOKEN` | | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | | Your Telegram chat ID |

## Alerts

The UI has an **Alerts** tab where you can define search criteria (max price, min bedrooms, council tax bands, property types, etc.). The app checks for new listings matching your alerts once per day at a random time and sends matches to Telegram.

## Scheduled Jobs

| Schedule | Task |
|---|---|
| Daily 6am | Re-scrape all listings |
| Daily (random time) | Check alerts for new listings |
| Weekly Sunday 7am | Refresh amenities data |

## Running Locally (without Docker)

```bash
# Install Python deps
pip install -r requirements.txt
playwright install chromium

# Scrape listings
python scrape_listings.py --city Manchester --type rent --pages 5 --output listings.json

# Fetch amenities
python fetch_amenities.py listings.json amenities.json

# Build and serve UI
cd ui && npm install && npm run build && cd ..
cp listings.json amenities.json ui/dist/
DATA_DIR=. python server.py 8080 ui/dist
```

## UI Features

- **Grid view** with property cards, value ratings, and amenity badges
- **Map view** with interactive markers
- **Analytics** dashboard with 12+ charts (drill down to filter)
- **Advanced filtering**: price, beds, baths, property type, furnishing, council tax, sq ft, availability dates, distance from a pin
- **Alerts**: configurable criteria with daily Telegram notifications
