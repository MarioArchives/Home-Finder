#!/usr/bin/env python3
"""
Simple HTTP server that serves static files and provides an alerts API.

Endpoints:
    GET  /api/status               — app status (setup_needed, scraping, ready, etc.)
    POST /api/setup                — start scraping with {city, type, source, pages}
    GET  /api/setup/progress       — SSE stream of scraping progress
    GET  /api/alerts               — list all saved alerts
    POST /api/alerts               — create a new alert (JSON body)
    PUT  /api/alerts/<id>          — update an alert
    DELETE /api/alerts/<id>        — delete an alert by id
    POST /api/alerts/<id>/test     — test an alert against current listings
"""

import json
import re
import uuid
import os
import sys
import subprocess
import threading
import time
import urllib.request
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
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


def _load_telegram_env():
    """Load saved Telegram credentials from data volume."""
    tg_env = DATA_DIR / ".env.telegram"
    if not tg_env.exists():
        return
    for line in tg_env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            os.environ[key.strip()] = value.strip()


_load_telegram_env()

CITY = os.environ.get("CITY", "Manchester")
LISTING_TYPE = os.environ.get("LISTING_TYPE", "rent")
ALERTS_FILE = DATA_DIR / "alerts.json"
CHATS_FILE = DATA_DIR / "chat_ids.json"
CONFIG_FILE = DATA_DIR / "config.json"
_slug = CITY.lower().replace(" ", "_")
LISTINGS_FILE = Path(os.environ.get(
    "LISTINGS_FILE",
    DATA_DIR / f"{_slug}_{LISTING_TYPE}_listings.json",
))
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

# UI directory — set in main() after os.chdir
_ui_dir: Path = Path(".")

# ---------------------------------------------------------------------------
# Setup state — shared between the setup thread and SSE handler
# ---------------------------------------------------------------------------
_setup_state = {
    "phase": None,       # "scraping" | "amenities" | "complete" | "error" | None
    "progress": {},      # current progress details
    "error": None,       # error message if failed
}
_setup_lock = threading.Lock()


def _get_config():
    """Load config.json if it exists."""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            pass
    return None


def _get_listings_file(city=None, listing_type=None):
    """Get the listings file path for a city/type combo."""
    c = city or CITY
    t = listing_type or LISTING_TYPE
    slug = c.lower().replace(" ", "_")
    return DATA_DIR / f"{slug}_{t}_listings.json"


def _get_amenities_file(city=None, listing_type=None):
    """Get the amenities file path for a city/type combo."""
    c = city or CITY
    t = listing_type or LISTING_TYPE
    slug = c.lower().replace(" ", "_")
    return DATA_DIR / f"{slug}_{t}_amenities.json"


def _get_status():
    """Determine current app status."""
    with _setup_lock:
        if _setup_state["phase"] in ("scraping", "amenities"):
            return _setup_state["phase"]

    # Check if config exists and listings file is present
    config = _get_config()
    if config:
        lf = _get_listings_file(config["city"], config["listing_type"])
        if lf.exists():
            return "ready"

    # Fallback: check default listings file
    if LISTINGS_FILE.exists():
        return "ready"

    return "setup_needed"


def _parse_scraper_line(line):
    """Parse a line of scraper output into progress updates."""
    line = line.strip()
    if not line:
        return

    with _setup_lock:
        _setup_state["progress"]["message"] = line

        # [Source] Fetching page N...
        m = re.match(r"\[(\w+)\] Fetching page (\d+)\.\.\.", line)
        if m:
            _setup_state["progress"]["source"] = m.group(1)
            _setup_state["progress"]["current_page"] = int(m.group(2))
            return

        # [Source] Page N: X listings (total: Y)
        m = re.match(r"\[(\w+)\] Page (\d+): (\d+) listings \(total: (\d+)\)", line)
        if m:
            _setup_state["progress"]["listings_found"] = int(m.group(4))
            _setup_state["progress"]["pages_done"] = _setup_state["progress"].get("pages_done", 0) + 1
            _setup_state["progress"]["detail_current"] = None
            _setup_state["progress"]["detail_total"] = None
            return

        # [i/n] address... done
        m = re.match(r"\[(\d+)/(\d+)\] (.+?)\.\.\.(.*)$", line)
        if m:
            _setup_state["progress"]["detail_current"] = int(m.group(1))
            _setup_state["progress"]["detail_total"] = int(m.group(2))
            _setup_state["progress"]["current_listing"] = m.group(3).strip()
            return

        # [Source] Collected N listings total.
        m = re.match(r"\[(\w+)\] Collected (\d+) listings total\.", line)
        if m:
            _setup_state["progress"]["listings_found"] = int(m.group(2))
            return


def _parse_amenities_line(line):
    """Parse a line of amenities output into progress updates."""
    line = line.strip()
    if not line:
        return
    with _setup_lock:
        _setup_state["progress"]["message"] = line


def _run_setup(city, listing_type, source, pages, amenities="climbing"):
    """Run the scraper and amenities fetch in a background thread."""
    listings_file = _get_listings_file(city, listing_type)
    amenities_file = _get_amenities_file(city, listing_type)

    total_pages = pages * (2 if source == "both" else 1)
    with _setup_lock:
        _setup_state["phase"] = "scraping"
        _setup_state["progress"] = {
            "source": source,
            "current_page": 0,
            "total_pages": total_pages,
            "pages_done": 0,
            "listings_found": 0,
            "message": f"Starting scrape for {city}...",
        }
        _setup_state["error"] = None

    try:
        # Run scraper
        cmd = [
            sys.executable, "/app/scrape_listings.py",
            "--city", city,
            "--type", listing_type,
            "--pages", str(pages),
            "--source", source,
            "--output", str(listings_file),
        ]
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        scraper_output = []
        for line in (proc.stdout or []):
            print(f"[scraper] {line}", end="", flush=True)
            scraper_output.append(line.rstrip())
            _parse_scraper_line(line)
        proc.wait()

        if proc.returncode != 0:
            # Include last few lines of output in the error for diagnostics
            tail = "\n".join(scraper_output[-5:]) if scraper_output else "(no output)"
            print(f"[setup] Scraper exited with code {proc.returncode}:\n{tail}", flush=True)
            with _setup_lock:
                _setup_state["phase"] = "error"
                _setup_state["error"] = f"Scraping failed (exit code {proc.returncode}). Last output:\n{tail}"
            return

        # Run amenities fetch
        with _setup_lock:
            _setup_state["phase"] = "amenities"
            _setup_state["progress"] = {"message": "Fetching nearby amenities..."}

        cmd = [sys.executable, "/app/fetch_amenities.py", "--amenities", amenities, str(listings_file)]
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        amenities_output = []
        for line in (proc.stdout or []):
            print(f"[amenities] {line}", end="", flush=True)
            amenities_output.append(line.rstrip())
            _parse_amenities_line(line)
        proc.wait()
        if proc.returncode != 0:
            tail = "\n".join(amenities_output[-5:]) if amenities_output else "(no output)"
            print(f"[setup] Amenities exited with code {proc.returncode}:\n{tail}", flush=True)
        # Amenities failure is non-fatal

        # Create symlinks in UI directory
        ui_listings = _ui_dir / "listings.json"
        ui_amenities = _ui_dir / "amenities.json"
        for link in (ui_listings, ui_amenities):
            try:
                link.unlink()
            except FileNotFoundError:
                pass
        os.symlink(listings_file, ui_listings)
        if amenities_file.exists():
            os.symlink(amenities_file, ui_amenities)

        # Save config
        config = {
            "city": city,
            "listing_type": listing_type,
            "source": source,
            "pages": pages,
            "amenities": amenities,
        }
        CONFIG_FILE.write_text(json.dumps(config, indent=2))

        # Install cron jobs with user's settings
        _install_cron(city, listing_type, source, pages, listings_file, amenities_file, amenities)

        with _setup_lock:
            _setup_state["phase"] = "complete"
            _setup_state["progress"] = {"message": "Setup complete!"}

    except Exception as e:
        with _setup_lock:
            _setup_state["phase"] = "error"
            _setup_state["error"] = str(e)


def _install_cron(city, listing_type, source, pages, listings_file, amenities_file, amenities="climbing"):
    """Install cron jobs for periodic scraping."""
    import random
    rand_hour = random.randint(6, 22)
    rand_min = random.randint(0, 59)

    env_file = DATA_DIR / ".env.cron"
    env_vars = {k: v for k, v in os.environ.items()
                if re.match(r'^(CITY|LISTING_TYPE|PAGES|SOURCE|TELEGRAM_|DATA_DIR|NOTIFY_METHOD|SMTP_|EMAIL_)', k)}
    env_vars.update({"CITY": city, "LISTING_TYPE": listing_type, "SOURCE": source, "PAGES": str(pages), "AMENITIES": amenities})
    env_file.write_text("\n".join(f"{k}={v}" for k, v in env_vars.items()) + "\n")

    cron_content = f"""# Re-scrape listings daily at 6am
0 6 * * * cd /app && . {env_file} && python3 /app/scrape_listings.py --city "$CITY" --type "$LISTING_TYPE" --pages "$PAGES" --source "$SOURCE" --output "{listings_file}" >> "{DATA_DIR}/cron.log" 2>&1

# Check alerts for new listings at a random daily time ({rand_hour}:{rand_min:02d})
{rand_min} {rand_hour} * * * cd /app && . {env_file} && python3 /app/check_new_listings.py >> "{DATA_DIR}/cron.log" 2>&1

# Refresh amenities weekly on Sunday at 7am
0 7 * * 0 cd /app && . {env_file} && python3 /app/fetch_amenities.py --amenities "$AMENITIES" "{listings_file}" >> "{DATA_DIR}/cron.log" 2>&1

"""
    cron_path = Path("/etc/cron.d/property-update")
    try:
        cron_path.write_text(cron_content)
        cron_path.chmod(0o644)
        subprocess.run(["crontab", str(cron_path)], check=False)
    except Exception:
        pass  # Cron may not be available outside Docker


# ---------------------------------------------------------------------------
# Alerts / Chats helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------

class AppHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # ---- Status ----
        if self.path == "/api/status":
            status = _get_status()
            chats = load_chats()
            body = {
                "status": status,
                "telegram_configured": bool(TELEGRAM_BOT_TOKEN and (TELEGRAM_CHAT_ID or chats)),
            }
            if status in ("scraping", "amenities"):
                with _setup_lock:
                    body["progress"] = dict(_setup_state["progress"])
            elif status == "ready":
                body["config"] = _get_config()
            self._json_response(200, body)

        # ---- SSE progress stream ----
        elif self.path == "/api/setup/progress":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            last_sent = None
            try:
                while True:
                    with _setup_lock:
                        snapshot = {
                            "phase": _setup_state["phase"],
                            "error": _setup_state.get("error"),
                            **_setup_state["progress"],
                        }
                    current = json.dumps(snapshot)
                    if current != last_sent:
                        self.wfile.write(f"data: {current}\n\n".encode())
                        self.wfile.flush()
                        last_sent = current
                    if snapshot["phase"] in ("complete", "error", None):
                        break
                    time.sleep(1)
            except (BrokenPipeError, ConnectionResetError):
                pass

        # ---- Alerts ----
        elif self.path == "/api/alerts":
            alerts = load_alerts()
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

        elif self.path == "/api/telegram/status":
            chats = load_chats()
            self._json_response(200, {
                "configured": bool(TELEGRAM_BOT_TOKEN and (TELEGRAM_CHAT_ID or chats)),
                "has_bot_token": bool(TELEGRAM_BOT_TOKEN),
                "has_chat_id": bool(TELEGRAM_CHAT_ID or chats),
            })

        else:
            # SPA fallback: serve index.html for paths that aren't static files
            path = self.translate_path(self.path)
            if not os.path.exists(path) and not self.path.startswith("/api/"):
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        # ---- Setup ----
        if self.path == "/api/setup":
            # Check if already running
            with _setup_lock:
                if _setup_state["phase"] in ("scraping", "amenities"):
                    self._json_response(409, {"error": "Setup already in progress"})
                    return

            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, ValueError):
                self._json_response(400, {"error": "Invalid JSON"})
                return

            city = body.get("city", "").strip()
            listing_type = body.get("type", "rent")
            source = body.get("source", "rightmove")
            pages = int(body.get("pages", 5))
            amenities = body.get("amenities", "climbing")

            if not city:
                self._json_response(400, {"error": "City is required"})
                return
            if listing_type not in ("rent", "buy"):
                self._json_response(400, {"error": "Type must be 'rent' or 'buy'"})
                return
            if source not in ("rightmove", "zoopla", "both"):
                self._json_response(400, {"error": "Source must be 'rightmove', 'zoopla', or 'both'"})
                return

            thread = threading.Thread(
                target=_run_setup,
                args=(city, listing_type, source, pages, amenities),
                daemon=True,
            )
            thread.start()
            self._json_response(201, {"ok": True})
            return

        # ---- Test alert ----
        test_match = re.match(r"^/api/alerts/([^/]+)/test$", self.path)
        if test_match:
            alert_id = test_match.group(1)
            alerts = load_alerts()
            alert = next((a for a in alerts if a["id"] == alert_id), None)
            if not alert:
                self._json_response(404, {"error": "Alert not found"})
                return

            # Determine listings file from config
            config = _get_config()
            lf = _get_listings_file(
                config["city"] if config else None,
                config["listing_type"] if config else None,
            )
            if not lf.exists():
                lf = LISTINGS_FILE
            if not lf.exists():
                self._json_response(404, {"error": "No listings file found"})
                return
            try:
                data = json.loads(lf.read_text())
                listings = data.get("listings", [])
            except (json.JSONDecodeError, IOError) as e:
                self._json_response(500, {"error": f"Failed to read listings: {e}"})
                return

            matches = [l for l in listings if _matches_alert(l, alert)]
            urls = [l.get("url", "") for l in matches if l.get("url")]

            city_name = config["city"] if config else CITY
            lt = config["listing_type"] if config else LISTING_TYPE
            amenities = load_amenities(DATA_DIR, city_name, lt)

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

        if self.path == "/api/telegram/setup":
            global TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, ValueError):
                self._json_response(400, {"error": "Invalid JSON"})
                return

            bot_token = body.get("bot_token", "").strip()
            chat_id = body.get("chat_id", "").strip()
            chat_name = body.get("chat_name", "").strip() or "Owner"

            if not bot_token:
                self._json_response(400, {"error": "Bot token is required"})
                return

            # Validate bot token via getMe
            try:
                url = f"https://api.telegram.org/bot{bot_token}/getMe"
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=30) as resp:
                    me = json.loads(resp.read().decode())
                if not me.get("ok"):
                    self._json_response(400, {"error": "Invalid bot token"})
                    return
                bot_name = me.get("result", {}).get("username", "unknown")
            except Exception as e:
                print(f"[telegram] getMe failed: {type(e).__name__}: {e}", flush=True)
                self._json_response(400, {"error": f"Could not validate bot token: {e}"})
                return

            # If chat_id provided, validate by sending a test message
            if chat_id:
                try:
                    msg_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
                    msg_data = urllib.parse.urlencode({
                        "chat_id": chat_id,
                        "text": "✅ Property Listings bot connected successfully!",
                    }).encode()
                    req = urllib.request.Request(msg_url, data=msg_data)
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        result = json.loads(resp.read().decode())
                    if not result.get("ok"):
                        self._json_response(400, {"error": "Could not send message to that chat ID. Make sure you've messaged the bot first."})
                        return
                except Exception as e:
                    print(f"[telegram] sendMessage failed: {type(e).__name__}: {e}", flush=True)
                    self._json_response(400, {"error": f"Could not reach chat: {e}"})
                    return

            # Save credentials
            TELEGRAM_BOT_TOKEN = bot_token
            TELEGRAM_CHAT_ID = chat_id
            os.environ["TELEGRAM_BOT_TOKEN"] = bot_token
            os.environ["TELEGRAM_CHAT_ID"] = chat_id

            tg_env = DATA_DIR / ".env.telegram"
            tg_env.write_text(f"TELEGRAM_BOT_TOKEN={bot_token}\nTELEGRAM_CHAT_ID={chat_id}\n")

            # Add chat to chat_ids.json if not already there
            if chat_id:
                chats = load_chats()
                if not any(c["chat_id"] == chat_id for c in chats):
                    chats.append({"chat_id": chat_id, "name": chat_name, "alert_ids": None})
                    save_chats(chats)

            # Update .env.cron if it exists so cron jobs pick up new credentials
            cron_env = DATA_DIR / ".env.cron"
            if cron_env.exists():
                lines = cron_env.read_text().splitlines()
                new_lines = [l for l in lines if not l.startswith("TELEGRAM_BOT_TOKEN=") and not l.startswith("TELEGRAM_CHAT_ID=")]
                new_lines.append(f"TELEGRAM_BOT_TOKEN={bot_token}")
                new_lines.append(f"TELEGRAM_CHAT_ID={chat_id}")
                cron_env.write_text("\n".join(new_lines) + "\n")

            self._json_response(200, {"ok": True, "bot_name": bot_name})
            return

        if self.path == "/api/telegram/discover-chats":
            if not TELEGRAM_BOT_TOKEN:
                self._json_response(400, {"error": "Bot token not configured yet"})
                return
            try:
                url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read().decode())
                if not data.get("ok"):
                    self._json_response(500, {"error": "Failed to fetch updates from Telegram"})
                    return
                seen = {}
                for update in data.get("result", []):
                    msg = update.get("message", {})
                    chat = msg.get("chat", {})
                    cid = str(chat.get("id", ""))
                    if not cid:
                        continue
                    name = chat.get("first_name", "") or chat.get("title", "") or cid
                    seen[cid] = {"chat_id": cid, "name": name, "type": chat.get("type", "")}
                existing = {c["chat_id"] for c in load_chats()}
                discovered = [c for c in seen.values() if c["chat_id"] not in existing]
                self._json_response(200, {"chats": discovered})
            except Exception as e:
                self._json_response(500, {"error": f"Failed to discover chats: {e}"})
            return

        if self.path == "/api/telegram/add-chat":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, ValueError):
                self._json_response(400, {"error": "Invalid JSON"})
                return
            chat_id = str(body.get("chat_id", "")).strip()
            chat_name = body.get("name", "").strip() or chat_id
            if not chat_id:
                self._json_response(400, {"error": "chat_id is required"})
                return
            chats = load_chats()
            if any(c["chat_id"] == chat_id for c in chats):
                self._json_response(409, {"error": "Chat already exists"})
                return
            chats.append({"chat_id": chat_id, "name": chat_name, "alert_ids": None})
            save_chats(chats)
            self._json_response(201, {"ok": True})
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
        if args and isinstance(args[0], str) and args[0].startswith("GET"):
            return
        super().log_message(format, *args)


def main():
    global _ui_dir
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    _ui_dir = Path(os.path.abspath(directory))
    os.chdir(directory)
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Serving on http://0.0.0.0:{port} (directory: {directory})")
    server.serve_forever()


if __name__ == "__main__":
    main()
