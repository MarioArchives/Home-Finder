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
    # Catch-up: delegate to the run_stage recovery sweep. Runs in the
    # background so the server starts immediately; the sweep walks
    # scrape → amenities → alerts in order, only running stages whose
    # marker file is missing or stale. Same logic as the hourly cron
    # recovery sweep, so there's one code path to debug.
    # -----------------------------------------------------------------
    (
        cd /app
        echo "[catchup] Running run_stage --recover..."
        CITY="$CITY" LISTING_TYPE="$LISTING_TYPE" SOURCE="$SOURCE" \
        PAGES="$PAGES" AMENITIES="$AMENITIES" PYTHONPATH="/app/src" \
            python3 -m cron.run_stage --recover >> "$DATA_DIR/cron.log" 2>&1 \
            || echo "[catchup] run_stage exited with code $?"
        # Refresh symlinks in case files were just created.
        [ -f "$LISTINGS_FILE" ] && ln -sf "$LISTINGS_FILE" "$UI_DIR/listings.json"
        [ -f "$AMENITIES_FILE" ] && ln -sf "$AMENITIES_FILE" "$UI_DIR/amenities.json"
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
