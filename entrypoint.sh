#!/bin/bash
set -e

DATA_DIR="/app/data"
UI_DIR="/app/ui/dist"
CITY="${CITY:-Manchester}"
LISTING_TYPE="${LISTING_TYPE:-rent}"
PAGES="${PAGES:-42}"
SOURCE="${SOURCE:-rightmove}"

SLUG=$(echo "$CITY" | tr '[:upper:]' '[:lower:]' | tr ' ' '_')
LISTINGS_FILE="$DATA_DIR/${SLUG}_${LISTING_TYPE}_listings.json"
AMENITIES_FILE="$DATA_DIR/${SLUG}_${LISTING_TYPE}_amenities.json"

mkdir -p "$DATA_DIR"

# Seed alerts and chat subscriptions into data volume if not already present
[ ! -f "$DATA_DIR/alerts.json" ] && [ -f /app/alerts.json ] && cp /app/alerts.json "$DATA_DIR/alerts.json"
[ ! -f "$DATA_DIR/chat_ids.json" ] && [ -f /app/chat_ids.json ] && cp /app/chat_ids.json "$DATA_DIR/chat_ids.json"

# -------------------------------------------------------------------------
# Initial scrape if no data exists
# -------------------------------------------------------------------------
if [ ! -f "$LISTINGS_FILE" ]; then
    echo "[entrypoint] No listings found — running initial scrape..."
    python3 /app/scrape_listings.py \
        --city "$CITY" \
        --type "$LISTING_TYPE" \
        --pages "$PAGES" \
        --source "$SOURCE" \
        --output "$LISTINGS_FILE"
    echo "[entrypoint] Initial scrape complete."
fi

# Fetch amenities if not cached
if [ ! -f "$AMENITIES_FILE" ] && [ -f "$LISTINGS_FILE" ]; then
    echo "[entrypoint] Fetching amenities..."
    python3 /app/fetch_amenities.py "$LISTINGS_FILE" "$AMENITIES_FILE" || true
    echo "[entrypoint] Amenities fetch complete."
fi

# -------------------------------------------------------------------------
# Symlink data into the UI public directory so the server can serve them
# -------------------------------------------------------------------------
ln -sf "$LISTINGS_FILE" "$UI_DIR/listings.json"
[ -f "$AMENITIES_FILE" ] && ln -sf "$AMENITIES_FILE" "$UI_DIR/amenities.json"

# -------------------------------------------------------------------------
# Daily update cron job with random time for alert checks
# -------------------------------------------------------------------------
CRON_LOG="/app/data/cron.log"

# Generate a random hour (6-22) and minute for daily alert checks
RAND_HOUR=$(( RANDOM % 17 + 6 ))
RAND_MIN=$(( RANDOM % 60 ))

# Write all relevant env vars to a file that cron jobs will source
ENV_FILE="/app/data/.env.cron"
printenv | grep -E '^(CITY|LISTING_TYPE|PAGES|SOURCE|TELEGRAM_|DATA_DIR|NOTIFY_METHOD|SMTP_|EMAIL_)' > "$ENV_FILE"

cat > /etc/cron.d/property-update << EOF
# Re-scrape listings daily at 6am
0 6 * * * cd /app && . $ENV_FILE && python3 /app/scrape_listings.py --city "\$CITY" --type "\$LISTING_TYPE" --pages "\$PAGES" --source "\$SOURCE" --output "$LISTINGS_FILE" >> "$CRON_LOG" 2>&1

# Check alerts for new listings at a random daily time ($RAND_HOUR:$(printf '%02d' $RAND_MIN))
$RAND_MIN $RAND_HOUR * * * cd /app && . $ENV_FILE && python3 /app/check_new_listings.py >> "$CRON_LOG" 2>&1

# Refresh amenities weekly on Sunday at 7am
0 7 * * 0 cd /app && . $ENV_FILE && python3 /app/fetch_amenities.py "$LISTINGS_FILE" "$AMENITIES_FILE" >> "$CRON_LOG" 2>&1

EOF

chmod 0644 /etc/cron.d/property-update
crontab /etc/cron.d/property-update

echo "[entrypoint] Cron jobs installed (alert check at $RAND_HOUR:$(printf '%02d' $RAND_MIN)):"
crontab -l

# Start cron in background
cron

# -------------------------------------------------------------------------
# Serve the UI + data + alerts API on port 8080
# -------------------------------------------------------------------------
echo "[entrypoint] Serving UI on http://0.0.0.0:8080"
DATA_DIR="$DATA_DIR" python3 /app/server.py 8080 "$UI_DIR"
