"""Telegram long-poll listener thread.

Handles incoming bot commands (/status, /scrape). Restricted to chat IDs
already registered in chat_ids.json — unknown senders are ignored silently.
"""

import datetime as _dt
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import config as cfg
from .config import DATA_DIR
from .data_store import load_chats, send_telegram
from .routes_cron import _running_job, _scrape_progress, _last_scrape_mtime, next_runs

_OFFSET_FILE = DATA_DIR / "telegram_offset.txt"
_LONG_POLL_TIMEOUT = 30
_started = False
# /app/src — same dir cron uses to invoke `python -m cron.run_stage`.
_SRC_DIR = Path(__file__).resolve().parent.parent


def _load_offset() -> int:
    try:
        return int(_OFFSET_FILE.read_text().strip())
    except (FileNotFoundError, ValueError, OSError):
        return 0


def _save_offset(offset: int) -> None:
    try:
        _OFFSET_FILE.write_text(str(offset))
    except OSError as e:
        print(f"[telegram-listener] could not save offset: {e}", flush=True)


def _format_relative(target_epoch: float, now_epoch: float) -> str:
    total = int(target_epoch - now_epoch)
    if total <= 0:
        return "imminent"
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    mins = rem // 60
    parts: list[str] = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    if mins or not parts:
        parts.append(f"{mins}m")
    return " ".join(parts)


def _format_status() -> str:
    job = _running_job()
    progress = _scrape_progress(job)
    last = _last_scrape_mtime()
    upcoming = next_runs()

    lines: list[str] = []
    if job:
        lines.append(f"🟢 <b>{job}</b> in progress")
        pct = progress.get("percent")
        if pct is not None:
            lines.append(f"Overall: {pct}%")
        sources = progress.get("sources") or {}
        for name, s in sources.items():
            detail = ""
            if s.get("detail_total"):
                detail = f", {s['detail_current']}/{s['detail_total']}"
            lines.append(
                f"  • {name}: {s['percent']}% "
                f"(page {s['pages_done']}/{s['total_pages']}{detail})"
            )
        if last:
            lines.append(f"\nLast scrape: {last}")
    elif last:
        lines.append(f"⚪ Idle.\nLast scrape: {last}")
    else:
        lines.append("⚪ Idle. No scrape on record yet.")

    if upcoming:
        now_epoch = _dt.datetime.now(_dt.timezone.utc).timestamp()
        lines.append("\n<b>Next runs (UTC):</b>")
        for run in upcoming:
            rel = _format_relative(run["next_epoch"], now_epoch)
            when = run["next_iso"].replace("+00:00", "Z")
            lines.append(f"  • {run['job']}: {when} (in {rel})")

    return "\n".join(lines)


def _allowed_chat_ids() -> set[str]:
    return {str(c["chat_id"]) for c in load_chats()}


def _trigger_pipeline() -> tuple[bool, str]:
    """Kick off scrape→amenities→alerts as a detached child process.

    Returns (started, reason). Refuses if a pipeline stage is already in
    flight — `_running_job()` scans /proc for live scrape/amenities/alerts
    cmdlines, so we get a useful reply instead of silently colliding with
    the per-stage flock inside run_stage.
    """
    job = _running_job()
    if job:
        return False, f"{job} already running"
    env = os.environ.copy()
    pp = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{_SRC_DIR}:{pp}" if pp else str(_SRC_DIR)
    subprocess.Popen(
        [sys.executable, "-m", "cron.run_stage", "--stage", "scrape", "--force"],
        cwd=str(_SRC_DIR),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return True, ""


def _handle_command(text: str, chat_id: str) -> None:
    parts = text.strip().split()
    if not parts:
        return
    # Strip @botname suffix that group chats append (e.g. "/status@MyBot").
    cmd = parts[0].split("@", 1)[0].lower()
    if cmd == "/status":
        send_telegram(_format_status(), chat_id=chat_id)
    elif cmd == "/scrape":
        started, reason = _trigger_pipeline()
        if started:
            send_telegram(
                "🚀 <b>Pipeline started</b>: scrape → amenities → alerts.\n"
                "Use /status for progress.",
                chat_id=chat_id,
            )
        else:
            send_telegram(
                f"⚠️ Cannot start: {reason}.\nUse /status.",
                chat_id=chat_id,
            )


def _process_update(update: dict) -> None:
    msg = update.get("message") or update.get("edited_message")
    if not isinstance(msg, dict):
        return
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    text = msg.get("text") or ""
    if chat_id is None or not text:
        return
    cid = str(chat_id)
    if cid not in _allowed_chat_ids():
        return
    _handle_command(text, cid)


def _poll_once(offset: int) -> int:
    url = (
        f"https://api.telegram.org/bot{cfg.TELEGRAM_BOT_TOKEN}/getUpdates"
        f"?timeout={_LONG_POLL_TIMEOUT}&offset={offset}"
    )
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=_LONG_POLL_TIMEOUT + 10) as resp:
        data = json.loads(resp.read().decode())
    if not data.get("ok"):
        return offset
    next_offset = offset
    for update in data.get("result", []):
        uid = update.get("update_id")
        if uid is not None and uid + 1 > next_offset:
            next_offset = uid + 1
        try:
            _process_update(update)
        except Exception as e:
            print(f"[telegram-listener] handler error: {type(e).__name__}: {e}", flush=True)
    if next_offset != offset:
        _save_offset(next_offset)
    return next_offset


def _run() -> None:
    offset = _load_offset()
    while True:
        if not cfg.TELEGRAM_BOT_TOKEN:
            time.sleep(30)
            continue
        try:
            offset = _poll_once(offset)
        except urllib.error.URLError as e:
            print(f"[telegram-listener] network error: {e}", flush=True)
            time.sleep(5)
        except Exception as e:
            print(f"[telegram-listener] unexpected error: {type(e).__name__}: {e}", flush=True)
            time.sleep(5)


def start_listener() -> None:
    """Spawn the long-poll thread. Idempotent within a process."""
    global _started
    if _started:
        return
    _started = True
    t = threading.Thread(target=_run, name="telegram-listener", daemon=True)
    t.start()
    print("[telegram-listener] started", flush=True)
