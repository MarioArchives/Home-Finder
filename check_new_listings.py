#!/usr/bin/env python3
"""
Daily listing checker — scrapes new listings, filters by alert criteria
loaded from alerts.json, and sends matches to Telegram.

Setup:
    1. Create a bot via @BotFather on Telegram, get the API token
    2. Message your bot, then get your chat_id from:
       https://api.telegram.org/bot<TOKEN>/getUpdates
    3. Set environment variables:
       export TELEGRAM_BOT_TOKEN="your-token"
       export TELEGRAM_CHAT_ID="your-chat-id"
"""

import json
import os
import smtplib
import urllib.request
import urllib.parse
from email.mime.text import MIMEText
from pathlib import Path

from scrape_listings import create_browser, scrape_rightmove, scrape_zoopla
from playwright.sync_api import sync_playwright
from alert_filter import matches_alert, parse_price, SHARE_KEYWORDS

# ── Scraper settings ─────────────────────────────────────────────────────────
CITY = os.environ.get("CITY", "Manchester")
LISTING_TYPE = os.environ.get("LISTING_TYPE", "rent")
SOURCE = os.environ.get("SOURCE", "both")
MAX_PAGES = int(os.environ.get("PAGES", "5"))
# ─────────────────────────────────────────────────────────────────────────────

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
SEEN_FILE = DATA_DIR / "seen_listings.json"
ALERTS_FILE = DATA_DIR / "alerts.json"
NOTIFY_METHOD = os.environ.get("NOTIFY_METHOD", "telegram")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
SMTP_SERVER = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
EMAIL_ADDRESS = os.environ.get("EMAIL_ADDRESS", "")
EMAIL_PASSWORD = os.environ.get("EMAIL_PASSWORD", "")
EMAIL_TO = os.environ.get("EMAIL_TO", "")

def load_seen() -> set[str]:
    if SEEN_FILE.exists():
        return set(json.loads(SEEN_FILE.read_text()))
    return set()


def save_seen(seen: set[str]):
    SEEN_FILE.write_text(json.dumps(sorted(seen), indent=2))


def load_alerts() -> list[dict]:
    if ALERTS_FILE.exists():
        try:
            return json.loads(ALERTS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            return []
    return []


def send_telegram(text: str):
    """Send a message via the Telegram Bot API."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[Telegram] Token or chat ID not set, skipping.")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()

    try:
        req = urllib.request.Request(url, data=data)
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[Telegram] Failed to send: {e}")


def send_email(subject: str, body: str):
    """Send an email via SMTP."""
    if not EMAIL_ADDRESS or not EMAIL_PASSWORD or not EMAIL_TO:
        print("[Email] Email settings not configured, skipping.")
        return

    msg = MIMEText(body, "html")
    msg["Subject"] = subject
    msg["From"] = EMAIL_ADDRESS
    msg["To"] = EMAIL_TO

    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        print(f"[Email] Failed to send: {e}")


def notify(text: str, subject: str = "Property Alert"):
    """Send notification via configured method(s)."""
    methods = NOTIFY_METHOD.lower()
    sent = False

    if methods in ("telegram", "both"):
        send_telegram(text)
        sent = True

    if methods in ("email", "both"):
        send_email(subject, text)
        sent = True

    if not sent:
        print(f"[Notify] No notification method configured, printing:")
        print(text)
        print()


def format_listing(listing: dict) -> str:
    """Format a listing for a Telegram message."""
    parts = []
    title = listing.get("title") or "Property"
    address = listing.get("address") or "Unknown location"
    parts.append(f"<b>{title}</b>")
    parts.append(f"📍 {address}")
    parts.append(f"💰 {listing.get('price', 'N/A')}")

    beds = listing.get("bedrooms")
    baths = listing.get("bathrooms")
    if beds or baths:
        room_info = []
        if beds:
            room_info.append(f"{beds} bed")
        if baths:
            room_info.append(f"{baths} bath")
        parts.append(f"🛏 {' / '.join(room_info)}")

    tax = listing.get("council_tax")
    if tax:
        parts.append(f"🏛 Council tax: {tax}")

    furnish = listing.get("furnish_type")
    if furnish:
        parts.append(f"🪑 {furnish}")

    url = listing.get("url")
    if url:
        parts.append(f"\n<a href=\"{url}\">View listing</a>")

    return "\n".join(parts)


def main():
    alerts = load_alerts()
    if not alerts:
        print("No alerts configured — nothing to check.")
        return

    print(f"Loaded {len(alerts)} alert(s).")

    seen = load_seen()
    print(f"Loaded {len(seen)} previously seen listings.")

    # Scrape
    all_listings = []
    with sync_playwright() as pw:
        browser, context = create_browser(pw)
        try:
            if SOURCE in ("rightmove", "both"):
                all_listings.extend(
                    scrape_rightmove(context, CITY, LISTING_TYPE, MAX_PAGES)
                )
            if SOURCE in ("zoopla", "both"):
                all_listings.extend(
                    scrape_zoopla(context, CITY, LISTING_TYPE, MAX_PAGES)
                )
        finally:
            context.close()
            browser.close()

    print(f"Scraped {len(all_listings)} total listings.")

    # Find new listings
    new_listings = [l for l in all_listings if l.get("url") and l["url"] not in seen]
    print(f"Found {len(new_listings)} new listings.")

    # Check each alert
    for alert in alerts:
        alert_name = alert.get("name", "Unnamed")
        matches = [l for l in new_listings if matches_alert(l, alert)]
        print(f"Alert '{alert_name}': {len(matches)} match(es).")

        if matches:
            notify(
                f"🏠 <b>{len(matches)} new listing(s) for \"{alert_name}\"!</b>",
                subject=f"{len(matches)} new listing(s) for \"{alert_name}\"",
            )
            for listing in matches:
                notify(format_listing(listing), subject=f"New listing: {listing.get('title', 'Property')}")

    # Update seen set with ALL listings (not just matches)
    for l in all_listings:
        if l.get("url"):
            seen.add(l["url"])
    save_seen(seen)
    print(f"Seen file updated ({len(seen)} total).")


if __name__ == "__main__":
    main()
