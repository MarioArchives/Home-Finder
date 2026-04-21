"""Route handler for /api/cron/status — cron job progress for UI footer."""

import os
import re
from pathlib import Path

from .config import DATA_DIR, get_config, get_listings_file


# Map a command line fragment to a display job name.
_JOB_PATTERNS = (
    ("scrape_listings", "scrape"),
    ("check_new_listings", "alerts"),
    ("fetch_amenities", "amenities"),
)


def _running_job() -> str | None:
    """Scan /proc for a live scrape/alert/amenities process.

    Returns the job name if one is running, else None. Uses /proc directly
    because ps is not installed in the python:3.13-slim base image.
    """
    try:
        entries = os.listdir("/proc")
    except FileNotFoundError:
        return None
    for entry in entries:
        if not entry.isdigit():
            continue
        cmdline_path = Path("/proc") / entry / "cmdline"
        try:
            cmd = cmdline_path.read_bytes().replace(b"\x00", b" ").decode(errors="replace")
        except (FileNotFoundError, PermissionError):
            continue
        for needle, job in _JOB_PATTERNS:
            if needle in cmd:
                return job
    return None


def _tail_lines(path: Path, n: int = 50) -> list[str]:
    """Return the last n non-empty lines of a file. Cheap enough for small logs."""
    if not path.exists():
        return []
    try:
        # Log tops out around a few MB; reading the tail by chunk keeps it
        # constant memory for larger files.
        size = path.stat().st_size
        with path.open("rb") as f:
            if size > 65536:
                f.seek(-65536, os.SEEK_END)
            data = f.read()
        text = data.decode(errors="replace")
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        return lines[-n:]
    except OSError:
        return []


# Match "[source] [i/total] Address..." — from the scrape detail progress.
_DETAIL_RE = re.compile(r"\[(\w+)\] \[(\d+)/(\d+)\]")
# Match "[source] Fetching page N..."
_PAGE_RE = re.compile(r"\[(\w+)\] Fetching page (\d+)\.\.\.")
# Match "[source] Page N: X listings (total: Y)"
_PAGE_DONE_RE = re.compile(r"\[(\w+)\] Page (\d+): (\d+) listings.*\(total: (\d+)\)")
# Match "[source] Collected N listings total." — provider is fully done.
_COLLECTED_RE = re.compile(r"\[(\w+)\] Collected (\d+) listings total\.")


def _total_pages() -> int:
    """Read PAGES from .env.cron; fall back to 5."""
    env_file = DATA_DIR / ".env.cron"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("export PAGES=") or line.startswith("PAGES="):
                try:
                    return int(line.split("=", 1)[1].strip())
                except (ValueError, IndexError):
                    pass
    return int(os.environ.get("PAGES", "5"))


def _scrape_progress(job: str | None) -> dict:
    """Build per-source progress state by walking recent cron.log lines.

    Returns percent (0-100) plus a per-source breakdown. Without a running job
    we still scan so the UI can fall back to the last known state if needed.
    """
    if job is None:
        return {"percent": None, "sources": {}}

    total_pages = _total_pages()
    lines = _tail_lines(DATA_DIR / "cron.log", n=500)
    sources: dict[str, dict] = {}

    def _touch(name: str) -> dict:
        return sources.setdefault(
            name,
            {"pages_done": 0, "detail_current": 0, "detail_total": 0},
        )

    # Walk forward so later lines overwrite earlier ones — captures current
    # state without needing per-session scoping.
    for line in lines:
        m = _COLLECTED_RE.search(line)
        if m:
            s = _touch(m.group(1))
            s["pages_done"] = total_pages
            s["detail_current"] = 0
            s["detail_total"] = 0
            continue
        m = _PAGE_DONE_RE.search(line)
        if m:
            s = _touch(m.group(1))
            s["pages_done"] = int(m.group(2))
            s["detail_current"] = 0
            s["detail_total"] = 0
            continue
        m = _PAGE_RE.search(line)
        if m:
            s = _touch(m.group(1))
            s["detail_current"] = 0
            s["detail_total"] = 0
            continue
        m = _DETAIL_RE.search(line)
        if m:
            s = _touch(m.group(1))
            s["detail_current"] = int(m.group(2))
            s["detail_total"] = int(m.group(3))

    if not sources:
        return {"percent": 0, "sources": {}, "total_pages": total_pages}

    per_source = {}
    total_pct = 0.0
    for name, s in sources.items():
        pages_done = s["pages_done"]
        dc = s["detail_current"]
        dt = s["detail_total"]
        partial = (dc / dt) if dt else 0
        pct = ((pages_done + partial) / total_pages) * 100 if total_pages else 0
        pct = max(0.0, min(100.0, pct))
        per_source[name] = {
            "pages_done": pages_done,
            "total_pages": total_pages,
            "detail_current": dc,
            "detail_total": dt,
            "percent": round(pct, 1),
        }
        total_pct += pct

    return {
        "percent": round(total_pct / len(sources), 1),
        "sources": per_source,
        "total_pages": total_pages,
    }


def _last_scrape_mtime() -> str | None:
    cfg = get_config()
    if not cfg:
        return None
    lf = get_listings_file(cfg.get("city"), cfg.get("listing_type"))
    if not lf.exists():
        return None
    try:
        return _iso_from_epoch(lf.stat().st_mtime)
    except OSError:
        return None


def _iso_from_epoch(ts: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def handle_cron_status(handler):
    job = _running_job()
    payload = {
        "running": bool(job),
        "job": job,
        "last_scrape": _last_scrape_mtime(),
        **_scrape_progress(job),
    }
    handler._json_response(200, payload)
