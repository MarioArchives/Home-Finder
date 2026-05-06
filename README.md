# Home Finder

A self-contained property scraper and viewer that overcomes Rightmove/Zoopla's limited filtering. Scrapes listings from Rightmove, OpenRent and/or Zoopla, merges cross-site duplicates, enriches them with nearby amenities from OpenStreetMap, and serves a feature-rich UI with advanced filtering, analytics, mapping, and Telegram alerts.
### Light and Dark mode support

<table>
  <tr>
    <td><img width="1805" height="983" alt="Screenshot From 2026-05-06 15-38-22" src="https://github.com/user-attachments/assets/d8103976-388d-4f03-8b71-c88f8df10a6e" /></td>
    <td><img width="1805" height="983" alt="Screenshot From 2026-05-06 15-38-09" src="https://github.com/user-attachments/assets/7dae350d-94bc-4547-9cf4-97696049b758" /></td>
  </tr>
</table>

### Advanced Search support

<div align="center">
  <img width="700" alt="Screenshot From 2026-05-06 15-40-23" src="https://github.com/user-attachments/assets/c23be5c4-8204-40ab-8bb4-dffa2e1a9d20" />
</div>

### Extensive Data Analysis out of the box

<div align="center">
  <img width="700" alt="image" src="https://github.com/user-attachments/assets/e6a9595b-6eb8-4019-abd2-03712d879ca7" />
</div>

### Customisable Telegram alerts

<div align="center">
  <img width="700" alt="image" src="https://github.com/user-attachments/assets/d6c5ba2d-53d1-4474-bc52-2695644c3497" />
</div>

## Quick Start (Docker)

```bash
# Build
docker build -t property-viewer .

# Run (recommended: mount a volume so your data persists across rebuilds)
docker run -p 8080:8080 -v property-data:/app/data property-viewer
```

Then open **http://localhost:8080** — a **guided setup wizard** takes over from there.

### First run — the setup wizard

On first launch the UI walks you through:

1. **Search settings** — city, rent/buy, which site(s) to scrape (Rightmove, Zoopla, or both), and pages per source.
2. **Scraping progress** — a live view of per-source pages and listings as the scraper works. When you pick both sources, they scrape in parallel.
3. **Amenity preferences** — which optional nearby amenities to look up (climbing gyms, cinemas, gyms, parks), and an optional location pin to track commute distance per property.
4. **Connect Telegram** (optional) — a dedicated step to hook up a Telegram bot for new-listing alerts. Has a **Skip for now** button; you can configure it later from the UI.

All of this is persisted to `/app/data` so subsequent container starts skip the wizard and go straight to the property browser.

### Subsequent runs

The container starts fast and:

- symlinks your existing listings and amenities data into the served UI,
- runs a **catch-up** if any scheduled job (scrape / alerts / amenities) was missed while the container was off,
- starts the cron daemon for the ongoing daily/weekly schedule (see below).

## How it works

1. **Scrape** — Playwright + Chromium scrapes Rightmove and/or Zoopla. When both are selected they run concurrently, roughly halving wall-clock time. Zoopla's Cloudflare challenges detail pages after a search session, so each detail page is fetched in a fresh browser context to slip past the fingerprint check.
2. **Dedup** — the same property often appears on both sites. A composite key of `(normalised description, bedrooms, monthly price)` merges duplicates; the richer listing wins and the companion URL is kept on an `alt_urls` field.
3. **Enrich** — for each property with coordinates, OpenStreetMap's Overpass API returns counts of nearby bars/cafes/shops within 1km plus the closest climbing gym, cinema, gym, or park.

## Scheduled Jobs

| Schedule | Task |
|---|---|
| Daily 6am | Re-scrape all listings |
| Daily (random time) | Check alerts for new listings, send Telegram notifications |
| Weekly Sunday 7am | Refresh amenities data |

If the container was off when a job was due, the entrypoint runs a **catch-up** for any job whose last run is older than its normal interval.

You can query the next scheduled run time at any moment by sending `/status` to your Telegram bot or by calling `GET /api/cron/status` directly.

## Alerts

The UI has an **Alerts** tab where you define criteria (max price, min bedrooms, council tax bands, property types, pin radius, etc.). The daily alert job sends matches to Telegram as a **photo + caption** (property image + key fields + link), falling back to plain text when an image isn't available.

## Telegram Bot Commands

Once your bot is connected (via the setup wizard), the server runs a long-poll listener that responds to commands sent to the bot. Only chat IDs already registered in `chat_ids.json` get a reply — unknown senders are ignored.

| Command | Reply |
|---|---|
| `/status` | Current job state (idle vs scraping/alerts/amenities running, with per-source progress %) plus the next scheduled run time for each cron job and the timestamp of the last completed scrape. |
| `/scrape` | Triggers the full pipeline on demand — scrape → amenities → alerts — using your saved config. Replies with a confirmation, or a busy notice if a stage is already in flight. Track progress with `/status`. |

The listener uses `getUpdates` long-polling against the Telegram Bot API; no inbound webhook setup is required. Update offsets persist in `data/telegram_offset.txt` so restarts don't replay old messages.

## Environment Variables

Most users configure the app via the UI wizard. These env vars mainly pre-seed the wizard's defaults or let cron pick up settings when the container restarts.

| Variable | Default | Description |
|---|---|---|
| `CITY` | `Manchester` | Pre-fills the wizard's city field |
| `LISTING_TYPE` | `rent` | `rent` or `buy` |
| `PAGES` | `1` | Max pages to scrape per source |
| `SOURCE` | `rightmove` | `rightmove`, `zoopla`, or `both` |
| `TELEGRAM_BOT_TOKEN` | | Can be set via the wizard instead |
| `TELEGRAM_CHAT_ID` | | Can be set via the wizard instead |

```bash
# Example: pre-seed defaults for the wizard
docker run -p 8080:8080 \
  -e CITY="London" -e LISTING_TYPE="rent" -e SOURCE="both" -e PAGES=10 \
  -v property-data:/app/data \
  property-viewer
```

## Running Locally (without Docker)

```bash
# Install Python deps
pip install -r requirements.txt
playwright install chromium

# Scrape a single source
python src/scrape_listings.py --city Manchester --type rent --source rightmove --pages 5

# Scrape both sources concurrently (with cross-site dedup)
python src/scrape_listings.py --city Manchester --type rent --source both --pages 5

# Fetch amenities (bars/cafes/shops always included; --amenities adds "closest X" lookups)
python src/fetch_amenities.py manchester_rent_listings.json --amenities climbing,cinema,gym,parks

# Build and serve UI
cd ui && npm install && npm run build && cd ..
DATA_DIR=. PYTHONPATH=src python server.py 8080 ui/dist
```

## UI Features

- **Grid view** with property cards, value ratings, and amenity badges
- **Map view** with interactive markers
- **Analytics** dashboard with 12+ charts (drill down to filter)
- **Advanced filtering**: price, beds, baths, property type, furnishing, council tax, sq ft, availability dates, distance from a pin
- **Alerts**: configurable criteria with daily Telegram photo notifications
- **Custom pins**: drop multiple named locations (work, gym, family) and see distances per property
