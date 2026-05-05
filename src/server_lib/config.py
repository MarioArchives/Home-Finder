"""Shared configuration, path helpers, and environment loading."""

import json
import os
import threading
from pathlib import Path


def _load_dotenv():
    """Load .env file from the project root if it exists.

    Treats empty-string env vars (e.g. the placeholder TELEGRAM_BOT_TOKEN=""
    set in the Dockerfile) as unset, so a real value in .env wins. Plain
    os.environ.setdefault() would skip the assignment because the key is
    already present.
    """
    env_path = Path(__file__).parent.parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if not os.environ.get(key):
                os.environ[key] = value


_load_dotenv()

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent.parent / "data"))
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

# Mutable UI directory — set by main() after os.chdir
ui_dir: Path = Path(".")

# ---------------------------------------------------------------------------
# Setup state — shared between the setup thread and SSE handler
# ---------------------------------------------------------------------------
setup_state = {
    "phase": None,       # "scraping" | "amenities" | "complete" | "error" | None
    "progress": {},      # current progress details
    "error": None,       # error message if failed
}
setup_preferences = {
    "amenities": "climbing",   # comma-separated selected amenities
    "pin_data": None,          # {lat, lng, label, emoji} or None
    "submitted": False,        # True once user confirms preferences
}
setup_lock = threading.Lock()


def load_telegram_env():
    """Load saved Telegram credentials from data volume.

    Populates both os.environ and the module-level TELEGRAM_* globals so that
    route handlers which read them via `cfg.TELEGRAM_BOT_TOKEN` see the values
    after a container restart (they were captured at import time as "").
    """
    global TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
    tg_env = DATA_DIR / ".env.telegram"
    if not tg_env.exists():
        return
    for line in tg_env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if not value:
                continue
            os.environ[key] = value
            if key == "TELEGRAM_BOT_TOKEN":
                TELEGRAM_BOT_TOKEN = value
            elif key == "TELEGRAM_CHAT_ID":
                TELEGRAM_CHAT_ID = value


def get_config():
    """Load config.json if it exists."""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            pass
    return None


def get_listings_file(city=None, listing_type=None):
    """Get the listings file path for a city/type combo."""
    c = city or CITY
    t = listing_type or LISTING_TYPE
    slug = c.lower().replace(" ", "_")
    return DATA_DIR / f"{slug}_{t}_listings.json"


def get_amenities_file(city=None, listing_type=None):
    """Get the amenities file path for a city/type combo."""
    c = city or CITY
    t = listing_type or LISTING_TYPE
    slug = c.lower().replace(" ", "_")
    return DATA_DIR / f"{slug}_{t}_amenities.json"


def get_status():
    """Determine current app status."""
    with setup_lock:
        if setup_state["phase"] in ("scraping", "amenities"):
            return setup_state["phase"]

    config = get_config()
    if config:
        lf = get_listings_file(config["city"], config["listing_type"])
        if lf.exists():
            return "ready"

    if LISTINGS_FILE.exists():
        return "ready"

    return "setup_needed"
