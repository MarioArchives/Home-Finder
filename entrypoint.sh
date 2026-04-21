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
# and schedule catch-up jobs to run IN THE BACKGROUND after the server
# starts. This way the UI is available immediately on existing data while
# stale data refreshes behind the scenes.
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

    # Reinstall cron jobs immediately — the crontab is ephemeral (lives in the
    # container, not the data volume), so it's lost on every `docker compose up`.
    echo "[entrypoint] Reinstalling cron jobs..."
    python3 -c "
import json, sys
sys.path.insert(0, '/app/src')
from server_lib.setup import install_cron
from server_lib.config import get_listings_file, get_amenities_file
c = json.load(open('$CONFIG_FILE'))
install_cron(
    c['city'], c['listing_type'], c.get('source','rightmove'),
    c.get('pages',5),
    str(get_listings_file(c['city'], c['listing_type'])),
    str(get_amenities_file(c['city'], c['listing_type'])),
    c.get('amenities','climbing'),
)
print('[entrypoint] Cron jobs installed.')
" 2>&1 || echo "[entrypoint] Warning: failed to install cron jobs"

    # -----------------------------------------------------------------
    # Catch-up: run missed jobs IN THE BACKGROUND so the server starts
    # immediately. The UI serves existing (possibly stale) data; once
    # the catch-up finishes, symlinks are refreshed and the next page
    # load picks up the new data.
    # -----------------------------------------------------------------
    (
        file_age_hours() {
            local file="$1"
            if [ ! -f "$file" ]; then echo 99999; return; fi
            local mod_epoch now_epoch
            mod_epoch=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
            now_epoch=$(date +%s)
            echo $(( (now_epoch - mod_epoch) / 3600 ))
        }

        LISTINGS_AGE=$(file_age_hours "$LISTINGS_FILE")
        AMENITIES_AGE=$(file_age_hours "$AMENITIES_FILE")
        LAST_ALERT_FILE="$DATA_DIR/.last_alert_check"
        ALERT_AGE=$(file_age_hours "$LAST_ALERT_FILE")

        echo "[catchup] Listings age: ${LISTINGS_AGE}h, Amenities age: ${AMENITIES_AGE}h, Alert age: ${ALERT_AGE}h"

        # Re-scrape listings if older than 24 hours
        if [ "$LISTINGS_AGE" -ge 24 ]; then
            echo "[catchup] Listings are ${LISTINGS_AGE}h old (>24h), re-scraping..."
            python3 /app/src/scrape_listings.py \
                --city "$CITY" --type "$LISTING_TYPE" --pages "$PAGES" --source "$SOURCE" \
                --output "$LISTINGS_FILE" >> "$DATA_DIR/cron.log" 2>&1 \
                || echo "[catchup] Scrape exited with code $?"
            [ -f "$LISTINGS_FILE" ] && ln -sf "$LISTINGS_FILE" "$UI_DIR/listings.json"
        fi

        # Refresh amenities if older than 7 days
        if [ "$AMENITIES_AGE" -ge 168 ]; then
            echo "[catchup] Amenities are ${AMENITIES_AGE}h old (>7d), refreshing..."
            python3 /app/src/fetch_amenities.py --amenities "$AMENITIES" "$LISTINGS_FILE" \
                >> "$DATA_DIR/cron.log" 2>&1 || echo "[catchup] Amenities refresh failed"
            [ -f "$AMENITIES_FILE" ] && ln -sf "$AMENITIES_FILE" "$UI_DIR/amenities.json"
        fi

        # Run alert check if due
        if [ "$ALERT_AGE" -ge 24 ]; then
            echo "[catchup] Alert check is ${ALERT_AGE}h old (>24h), running..."
            cd /app
            CITY="$CITY" LISTING_TYPE="$LISTING_TYPE" SOURCE="$SOURCE" PAGES="$PAGES" \
            python3 -m alerts.check_new_listings >> "$DATA_DIR/cron.log" 2>&1 \
                || echo "[catchup] Alert check failed"
            touch "$LAST_ALERT_FILE"
        fi

        echo "[catchup] Done."
    ) &
    echo "[entrypoint] Catch-up running in background (pid $!)."
fi

# Start cron in background
cron 2>/dev/null || true

# -------------------------------------------------------------------------
# Serve the UI + data + alerts API on port 8080
# The setup wizard in the UI handles first-time scraping interactively.
# -------------------------------------------------------------------------
echo "[entrypoint] Serving UI on http://0.0.0.0:8080"
DATA_DIR="$DATA_DIR" python3 /app/server.py 8080 "$UI_DIR"
