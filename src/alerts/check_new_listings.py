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

from scrape_listings import create_browser, scrape_source
from playwright.sync_api import sync_playwright
from providers import get_all_provider_names
from alerts.alert_filter import matches_alert, parse_price, SHARE_KEYWORDS
from alerts.format_notify import load_amenities, format_alert_summary, format_listing

# ── Scraper settings ─────────────────────────────────────────────────────────
CITY = os.environ.get("CITY", "Manchester")
LISTING_TYPE = os.environ.get("LISTING_TYPE", "rent")
SOURCE = os.environ.get("SOURCE", "both")
MAX_PAGES = int(os.environ.get("PAGES", "5"))
# ─────────────────────────────────────────────────────────────────────────────

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))
SEEN_FILE = DATA_DIR / "seen_listings.json"
ALERTS_FILE = DATA_DIR / "alerts.json"
CHATS_FILE = DATA_DIR / "chat_ids.json"
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


def load_chats() -> list[dict]:
    if CHATS_FILE.exists():
        try:
            return json.loads(CHATS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            return []
    return []


def get_chat_ids_for_alert(alert_id: str | None = None) -> list[str]:
    """Return chat IDs that should receive a given alert.
    If alert_id is None, returns all chats.
    Each chat entry has alert_ids: null (all alerts) or a list of alert IDs.
    """
    chats = load_chats()
    if not chats:
        # Fall back to env var for backwards compatibility
        return [TELEGRAM_CHAT_ID] if TELEGRAM_CHAT_ID else []

    result = []
    for chat in chats:
        subscribed = chat.get("alert_ids")
        if subscribed is None or (alert_id and alert_id in subscribed):
            result.append(chat["chat_id"])
    return result


def send_telegram(text: str, chat_id: str | None = None):
    """Send a message via the Telegram Bot API to a specific chat."""
    if not TELEGRAM_BOT_TOKEN:
        print("[Telegram] Token not set, skipping.")
        return
    if not chat_id:
        print("[Telegram] No chat ID provided, skipping.")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()

    try:
        req = urllib.request.Request(url, data=data)
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[Telegram] Failed to send to {chat_id}: {e}")


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


def notify(text: str, subject: str = "Property Alert",
           chat_ids: list[str] | None = None):
    """Send notification via configured method(s)."""
    methods = NOTIFY_METHOD.lower()
    sent = False

    if methods in ("telegram", "both"):
        targets = chat_ids or get_chat_ids_for_alert()
        for cid in targets:
            send_telegram(text, chat_id=cid)
        sent = bool(targets)

    if methods in ("email", "both"):
        send_email(subject, text)
        sent = True

    if not sent:
        print(f"[Notify] No notification method configured, printing:")
        print(text)
        print()




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
            if SOURCE in ("all", "both"):
                sources = get_all_provider_names()
            else:
                sources = [s.strip() for s in SOURCE.split(",")]
            for source_name in sources:
                all_listings.extend(
                    scrape_source(context, source_name, CITY, LISTING_TYPE, MAX_PAGES)
                )
        finally:
            context.close()
            browser.close()

    print(f"Scraped {len(all_listings)} total listings.")

    # Find new listings
    new_listings = [l for l in all_listings if l.get("url") and l["url"] not in seen]
    print(f"Found {len(new_listings)} new listings.")

    # Load amenities for enriching notifications
    amenities = load_amenities(DATA_DIR, CITY, LISTING_TYPE)
    if amenities:
        print(f"Loaded amenities for {len(amenities)} properties.")

    # Check each alert
    for alert in alerts:
        alert_id = alert.get("id")
        alert_name = alert.get("name", "Unnamed")
        matches = [l for l in new_listings if matches_alert(l, alert)]
        print(f"Alert '{alert_name}': {len(matches)} match(es).")

        if matches:
            targets = get_chat_ids_for_alert(alert_id)
            total = len(new_listings)
            pct = (len(matches) / total * 100) if total else 0
            header = format_alert_summary(alert)
            header += f"\n\n🏠 <b>{len(matches)} of {total} new listings matched ({pct:.1f}%)</b>"
            notify(
                header,
                subject=f"{len(matches)} new listing(s) for \"{alert_name}\"",
                chat_ids=targets,
            )
            for listing in matches:
                notify(
                    format_listing(listing, alert=alert, amenities=amenities),
                    subject=f"New listing: {listing.get('title', 'Property')}",
                    chat_ids=targets,
                )

    # Update seen set with ALL listings (not just matches)
    for l in all_listings:
        if l.get("url"):
            seen.add(l["url"])
    save_seen(seen)
    print(f"Seen file updated ({len(seen)} total).")


if __name__ == "__main__":
    main()
