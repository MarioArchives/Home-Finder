"""Route handlers for /api/setup and /api/status endpoints."""

import copy
import json
import threading
import time

from .config import setup_state, setup_preferences, setup_lock, get_status, get_config
from .setup import run_setup
from .data_store import load_chats

from . import config as cfg

# Late path-aware import: when the server runs from /app, providers/ is on
# PYTHONPATH; when imported here it resolves the same registry module used by
# scrape_listings.py.
from providers import valid_source_values, list_provider_meta


def handle_status(handler):
    status = get_status()
    chats = load_chats()
    body = {
        "status": status,
        "telegram_configured": bool(cfg.TELEGRAM_BOT_TOKEN and (cfg.TELEGRAM_CHAT_ID or chats)),
    }
    if status in ("scraping", "amenities"):
        with setup_lock:
            body["progress"] = copy.deepcopy(setup_state["progress"])
    elif status == "ready":
        body["config"] = get_config()
    handler._json_response(200, body)


def handle_setup_post(handler, body):
    with setup_lock:
        if setup_state["phase"] in ("scraping", "amenities"):
            handler._json_response(409, {"error": "Setup already in progress"})
            return

    city = body.get("city", "").strip()
    listing_type = body.get("type", "rent")
    source = body.get("source", "rightmove")
    pages = int(body.get("pages", 5))

    if not city:
        handler._json_response(400, {"error": "City is required"})
        return
    if listing_type not in ("rent", "buy"):
        handler._json_response(400, {"error": "Type must be 'rent' or 'buy'"})
        return
    if source not in valid_source_values():
        allowed = sorted(valid_source_values())
        handler._json_response(400, {"error": f"Source must be one of: {', '.join(allowed)}"})
        return

    with setup_lock:
        setup_preferences["amenities"] = "climbing"
        setup_preferences["pin_data"] = None
        setup_preferences["submitted"] = False

    thread = threading.Thread(
        target=run_setup,
        args=(city, listing_type, source, pages),
        daemon=True,
    )
    thread.start()
    handler._json_response(201, {"ok": True})


def handle_setup_preferences(handler, body):
    with setup_lock:
        if setup_state["phase"] not in ("scraping", "amenities"):
            handler._json_response(409, {"error": "No setup in progress"})
            return

    amenities = body.get("amenities", "climbing")
    pin_data = body.get("pin_data")

    with setup_lock:
        setup_preferences["amenities"] = amenities
        setup_preferences["pin_data"] = pin_data
        setup_preferences["submitted"] = True

    handler._json_response(200, {"ok": True})


def handle_sources(handler):
    """Return the live registry of listing providers + UI metadata."""
    handler._json_response(200, {"sources": list_provider_meta()})


def handle_setup_progress(handler):
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "keep-alive")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()
    last_sent = None
    try:
        while True:
            with setup_lock:
                snapshot = {
                    "phase": setup_state["phase"],
                    "error": setup_state.get("error"),
                    "preferences_submitted": setup_preferences["submitted"],
                    **copy.deepcopy(setup_state["progress"]),
                }
            current = json.dumps(snapshot)
            if current != last_sent:
                handler.wfile.write(f"data: {current}\n\n".encode())
                handler.wfile.flush()
                last_sent = current
            if snapshot["phase"] in ("complete", "error", None):
                break
            time.sleep(1)
    except (BrokenPipeError, ConnectionResetError):
        pass
