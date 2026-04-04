#!/usr/bin/env python3
"""
Simple HTTP server that serves static files and provides an alerts API.

Endpoints:
    GET  /api/alerts              — list all saved alerts
    POST /api/alerts              — create a new alert (JSON body)
    DELETE /api/alerts/<id>       — delete an alert by id
    POST /api/alerts/<id>/test   — test an alert against current listings and send matches to Telegram
"""

import json
import re
import uuid
import os
import sys
import urllib.request
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from format_notify import load_amenities, format_listing, format_alert_summary


def _load_dotenv():
    """Load .env file from the script's directory if it exists."""
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
CITY = os.environ.get("CITY", "Manchester")
LISTING_TYPE = os.environ.get("LISTING_TYPE", "rent")
ALERTS_FILE = DATA_DIR / "alerts.json"
CHATS_FILE = DATA_DIR / "chat_ids.json"
_slug = CITY.lower().replace(" ", "_")
LISTINGS_FILE = Path(os.environ.get(
    "LISTINGS_FILE",
    DATA_DIR / f"{_slug}_{LISTING_TYPE}_listings.json",
))
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")


def load_chats() -> list[dict]:
    if CHATS_FILE.exists():
        try:
            return json.loads(CHATS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            return []
    return []


def get_chat_ids_for_alert(alert_id: str | None = None) -> list[str]:
    chats = load_chats()
    if not chats:
        return [TELEGRAM_CHAT_ID] if TELEGRAM_CHAT_ID else []
    result = []
    for chat in chats:
        subscribed = chat.get("alert_ids")
        if subscribed is None or (alert_id and alert_id in subscribed):
            result.append(chat["chat_id"])
    return result


def send_telegram(text: str, chat_id: str | None = None):
    if not TELEGRAM_BOT_TOKEN:
        print(f"[Telegram] Not configured. Message:\n{text}")
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


def _matches_alert(listing: dict, alert: dict) -> bool:
    """Check if a listing matches an alert's criteria."""
    from alert_filter import matches_alert
    return matches_alert(listing, alert)


def load_alerts() -> list[dict]:
    if ALERTS_FILE.exists():
        try:
            return json.loads(ALERTS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            return []
    return []


def save_alerts(alerts: list[dict]):
    ALERTS_FILE.write_text(json.dumps(alerts, indent=2))


def save_chats(chats: list[dict]):
    CHATS_FILE.write_text(json.dumps(chats, indent=2))


def sync_chat_subscriptions(alert_id: str, chat_ids: list[str] | None):
    """Update chat_ids.json so each chat's alert_ids reflects this alert's chatIds."""
    chats = load_chats()
    for chat in chats:
        cid = chat["chat_id"]
        subscribed = chat.get("alert_ids")
        if chat_ids is None:
            # All chats — ensure alert_ids is None (subscribed to all) or contains this alert
            # Don't change chats that are already subscribed to all
            continue
        if cid in chat_ids:
            if subscribed is not None and alert_id not in subscribed:
                subscribed.append(alert_id)
                chat["alert_ids"] = subscribed
        else:
            if subscribed is None:
                # Chat was subscribed to all — now needs an explicit list excluding this alert
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


class AppHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/alerts":
            alerts = load_alerts()
            # Enrich alerts with their chatIds based on chat_ids.json
            chats = load_chats()
            for alert in alerts:
                aid = alert["id"]
                subscribed_chats = []
                for chat in chats:
                    subs = chat.get("alert_ids")
                    if subs is None or aid in subs:
                        subscribed_chats.append(chat["chat_id"])
                alert["chatIds"] = subscribed_chats if subscribed_chats != [c["chat_id"] for c in chats] else None
            self._json_response(200, alerts)
        elif self.path == "/api/chats":
            chats = load_chats()
            self._json_response(200, chats)
        else:
            super().do_GET()

    def do_POST(self):
        # Test an alert against current listings
        test_match = re.match(r"^/api/alerts/([^/]+)/test$", self.path)
        if test_match:
            alert_id = test_match.group(1)
            alerts = load_alerts()
            alert = next((a for a in alerts if a["id"] == alert_id), None)
            if not alert:
                self._json_response(404, {"error": "Alert not found"})
                return

            # Load listings
            if not LISTINGS_FILE.exists():
                self._json_response(404, {"error": "No listings file found"})
                return
            try:
                data = json.loads(LISTINGS_FILE.read_text())
                listings = data.get("listings", [])
            except (json.JSONDecodeError, IOError) as e:
                self._json_response(500, {"error": f"Failed to read listings: {e}"})
                return

            matches = [l for l in listings if _matches_alert(l, alert)]
            urls = [l.get("url", "") for l in matches if l.get("url")]

            # Load amenities for enriched messages
            amenities = load_amenities(DATA_DIR, CITY, LISTING_TYPE)

            # Send to Telegram
            total = len(listings)
            targets = get_chat_ids_for_alert(alert_id)
            if matches:
                pct = (len(matches) / total * 100) if total else 0
                header = f"🧪 <b>Test</b>\n\n{format_alert_summary(alert)}"
                header += f"\n\n🏠 <b>{len(matches)} of {total} listings matched ({pct:.1f}%)</b>"
                for cid in targets:
                    send_telegram(header, chat_id=cid)
                for listing in matches:
                    msg = format_listing(listing, alert=alert, amenities=amenities)
                    for cid in targets:
                        send_telegram(msg, chat_id=cid)
            else:
                for cid in targets:
                    send_telegram(
                        f'🧪 <b>Test: 0 of {total} listings match "{alert["name"]}"</b>',
                        chat_id=cid)

            self._json_response(200, {"matches": len(urls), "urls": urls})
            return

        if self.path == "/api/alerts":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, ValueError):
                self._json_response(400, {"error": "Invalid JSON"})
                return

            alert = {
                "id": str(uuid.uuid4()),
                "name": body.get("name", "Untitled alert"),
                "minPrice": body.get("minPrice"),
                "maxPrice": body.get("maxPrice"),
                "minBedrooms": body.get("minBedrooms"),
                "maxBedrooms": body.get("maxBedrooms"),
                "minBathrooms": body.get("minBathrooms"),
                "source": body.get("source"),
                "councilTaxBands": body.get("councilTaxBands"),
                "propertyTypes": body.get("propertyTypes"),
                "furnishTypes": body.get("furnishTypes"),
                "minSqFt": body.get("minSqFt"),
                "maxSqFt": body.get("maxSqFt"),
                "availableFrom": body.get("availableFrom"),
                "availableTo": body.get("availableTo"),
                "pinLat": body.get("pinLat"),
                "pinLng": body.get("pinLng"),
                "pinRadius": body.get("pinRadius"),
                "excludeShares": body.get("excludeShares", False),
                "search": body.get("search", ""),
                "createdAt": body.get("createdAt"),
            }
            chat_ids = body.get("chatIds")
            alerts = load_alerts()
            alerts.append(alert)
            save_alerts(alerts)
            if chat_ids is not None:
                sync_chat_subscriptions(alert["id"], chat_ids)
            alert["chatIds"] = chat_ids
            self._json_response(201, alert)
        else:
            self._json_response(404, {"error": "Not found"})

    def do_PUT(self):
        put_match = re.match(r"^/api/alerts/([^/]+)$", self.path)
        if put_match:
            alert_id = put_match.group(1)
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, ValueError):
                self._json_response(400, {"error": "Invalid JSON"})
                return

            alerts = load_alerts()
            idx = next((i for i, a in enumerate(alerts) if a["id"] == alert_id), None)
            if idx is None:
                self._json_response(404, {"error": "Alert not found"})
                return

            existing = alerts[idx]
            updated = {
                "id": alert_id,
                "name": body.get("name", existing["name"]),
                "minPrice": body.get("minPrice"),
                "maxPrice": body.get("maxPrice"),
                "minBedrooms": body.get("minBedrooms"),
                "maxBedrooms": body.get("maxBedrooms"),
                "minBathrooms": body.get("minBathrooms"),
                "source": body.get("source"),
                "councilTaxBands": body.get("councilTaxBands"),
                "propertyTypes": body.get("propertyTypes"),
                "furnishTypes": body.get("furnishTypes"),
                "minSqFt": body.get("minSqFt"),
                "maxSqFt": body.get("maxSqFt"),
                "availableFrom": body.get("availableFrom"),
                "availableTo": body.get("availableTo"),
                "pinLat": body.get("pinLat"),
                "pinLng": body.get("pinLng"),
                "pinRadius": body.get("pinRadius"),
                "excludeShares": body.get("excludeShares", False),
                "search": body.get("search", ""),
                "createdAt": existing.get("createdAt"),
            }
            alerts[idx] = updated
            save_alerts(alerts)

            chat_ids = body.get("chatIds")
            sync_chat_subscriptions(alert_id, chat_ids)
            updated["chatIds"] = chat_ids
            self._json_response(200, updated)
        else:
            self._json_response(404, {"error": "Not found"})

    def do_DELETE(self):
        if self.path.startswith("/api/alerts/"):
            alert_id = self.path[len("/api/alerts/"):]
            alerts = load_alerts()
            new_alerts = [a for a in alerts if a["id"] != alert_id]
            if len(new_alerts) == len(alerts):
                self._json_response(404, {"error": "Alert not found"})
                return
            save_alerts(new_alerts)
            remove_alert_from_chats(alert_id)
            self._json_response(200, {"ok": True})
        else:
            self._json_response(404, {"error": "Not found"})

    def _json_response(self, status: int, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Quieter logging — only errors
        if args and isinstance(args[0], str) and args[0].startswith("GET"):
            return
        super().log_message(format, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    os.chdir(directory)
    server = HTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Serving on http://0.0.0.0:{port} (directory: {directory})")
    server.serve_forever()


if __name__ == "__main__":
    main()
