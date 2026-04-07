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
    SOURCE=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('source','rightmove'))")
    PAGES=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('pages',5))")
    AMENITIES=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('amenities','climbing'))")
    SLUG=$(echo "$CITY" | tr '[:upper:]' '[:lower:]' | tr ' ' '_')
    LISTINGS_FILE="$DATA_DIR/${SLUG}_${LISTING_TYPE}_listings.json"
    AMENITIES_FILE="$DATA_DIR/${SLUG}_${LISTING_TYPE}_amenities.json"

    [ -f "$LISTINGS_FILE" ] && ln -sf "$LISTINGS_FILE" "$UI_DIR/listings.json"
    [ -f "$AMENITIES_FILE" ] && ln -sf "$AMENITIES_FILE" "$UI_DIR/amenities.json"

    echo "[entrypoint] Found existing data for $CITY ($LISTING_TYPE)."

    # ---------------------------------------------------------------------
    # Catch-up: run any jobs that were missed while the container was off
    # ---------------------------------------------------------------------
    file_age_hours() {
        local file="$1"
        if [ ! -f "$file" ]; then
            echo 99999
            return
        fi
        local mod_epoch
        mod_epoch=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
        local now_epoch
        now_epoch=$(date +%s)
        echo $(( (now_epoch - mod_epoch) / 3600 ))
    }

    LISTINGS_AGE=$(file_age_hours "$LISTINGS_FILE")
    AMENITIES_AGE=$(file_age_hours "$AMENITIES_FILE")

    echo "[catchup] Listings age: ${LISTINGS_AGE}h, Amenities age: ${AMENITIES_AGE}h"

    # Re-scrape listings if older than 24 hours
    if [ "$LISTINGS_AGE" -ge 24 ]; then
        echo "[catchup] Listings are ${LISTINGS_AGE}h old (>24h), re-scraping..."
        python3 /app/src/scrape_listings.py \
            --city "$CITY" --type "$LISTING_TYPE" --pages "$PAGES" --source "$SOURCE" \
            --output "$LISTINGS_FILE" >> "$DATA_DIR/cron.log" 2>&1 &
        SCRAPE_PID=$!
    fi

    # Check alerts if the last check was more than 24 hours ago
    LAST_ALERT_FILE="$DATA_DIR/.last_alert_check"
    ALERT_AGE=$(file_age_hours "$LAST_ALERT_FILE")
    if [ "$ALERT_AGE" -ge 24 ]; then
        echo "[catchup] Alert check is ${ALERT_AGE}h old (>24h), will run after scrape..."
        RUN_ALERTS=1
    fi

    # Wait for scrape to finish before running dependent jobs
    if [ -n "$SCRAPE_PID" ]; then
        echo "[catchup] Waiting for scrape to finish (pid $SCRAPE_PID)..."
        wait "$SCRAPE_PID" || echo "[catchup] Scrape exited with code $?"
        # Re-symlink in case it was a fresh file
        [ -f "$LISTINGS_FILE" ] && ln -sf "$LISTINGS_FILE" "$UI_DIR/listings.json"
    fi

    # Refresh amenities if older than 7 days (weekly schedule)
    if [ "$AMENITIES_AGE" -ge 168 ]; then
        echo "[catchup] Amenities are ${AMENITIES_AGE}h old (>7d), refreshing..."
        python3 /app/src/fetch_amenities.py --amenities "$AMENITIES" "$LISTINGS_FILE" \
            >> "$DATA_DIR/cron.log" 2>&1 || echo "[catchup] Amenities refresh failed"
        [ -f "$AMENITIES_FILE" ] && ln -sf "$AMENITIES_FILE" "$UI_DIR/amenities.json"
    fi

    # Run alert check if due
    if [ "${RUN_ALERTS:-0}" = "1" ]; then
        echo "[catchup] Running missed alert check..."
        (
            cd /app
            CITY="$CITY" LISTING_TYPE="$LISTING_TYPE" SOURCE="$SOURCE" PAGES="$PAGES" \
            python3 -m alerts.check_new_listings >> "$DATA_DIR/cron.log" 2>&1
            touch "$LAST_ALERT_FILE"
        ) &
        echo "[catchup] Alert check started in background."
    fi

    echo "[catchup] Done."
fi

# Start cron in background (cron jobs are installed by the server after setup)
cron 2>/dev/null || true

# -------------------------------------------------------------------------
# Serve the UI + data + alerts API on port 8080
# The setup wizard in the UI handles first-time scraping interactively.
# -------------------------------------------------------------------------
echo "[entrypoint] Serving UI on http://0.0.0.0:8080"
DATA_DIR="$DATA_DIR" python3 /app/server.py 8080 "$UI_DIR"
