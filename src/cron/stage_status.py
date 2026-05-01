"""Per-stage status tracking for the chained cron pipeline.

Writes to `<data>/.stage_status.json`. Read by `routes_cron.py` to surface
state in `/api/cron/status` so the UI footer can show "amenities failing:
Overpass 504 (3 attempts)" instead of pretending everything is fine.

Stages: scrape → amenities → alerts.

State machine per stage:
  pending  — not yet attempted today
  ok       — succeeded today
  failing  — attempted today, last attempt failed, sweep window still open
  stale    — failed all sweep attempts (recovery window closed)
"""

import datetime as _dt
import json
from typing import Iterable

from server_lib.config import DATA_DIR


STATUS_FILE = DATA_DIR / ".stage_status.json"

STAGES = ("scrape", "amenities", "alerts")


def _now_iso() -> str:
    return _dt.datetime.now().astimezone().isoformat(timespec="seconds")


def _today_local() -> _dt.date:
    return _dt.datetime.now().astimezone().date()


def _empty_stage() -> dict:
    return {
        "last_ok": None,
        "last_attempt": None,
        "last_error": None,
        "attempts_today": 0,
        "state": "pending",
    }


def _new_status() -> dict:
    return {
        "date": _today_local().isoformat(),
        "stages": {s: _empty_stage() for s in STAGES},
    }


def load_status() -> dict:
    """Read status file, resetting per-day counters if the date rolled over.

    Preserves `last_ok` across days (so the UI can still show "scrape: ok
    (yesterday)" before today's run completes), but resets `attempts_today`,
    `last_error`, and `state` to "pending".
    """
    if not STATUS_FILE.exists():
        return _new_status()
    try:
        data = json.loads(STATUS_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return _new_status()

    today = _today_local().isoformat()
    if data.get("date") != today:
        rolled = _new_status()
        for s in STAGES:
            prev = data.get("stages", {}).get(s, {})
            rolled["stages"][s]["last_ok"] = prev.get("last_ok")
        return rolled

    # Backfill missing keys for forward-compatibility.
    for s in STAGES:
        data.setdefault("stages", {}).setdefault(s, _empty_stage())
        for k, v in _empty_stage().items():
            data["stages"][s].setdefault(k, v)
    return data


def save_status(status: dict) -> None:
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATUS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(status, indent=2))
    tmp.replace(STATUS_FILE)


def record_attempt(stage: str) -> dict:
    status = load_status()
    s = status["stages"][stage]
    s["last_attempt"] = _now_iso()
    s["attempts_today"] = int(s.get("attempts_today", 0)) + 1
    save_status(status)
    return status


def record_success(stage: str) -> dict:
    status = load_status()
    s = status["stages"][stage]
    s["last_ok"] = _now_iso()
    s["last_error"] = None
    s["state"] = "ok"
    save_status(status)
    return status


def record_failure(stage: str, error: str) -> dict:
    status = load_status()
    s = status["stages"][stage]
    s["last_error"] = (error or "").strip()[:500] or "unknown error"
    s["state"] = "failing"
    save_status(status)
    return status


def mark_stale(stages: Iterable[str]) -> dict:
    status = load_status()
    for stage in stages:
        s = status["stages"][stage]
        if s["state"] == "failing":
            s["state"] = "stale"
    save_status(status)
    return status


def summary_line(status: dict) -> str | None:
    """Single-line human summary for the UI footer.

    None when every stage is `ok` (footer falls back to "Up to date").
    """
    stages = status.get("stages", {})
    failing = [n for n, s in stages.items() if s.get("state") == "failing"]
    stale = [n for n, s in stages.items() if s.get("state") == "stale"]
    pending = [n for n, s in stages.items() if s.get("state") == "pending"]

    if stale:
        n = stale[0]
        s = stages[n]
        err = s.get("last_error") or "no successful run today"
        return f"{n} failed today: {err}"
    if failing:
        n = failing[0]
        s = stages[n]
        attempts = s.get("attempts_today", 0)
        err = s.get("last_error") or "unknown error"
        return f"{n} failing: {err} ({attempts} attempt{'s' if attempts != 1 else ''})"
    if pending:
        # Only flag pending stages outside the run window — during the daily
        # 09:00 fire it's expected for downstream stages to still be pending.
        return None
    return None
