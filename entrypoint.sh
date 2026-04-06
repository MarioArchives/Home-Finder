#!/bin/bash
set -e

DATA_DIR="/app/data"
UI_DIR="/app/ui/dist"

mkdir -p "$DATA_DIR"

# Seed alerts and chat subscriptions into data volume if not already present
[ ! -f "$DATA_DIR/alerts.json" ] && [ -f /app/alerts.json ] && cp /app/alerts.json "$DATA_DIR/alerts.json"
[ ! -f "$DATA_DIR/chat_ids.json" ] && [ -f /app/chat_ids.json ] && cp /app/chat_ids.json "$DATA_DIR/chat_ids.json"

# -------------------------------------------------------------------------
# If data already exists from a previous run, symlink it for the server
# -------------------------------------------------------------------------
CONFIG_FILE="$DATA_DIR/config.json"
if [ -f "$CONFIG_FILE" ]; then
    CITY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['city'])")
    LISTING_TYPE=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['listing_type'])")
    SLUG=$(echo "$CITY" | tr '[:upper:]' '[:lower:]' | tr ' ' '_')
    LISTINGS_FILE="$DATA_DIR/${SLUG}_${LISTING_TYPE}_listings.json"
    AMENITIES_FILE="$DATA_DIR/${SLUG}_${LISTING_TYPE}_amenities.json"

    [ -f "$LISTINGS_FILE" ] && ln -sf "$LISTINGS_FILE" "$UI_DIR/listings.json"
    [ -f "$AMENITIES_FILE" ] && ln -sf "$AMENITIES_FILE" "$UI_DIR/amenities.json"

    echo "[entrypoint] Found existing data for $CITY ($LISTING_TYPE)."
fi

# Start cron in background (cron jobs are installed by the server after setup)
cron 2>/dev/null || true

# -------------------------------------------------------------------------
# Serve the UI + data + alerts API on port 8080
# The setup wizard in the UI handles first-time scraping interactively.
# -------------------------------------------------------------------------
echo "[entrypoint] Serving UI on http://0.0.0.0:8080"
DATA_DIR="$DATA_DIR" python3 /app/server.py 8080 "$UI_DIR"
