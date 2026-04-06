# =============================================================================
# Stage 1: Build the React UI
# =============================================================================
FROM node:22-slim AS ui-build

WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --ignore-scripts
COPY ui/ ./
# Replace broken symlinks with placeholder JSON for the Vite build.
# At runtime the entrypoint symlinks real data into dist/.
RUN rm -f public/listings.json public/amenities.json && echo '[]' > public/listings.json && echo '{}' > public/amenities.json
RUN npm run build

# =============================================================================
# Stage 2: Runtime — Python + built UI served by a lightweight server
# =============================================================================
FROM python:3.13-slim

# Install cron and curl first, then Python deps + Playwright with all its system deps
RUN apt-get update && apt-get install -y --no-install-recommends cron curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps + Playwright Chromium + its system dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install --with-deps chromium

# Copy Python scripts
COPY scrape_listings.py check_new_listings.py fetch_amenities.py server.py format_notify.py alert_filter.py update_chats.py ./

# Copy clean seed data for Docker (personal alerts.json / chat_ids.json stay local)
COPY alerts.seed.json /app/alerts.json
COPY chat_ids.seed.json /app/chat_ids.json

# Copy built UI
COPY --from=ui-build /app/ui/dist /app/ui/dist

# Copy entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Data volume — listings JSON, amenities, seen_listings persist here
VOLUME /app/data

# UI served on port 8080
EXPOSE 8080

ENV CITY="Manchester"
ENV LISTING_TYPE="rent"
ENV PAGES="42"
ENV SOURCE="rightmove"
ENV DATA_DIR="/app/data"
# Notifications (optional — see .env.example)
ENV NOTIFY_METHOD="telegram"
ENV TELEGRAM_BOT_TOKEN=""
ENV TELEGRAM_CHAT_ID=""
ENV SMTP_SERVER="smtp.gmail.com"
ENV SMTP_PORT="587"
ENV EMAIL_ADDRESS=""
ENV EMAIL_PASSWORD=""
ENV EMAIL_TO=""

ENTRYPOINT ["/app/entrypoint.sh"]
