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
import urllib.request
import urllib.parse
from pathlib import Path

from scrape_listings import scrape_all
from dedupe import dedupe
from providers import resolve_sources
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


def _load_env_telegram() -> None:
    """Populate TELEGRAM_* env vars from the data volume's .env.telegram file.

    The UI writes credentials to this file on first setup. Callers like
    entrypoint.sh's catch-up block or ad-hoc `python3 -m alerts.check_new_listings`
    invocations don't source .env.cron, so without this Telegram sends silently
    fall back to "Token not set, skipping." Loading here makes the module
    self-sufficient regardless of how it's invoked.
    """
    tg = DATA_DIR / ".env.telegram"
    if not tg.exists():
        return
    for line in tg.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if value and not os.environ.get(key):
            os.environ[key] = value


_load_env_telegram()

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

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


# Telegram caps photo captions at 1024 chars (HTML markup included).
_TELEGRAM_CAPTION_LIMIT = 1024


def _send_telegram_message(text: str, chat_id: str) -> bool:
    """Plain text send via sendMessage. Returns True on success."""
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
        return True
    except Exception as e:
        print(f"[Telegram] sendMessage failed for {chat_id}: {e}")
        return False


def _send_telegram_photo(photo_url: str, caption: str, chat_id: str) -> bool:
    """Send a photo with caption via sendPhoto. Returns True on success.

    Telegram fetches the photo server-side from the URL, so any image
    accessible on the public internet (Rightmove/Zoopla CDNs included)
    will work. Silently falls back to returning False if the photo fails
    to load or is rejected — the caller can then resend as plain text.
    """
    if len(caption) > _TELEGRAM_CAPTION_LIMIT:
        caption = caption[: _TELEGRAM_CAPTION_LIMIT - 1] + "…"
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "photo": photo_url,
        "caption": caption,
        "parse_mode": "HTML",
    }).encode()
    try:
        req = urllib.request.Request(url, data=data)
        urllib.request.urlopen(req, timeout=15)
        return True
    except Exception as e:
        print(f"[Telegram] sendPhoto failed for {chat_id}: {e}")
        return False


def send_telegram(text: str, chat_id: str | None = None,
                  photo_url: str | None = None):
    """Send a message via the Telegram Bot API to a specific chat.

    If `photo_url` is provided, attempt to send it as a photo with the
    text as caption. On failure (e.g. unreachable image URL, oversized
    caption after truncation), fall back to a plain text message so the
    user still gets the alert.
    """
    if not TELEGRAM_BOT_TOKEN:
        print("[Telegram] Token not set, skipping.")
        return
    if not chat_id:
        print("[Telegram] No chat ID provided, skipping.")
        return

    if photo_url:
        if _send_telegram_photo(photo_url, text, chat_id):
            return
        # Photo send failed — fall through to plain text so the alert
        # still gets through.
    _send_telegram_message(text, chat_id)


def notify(text: str,
           chat_ids: list[str] | None = None,
           photo_url: str | None = None):
    """Send a Telegram notification to the given chats.

    `photo_url` (optional) sends the message as a photo with the text as caption.
    """
    targets = chat_ids or get_chat_ids_for_alert()
    if not targets:
        print(f"[Notify] No Telegram chats configured, printing:")
        print(text)
        print()
        return

    for cid in targets:
        send_telegram(text, chat_id=cid, photo_url=photo_url)




def main():
    alerts = load_alerts()
    if not alerts:
        print("No alerts configured — nothing to check.")
        return

    print(f"Loaded {len(alerts)} alert(s).")

    seen = load_seen()
    print(f"Loaded {len(seen)} previously seen listings.")

    # Two paths:
    #   1. ALERT_USE_EXISTING=1 — load the listings JSON written by an
    #      earlier `run_stage scrape` call. This is the cron pipeline path:
    #      scrape and alerts run in separate cron invocations so they can
    #      fail/recover independently.
    #   2. Otherwise — scrape directly (legacy/standalone usage).
    all_listings: list[dict] = []
    use_existing = os.environ.get("ALERT_USE_EXISTING") == "1"
    listings_path_env = os.environ.get("ALERT_LISTINGS_FILE")
    if use_existing:
        listings_path = (
            Path(listings_path_env) if listings_path_env
            else DATA_DIR / f"{CITY.lower().replace(' ', '_')}_{LISTING_TYPE}_listings.json"
        )
        if not listings_path.exists():
            print(f"ALERT_USE_EXISTING set but {listings_path} missing — falling back to scrape.")
            use_existing = False
        else:
            try:
                payload = json.loads(listings_path.read_text())
            except (json.JSONDecodeError, OSError) as e:
                print(f"Failed to read {listings_path}: {e} — falling back to scrape.")
                use_existing = False
            else:
                all_listings = payload.get("listings", []) if isinstance(payload, dict) else []
                print(f"Loaded {len(all_listings)} listings from {listings_path.name}.")

    if not use_existing:
        try:
            sources = resolve_sources(SOURCE)
        except ValueError as e:
            print(f"Invalid SOURCE env value: {e}")
            return
        all_listings = scrape_all(sources, CITY, LISTING_TYPE, MAX_PAGES)
        print(f"Scraped {len(all_listings)} total listings.")

    if not all_listings:
        print("Scrape returned nothing — skipping alert check to avoid wiping the seen file.")
        return

    # Merge cross-provider duplicates before alert matching so the same
    # property is only evaluated (and notified) once.
    all_listings, merged = dedupe(all_listings)
    if merged > 0:
        print(f"Merged {merged} duplicate listing(s).")

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

        targets = get_chat_ids_for_alert(alert_id)
        if matches:
            total = len(new_listings)
            pct = (len(matches) / total * 100) if total else 0
            header = format_alert_summary(alert)
            header += f"\n\n🏠 <b>{len(matches)} of {total} new listings matched ({pct:.1f}%)</b>"
            notify(header, chat_ids=targets)
            for listing in matches:
                images = listing.get("images") or []
                photo = images[0] if images else None
                notify(
                    format_listing(listing, alert=alert, amenities=amenities),
                    chat_ids=targets,
                    photo_url=photo,
                )
        else:
            header = format_alert_summary(alert)
            header += f"\n\n🏠 <b>No new matches found today</b> ({len(new_listings)} new listing(s) scanned)"
            notify(header, chat_ids=targets)

    # Update seen set with ALL listings (not just matches)
    for l in all_listings:
        if l.get("url"):
            seen.add(l["url"])
    save_seen(seen)
    print(f"Seen file updated ({len(seen)} total).")


if __name__ == "__main__":
    main()
