"""Alerts, chats, and Telegram helpers — file-backed data store."""

import json
import urllib.request
import urllib.parse

from . import config as cfg
from .config import ALERTS_FILE, CHATS_FILE


def load_alerts() -> list[dict]:
    if ALERTS_FILE.exists():
        try:
            return json.loads(ALERTS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            return []
    return []


def save_alerts(alerts: list[dict]):
    ALERTS_FILE.write_text(json.dumps(alerts, indent=2))


def load_chats() -> list[dict]:
    if CHATS_FILE.exists():
        try:
            return json.loads(CHATS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            return []
    return []


def save_chats(chats: list[dict]):
    CHATS_FILE.write_text(json.dumps(chats, indent=2))


def get_chat_ids_for_alert(alert_id: str | None = None) -> list[str]:
    chats = load_chats()
    if not chats:
        return [cfg.TELEGRAM_CHAT_ID] if cfg.TELEGRAM_CHAT_ID else []
    result = []
    for chat in chats:
        subscribed = chat.get("alert_ids")
        if subscribed is None or (alert_id and alert_id in subscribed):
            result.append(chat["chat_id"])
    return result


# Telegram caps photo captions at 1024 chars (HTML markup included).
_TELEGRAM_CAPTION_LIMIT = 1024


def send_telegram(text: str, chat_id: str | None = None,
                  photo_url: str | None = None):
    """Send a Telegram message. If `photo_url` is set, send as a photo
    with the text as caption (caption truncated to 1024 chars). On photo
    failure, fall back to plain text so the alert always gets through.
    """
    if not cfg.TELEGRAM_BOT_TOKEN:
        print(f"[Telegram] Not configured. Message:\n{text}")
        return
    if not chat_id:
        print("[Telegram] No chat ID provided, skipping.")
        return

    if photo_url:
        caption = text
        if len(caption) > _TELEGRAM_CAPTION_LIMIT:
            caption = caption[: _TELEGRAM_CAPTION_LIMIT - 1] + "…"
        url = f"https://api.telegram.org/bot{cfg.TELEGRAM_BOT_TOKEN}/sendPhoto"
        data = urllib.parse.urlencode({
            "chat_id": chat_id,
            "photo": photo_url,
            "caption": caption,
            "parse_mode": "HTML",
        }).encode()
        try:
            req = urllib.request.Request(url, data=data)
            urllib.request.urlopen(req, timeout=15)
            return
        except Exception as e:
            print(f"[Telegram] sendPhoto failed for {chat_id}: {e} — falling back to text")

    url = f"https://api.telegram.org/bot{cfg.TELEGRAM_BOT_TOKEN}/sendMessage"
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


def matches_alert(listing: dict, alert: dict) -> bool:
    from alerts.alert_filter import matches_alert as _matches
    return _matches(listing, alert)


def sync_chat_subscriptions(alert_id: str, chat_ids: list[str] | None):
    """Update chat_ids.json so each chat's alert_ids reflects this alert's chatIds."""
    chats = load_chats()
    for chat in chats:
        cid = chat["chat_id"]
        subscribed = chat.get("alert_ids")
        if chat_ids is None:
            continue
        if cid in chat_ids:
            if subscribed is not None and alert_id not in subscribed:
                subscribed.append(alert_id)
                chat["alert_ids"] = subscribed
        else:
            if subscribed is None:
                all_alert_ids = [a["id"] for a in load_alerts() if a["id"] != alert_id]
                chat["alert_ids"] = all_alert_ids
            elif alert_id in subscribed:
                subscribed.remove(alert_id)
                chat["alert_ids"] = subscribed
    save_chats(chats)


def remove_alert_from_chats(alert_id: str):
    """Remove an alert ID from all chat subscriptions."""
    chats = load_chats()
    changed = False
    for chat in chats:
        subscribed = chat.get("alert_ids")
        if subscribed is not None and alert_id in subscribed:
            subscribed.remove(alert_id)
            if not subscribed:
                chat["alert_ids"] = None
            changed = True
    if changed:
        save_chats(chats)
