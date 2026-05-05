# FastAPI migration plan

## Why migrate

The current server uses `http.server.ThreadingHTTPServer` with hand-rolled
routing in `server.py`. It works, but it leaves real gaps that the reviewer
flagged:

- No graceful shutdown — SIGTERM kills mid-request.
- No request-size cap — `Content-Length: huge` will OOM the process.
- No body validation — every handler re-implements "decode JSON, return 400".
- No CORS layer (fine for localhost, but invisible).
- SSE for `/api/setup/progress` is hand-coded.
- Each route is wired manually in a long `if/elif` chain.

FastAPI gives all of these for free, plus auto-generated OpenAPI docs at
`/docs` (a credibility boost for a portfolio project) and Pydantic-validated
request bodies that delete the `_read_json_body` boilerplate.

## What we are NOT changing

- The data layer (`data_store.py`, JSON-on-disk, atomic writes) stays as is.
- The provider system (`providers/*`) is untouched — it's a CLI tool
  invoked via subprocess from `setup.py`.
- The cron + scrape pipeline (`cron/run_stage.py`, `scrape_listings.py`)
  is unrelated.
- The Telegram listener thread (`telegram_listener.py`) keeps running
  alongside the server — it's a long-poll worker, not an HTTP handler.
- The React UI does not change. All endpoints keep the same paths,
  methods, and JSON shapes.

## Route inventory (10 endpoints to port)

| Method | Path                              | Current handler                      | Notes                              |
|--------|-----------------------------------|--------------------------------------|------------------------------------|
| GET    | `/api/status`                     | `routes_setup.handle_status`         | Trivial JSON                        |
| GET    | `/api/sources`                    | `routes_setup.handle_sources`        | Trivial JSON                        |
| GET    | `/api/setup/progress`             | `routes_setup.handle_setup_progress` | **SSE stream** — needs `EventSourceResponse` |
| GET    | `/api/alerts`                     | `routes_alerts.handle_alerts_get`    |                                    |
| POST   | `/api/alerts`                     | `routes_alerts.handle_alerts_post`   | Body schema                         |
| PUT    | `/api/alerts/{id}`                | `routes_alerts.handle_alert_put`     | Body schema, path param             |
| DELETE | `/api/alerts/{id}`                | `routes_alerts.handle_alert_delete`  | Path param                          |
| POST   | `/api/alerts/{id}/test`           | `routes_alerts.handle_alert_test`    | Path param, no body                 |
| POST   | `/api/setup`                      | `routes_setup.handle_setup_post`     | Body schema                         |
| POST   | `/api/setup/preferences`          | `routes_setup.handle_setup_preferences` | Body schema                      |
| GET    | `/api/chats`                      | `routes_telegram.handle_chats_get`   |                                    |
| GET    | `/api/telegram/status`            | `routes_telegram.handle_telegram_status` |                               |
| POST   | `/api/telegram/setup`             | `routes_telegram.handle_telegram_setup` | Body schema                       |
| POST   | `/api/telegram/discover-chats`    | `routes_telegram.handle_discover_chats` | No body                          |
| POST   | `/api/telegram/add-chat`          | `routes_telegram.handle_add_chat`    | Body schema                         |
| GET    | `/api/cron/status`                | `routes_cron.handle_cron_status`     |                                    |
| GET    | `/*` (SPA fallback)               | `SimpleHTTPRequestHandler.do_GET`    | Serve `ui/dist/*`, fall back to `index.html` |

## Phased plan

### Phase 0 — prep (30 min)

- Add to `requirements.txt`:
  ```
  fastapi==0.121.0
  uvicorn[standard]==0.39.0
  sse-starlette==3.0.3
  ```
- Add `httpx` to `requirements-dev.txt` for FastAPI's `TestClient`.
- Add a smoke test `tests/test_server_health.py` that hits `/api/status`
  via `TestClient` — gives us a regression net before we change anything.

### Phase 1 — new server, same handlers (1 h)

The existing `routes_*.py` modules pass a `handler` object around and call
`handler._json_response(...)`. We don't want to rewrite all of them at
once. Instead:

1. Create `src/server_lib/app.py` with a FastAPI instance.
2. Add a tiny `LegacyHandlerAdapter` shim that gives the existing
   `handle_*` functions an object that quacks like the old
   `SimpleHTTPRequestHandler`:
   - `_json_response(status, data)` → store on the adapter.
   - `send_response`/`send_header`/`wfile.write` for SSE.
3. Wire each FastAPI route to call its `handle_*` function via the
   adapter, then convert the captured response into a FastAPI `Response`.
4. Replace `server.py`'s `main()` to launch `uvicorn.run(app, host=..., port=...)`
   with `lifespan` doing `load_telegram_env()` + `start_listener()`.

This is the minimum change that gets us graceful shutdown, request size
limits (Starlette config), and the OpenAPI surface.

### Phase 2 — convert handlers to native FastAPI (1.5 h, can be incremental)

Once the adapter is working, port handlers one at a time. Each becomes a
small function with Pydantic models. Example:

```python
# src/server_lib/app.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

class AlertCreate(BaseModel):
    name: str
    maxPrice: float | None = None
    minBedrooms: int | None = None
    # ... etc

alerts_router = APIRouter(prefix="/api/alerts")

@alerts_router.get("")
def list_alerts() -> list[dict]:
    return load_alerts()

@alerts_router.post("", status_code=201)
def create_alert(payload: AlertCreate) -> dict:
    alerts = load_alerts()
    alert = payload.model_dump(exclude_none=True)
    alert["id"] = str(uuid.uuid4())
    alerts.append(alert)
    save_alerts(alerts)
    sync_chat_subscriptions(alert["id"], payload.chatIds)
    return alert
```

Order to port (easiest first, riskiest last):

1. `/api/status`, `/api/sources`, `/api/cron/status` — trivial GETs.
2. `/api/chats`, `/api/telegram/status` — trivial GETs.
3. `/api/alerts` GET/POST/PUT/DELETE — bulk of the user-facing surface.
4. `/api/alerts/{id}/test` — depends on listings file.
5. `/api/telegram/*` POSTs — each does a network call to Telegram.
6. `/api/setup`, `/api/setup/preferences` — touches shared `setup_state`.
7. **`/api/setup/progress` SSE** — last and trickiest. Use
   `sse_starlette.EventSourceResponse` with an async generator:
   ```python
   async def progress_stream():
       last_sent = None
       while True:
           snapshot = _snapshot_setup_state()  # uses the existing lock
           payload = json.dumps(snapshot)
           if payload != last_sent:
               yield {"data": payload}
               last_sent = payload
           if snapshot["phase"] in ("complete", "error", None):
               break
           await asyncio.sleep(1)
   ```

### Phase 3 — static files + SPA fallback (15 min)

```python
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app.mount("/assets", StaticFiles(directory=ui_dir / "assets"), name="assets")

@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str):
    candidate = ui_dir / full_path
    if candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(ui_dir / "index.html")
```

Make sure this is registered **after** all `/api/*` routes so it doesn't
shadow them. Symlinks (`listings.json`, `amenities.json`) work as
regular files through `FileResponse`.

### Phase 4 — operational polish (30 min)

- Request size limit: `app.add_middleware(LimitRequestSize, max_bytes=1_000_000)`
  (or use Starlette's built-in via uvicorn's `--h11-max-incomplete-event-size`).
- Graceful shutdown: uvicorn handles SIGTERM correctly out of the box —
  remove the manual `server.serve_forever()` in `server.py`.
- Drop `LegacyHandlerAdapter` once all routes are ported.
- Update `Dockerfile` `CMD` to call `uvicorn server_lib.app:app --host 0.0.0.0 --port 8080`.
- Optional: enable FastAPI's `/docs` only when `DEBUG=1` so it isn't
  exposed in production by default.

### Phase 5 — tests + CI (30 min)

- Add `tests/test_routes.py` using `TestClient`:
  - `/api/status` returns expected shape.
  - `/api/alerts` round-trip: POST → GET → DELETE.
  - `/api/alerts` POST with invalid JSON returns 422 (auto-validation).
- The existing `tests/test_alert_filter.py` and `tests/test_dedupe.py`
  don't change — they import the pure-logic modules directly.
- Update `.github/workflows/ci.yml` if FastAPI is added to the install step
  (already covered if we use `requirements-dev.txt`).

## Risks & mitigations

| Risk                                          | Mitigation                                                                |
|-----------------------------------------------|---------------------------------------------------------------------------|
| SSE behaves differently under uvicorn         | Smoke-test setup flow end-to-end before merging Phase 2.                  |
| `setup_state` module-globals + async handlers | Keep using `threading.Lock` (it's fine inside `run_in_threadpool`). Don't rush a state-class refactor into this PR. |
| Subprocess scraper currently inherits cwd / env | `os.chdir(directory)` is called in `main()`. Move that into uvicorn's `lifespan` startup hook. |
| Static-file serving order                     | Register the SPA-fallback route last, integration-test a few `/api/*` paths to confirm. |
| `telegram_listener` thread + uvicorn          | Already a daemon thread, started once. Move `start_listener()` into `lifespan` startup. |
| Dockerfile cron jobs assume `python server.py` | Cron jobs call `scrape_listings.py` and `fetch_amenities.py` directly, not the server — unaffected. |

## Estimated total

~4 hours, splittable into reviewable PRs:

1. **PR 1 (Phase 0–1)**: FastAPI server with adapter, all routes still go
   through `handle_*` functions. Should be a behavioural no-op.
2. **PR 2 (Phase 2)**: Port handlers to native FastAPI + Pydantic. Each
   handler becomes a few lines.
3. **PR 3 (Phase 3–5)**: Static files, polish, tests, Dockerfile.

Splitting like this means PR 1 alone gives us graceful shutdown, request
limits, and OpenAPI — even if the rest stalls, we've banked the safety
wins.

## Out of scope (future)

- Auth / API keys (still single-user, behind a reverse proxy if remote).
- Replacing JSON-on-disk with SQLite (separate decision; FastAPI doesn't
  push us toward it).
- Migrating to a single `TelegramClient` class — worth doing, but not
  coupled to the framework migration.
- Refactoring `setup_state` module-globals into a class — also worth
  doing separately, after the framework migration settles.
