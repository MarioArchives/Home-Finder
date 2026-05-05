"""Pure handlers for /api/setup and /api/status — wired into FastAPI in app.py."""

import asyncio
import copy
import json
import threading

from fastapi import HTTPException

from .config import setup_state, setup_preferences, setup_lock, get_status, get_config
from .setup import run_setup
from .data_store import load_chats

from . import config as cfg

# Late path-aware import: when the server runs from /app, providers/ is on
# PYTHONPATH; when imported here it resolves the same registry module used by
# scrape_listings.py.
from providers import valid_source_values, list_provider_meta


def status_payload() -> dict:
    status = get_status()
    chats = load_chats()
    body: dict = {
        "status": status,
        "telegram_configured": bool(cfg.TELEGRAM_BOT_TOKEN and (cfg.TELEGRAM_CHAT_ID or chats)),
    }
    if status in ("scraping", "amenities"):
        with setup_lock:
            body["progress"] = copy.deepcopy(setup_state["progress"])
    elif status == "ready":
        body["config"] = get_config()
    return body


def start_setup(city: str, listing_type: str, source: str, pages: int) -> dict:
    with setup_lock:
        if setup_state["phase"] in ("scraping", "amenities"):
            raise HTTPException(status_code=409, detail="Setup already in progress")

    if not city:
        raise HTTPException(status_code=400, detail="City is required")
    if listing_type not in ("rent", "buy"):
        raise HTTPException(status_code=400, detail="Type must be 'rent' or 'buy'")
    if source not in valid_source_values():
        allowed = sorted(valid_source_values())
        raise HTTPException(
            status_code=400,
            detail=f"Source must be one of: {', '.join(allowed)}",
        )

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
    return {"ok": True}


def submit_preferences(amenities: str, pin_data) -> dict:
    with setup_lock:
        if setup_state["phase"] not in ("scraping", "amenities"):
            raise HTTPException(status_code=409, detail="No setup in progress")
        setup_preferences["amenities"] = amenities
        setup_preferences["pin_data"] = pin_data
        setup_preferences["submitted"] = True
    return {"ok": True}


def list_sources() -> dict:
    """Live registry of listing providers + UI metadata."""
    return {"sources": list_provider_meta()}


def _snapshot_setup_state() -> dict:
    with setup_lock:
        return {
            "phase": setup_state["phase"],
            "error": setup_state.get("error"),
            "preferences_submitted": setup_preferences["submitted"],
            **copy.deepcopy(setup_state["progress"]),
        }


async def setup_progress_events():
    """Async generator for SSE — yields {"data": json} on every state change.

    Terminates when the setup phase reaches a terminal state (complete/error)
    or is cleared. sse-starlette serialises each yielded dict into a proper
    `event: ...\\ndata: ...\\n\\n` frame.
    """
    last_sent = None
    while True:
        snapshot = _snapshot_setup_state()
        payload = json.dumps(snapshot)
        if payload != last_sent:
            yield {"data": payload}
            last_sent = payload
        if snapshot["phase"] in ("complete", "error", None):
            break
        await asyncio.sleep(1)
