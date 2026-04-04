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
ALERTS_FILE = DATA_DIR / "alerts.json"
LISTINGS_FILE = Path(os.environ.get(
    "LISTINGS_FILE",
    Path(__file__).parent / "manchester_rent_listings.json",
))
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")


def send_telegram(text: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[Telegram] Not configured. Message:\n{text}")
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


class AppHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/alerts":
            alerts = load_alerts()
            self._json_response(200, alerts)
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

            # Send to Telegram
            if urls:
                lines = [f'🧪 <b>Test: {len(urls)} match(es) for "{alert["name"]}"</b>', ""]
                for url in urls:
                    lines.append(url)
                # Telegram has a 4096 char limit per message, split if needed
                msg = "\n".join(lines)
                while msg:
                    chunk, msg = msg[:4096], msg[4096:]
                    send_telegram(chunk)
            else:
                send_telegram(f'🧪 <b>Test: no listings match "{alert["name"]}"</b>')

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
                "minBathrooms": body.get("minBathrooms"),
                "source": body.get("source"),
                "councilTaxBands": body.get("councilTaxBands"),
                "propertyTypes": body.get("propertyTypes"),
                "furnishType": body.get("furnishType"),
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
            alerts = load_alerts()
            alerts.append(alert)
            save_alerts(alerts)
            self._json_response(201, alert)
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
