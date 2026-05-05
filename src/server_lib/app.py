"""FastAPI application — wires pure handlers to HTTP routes.

The app instance is import-safe (no side effects beyond defining routes).
`server.py` sets `cfg.ui_dir` to the built React `dist/` and launches uvicorn.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict
from sse_starlette.sse import EventSourceResponse

from . import config as cfg
from .config import load_telegram_env
from .telegram_listener import start_listener

from .routes_setup import (
    status_payload, start_setup, submit_preferences,
    list_sources, setup_progress_events,
)
from .routes_alerts import (
    list_alerts_with_subscribers, create_alert, update_alert,
    delete_alert, test_alert,
)
from .routes_telegram import (
    telegram_status_payload, list_chats, configure_telegram,
    discover_chats, add_chat,
)
from .routes_cron import cron_status_payload


# Cap incoming request bodies. The reviewer flagged that the old
# http.server would happily allocate `Content-Length` bytes — a malicious
# client could OOM the process by claiming a 10 GB body. 1 MB is generous
# for any of our actual payloads (alert configs, telegram setup form).
MAX_REQUEST_BYTES = 1_000_000


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Telegram credentials live in the data volume (.env.telegram), not in
    # the image — load them after the container has the volume mounted.
    load_telegram_env()
    # Daemon thread, idempotent — safe to call once on startup.
    start_listener()
    yield


# `/docs` is gated on DEBUG=1: useful for local exploration, off by default
# so the deployed instance doesn't advertise the API surface.
_docs_enabled = bool(os.environ.get("DEBUG"))

app = FastAPI(
    title="Property Listings API",
    version="1.0.0",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _docs_enabled else None,
    lifespan=lifespan,
)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl:
        try:
            if int(cl) > MAX_REQUEST_BYTES:
                return JSONResponse(
                    {"detail": "Request body too large"},
                    status_code=413,
                )
        except ValueError:
            return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
    return await call_next(request)


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class SetupRequest(BaseModel):
    city: str = ""
    type: str = "rent"
    source: str = "rightmove"
    pages: int = 5


class PreferencesRequest(BaseModel):
    amenities: str = "climbing"
    pin_data: dict | None = None


class TelegramSetupRequest(BaseModel):
    bot_token: str = ""
    chat_id: str = ""
    chat_name: str = ""


class AddChatRequest(BaseModel):
    chat_id: str | int = ""
    name: str = ""


class AlertPayload(BaseModel):
    """Loose schema — the React form sends a known set of fields, but every
    field is optional and can be null. We accept any extra keys to stay
    forward-compatible with UI changes (`extra='allow'`)."""

    model_config = ConfigDict(extra="allow")

    name: str | None = None
    minPrice: float | int | None = None
    maxPrice: float | int | None = None
    minBedrooms: int | None = None
    maxBedrooms: int | None = None
    minBathrooms: int | None = None
    source: str | None = None
    councilTaxBands: list[str] | None = None
    propertyTypes: list[str] | None = None
    furnishTypes: list[str] | None = None
    minSqFt: int | None = None
    maxSqFt: int | None = None
    availableFrom: str | None = None
    availableTo: str | None = None
    pinLat: float | None = None
    pinLng: float | None = None
    pinRadius: float | None = None
    excludeShares: bool = False
    search: str = ""
    chatIds: list[str] | None = None
    createdAt: str | None = None


# ---------------------------------------------------------------------------
# /api/setup + /api/status + /api/sources
# ---------------------------------------------------------------------------

@app.get("/api/status")
def api_status():
    return status_payload()


@app.get("/api/sources")
def api_sources():
    return list_sources()


@app.post("/api/setup", status_code=201)
def api_setup(payload: SetupRequest):
    return start_setup(
        city=payload.city.strip(),
        listing_type=payload.type,
        source=payload.source,
        pages=int(payload.pages),
    )


@app.post("/api/setup/preferences")
def api_setup_preferences(payload: PreferencesRequest):
    return submit_preferences(payload.amenities, payload.pin_data)


@app.get("/api/setup/progress")
async def api_setup_progress():
    # sse-starlette wraps the async generator in proper SSE framing and
    # handles client-disconnect cleanup, replacing the hand-coded loop.
    return EventSourceResponse(setup_progress_events())


# ---------------------------------------------------------------------------
# /api/alerts
# ---------------------------------------------------------------------------

@app.get("/api/alerts")
def api_alerts_get():
    return list_alerts_with_subscribers()


@app.post("/api/alerts", status_code=201)
def api_alerts_post(payload: AlertPayload):
    return create_alert(payload.model_dump())


@app.put("/api/alerts/{alert_id}")
def api_alert_put(alert_id: str, payload: AlertPayload):
    return update_alert(alert_id, payload.model_dump())


@app.delete("/api/alerts/{alert_id}")
def api_alert_delete(alert_id: str):
    return delete_alert(alert_id)


@app.post("/api/alerts/{alert_id}/test")
def api_alert_test(alert_id: str):
    return test_alert(alert_id)


# ---------------------------------------------------------------------------
# /api/telegram + /api/chats
# ---------------------------------------------------------------------------

@app.get("/api/chats")
def api_chats_get():
    return list_chats()


@app.get("/api/telegram/status")
def api_telegram_status():
    return telegram_status_payload()


@app.post("/api/telegram/setup")
def api_telegram_setup(payload: TelegramSetupRequest):
    return configure_telegram(payload.bot_token, payload.chat_id, payload.chat_name)


@app.post("/api/telegram/discover-chats")
def api_telegram_discover():
    return discover_chats()


@app.post("/api/telegram/add-chat", status_code=201)
def api_telegram_add_chat(payload: AddChatRequest):
    return add_chat(payload.chat_id, payload.name)


# ---------------------------------------------------------------------------
# /api/cron
# ---------------------------------------------------------------------------

@app.get("/api/cron/status")
def api_cron_status():
    return cron_status_payload()


# ---------------------------------------------------------------------------
# SPA fallback — must be registered LAST so /api/* paths take precedence.
# ---------------------------------------------------------------------------

@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str):
    """Serve files from the built React `dist/` directory; fall back to
    `index.html` for any path that isn't an existing file (so React Router
    handles it client-side).

    Returns 404 only for `/api/*` so unknown API paths don't get the SPA
    shell — those need to fail loudly instead of silently rendering the UI.
    """
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    # Reject `..` segments lexically. We can't use .resolve() for the safety
    # check because the entrypoint symlinks listings.json / amenities.json
    # from ui_dir into /app/data — resolving those symlinks would push them
    # outside ui_dir and trip a false-positive traversal block.
    if ".." in Path(full_path).parts:
        raise HTTPException(status_code=404)

    base = cfg.ui_dir
    if full_path:
        candidate = base / full_path
        if candidate.is_file():
            return FileResponse(candidate)
    index = base / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="UI not built")
