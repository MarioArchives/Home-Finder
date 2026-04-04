# =============================================================================
# Stage 1: Build the React UI
# =============================================================================
FROM node:22-slim AS ui-build

WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --ignore-scripts
COPY ui/ ./
RUN npm run build

# =============================================================================
# Stage 2: Runtime — Python + built UI served by a lightweight server
# =============================================================================
FROM python:3.13-slim

# Install system dependencies for Playwright's Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    fonts-liberation cron curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium

# Copy Python scripts
COPY scrape_listings.py check_new_listings.py fetch_amenities.py server.py format_notify.py alert_filter.py update_chats.py ./

# Copy seed data (alerts & chat subscriptions)
COPY alerts.json chat_ids.json ./

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
