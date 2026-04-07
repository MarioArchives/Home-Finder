"""Shared configuration, path helpers, and environment loading."""

import json
import os
import threading
from pathlib import Path


def _load_dotenv():
    """Load .env file from the project root if it exists."""
    env_path = Path(__file__).parent.parent / ".env"
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

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))
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
setup_lock = threading.Lock()


def load_telegram_env():
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
