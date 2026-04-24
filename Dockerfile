# =============================================================================
# Stage 1: Build the React UI
# =============================================================================
FROM node:22-slim AS ui-build

WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts
COPY ui/ ./
# Replace broken symlinks with placeholder JSON for the Vite build.
# At runtime the entrypoint symlinks real data into dist/.
RUN rm -f public/listings.json public/amenities.json && echo '[]' > public/listings.json && echo '{"properties":{}}' > public/amenities.json
RUN npm run build

# =============================================================================
# Stage 2: Runtime — Python + built UI served by a lightweight server
# =============================================================================
FROM python:3.13-slim

# Install cron and curl first
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends cron curl

WORKDIR /app

# Install Python deps (cached separately from Playwright)
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Install Playwright Chromium + its system dependencies (heaviest layer, cached independently)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    playwright install --with-deps chromium

# Copy Python entry point and source
COPY server.py ./
COPY src/ ./src/

ENV PYTHONPATH="/app/src"

# Copy clean seed data for Docker (personal alerts.json / chat_ids.json stay local)
COPY data/alerts.seed.json /app/alerts.json
COPY data/chat_ids.seed.json /app/chat_ids.json

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
ENV PAGES="1"
ENV SOURCE="rightmove"
ENV DATA_DIR="/app/data"
# Notifications (optional — see .env.example)
ENV TELEGRAM_BOT_TOKEN=""
ENV TELEGRAM_CHAT_ID=""

ENTRYPOINT ["/app/entrypoint.sh"]
