"""Route handler for /api/cron/status — cron job progress for UI footer."""

import datetime as _dt
import os
import re
from pathlib import Path

from .config import DATA_DIR, get_config, get_listings_file
from cron.stage_status import load_status, summary_line


CRONTAB_FILE = Path("/etc/cron.d/property-update")


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
        # `pages_done` is set when the page is *parsed*, but detail fetches
        # for that same page happen afterwards. Treat detail progress as
        # sub-progress within the current page (pages_done - 1 + dc/dt) so
        # the bar doesn't pin at 100% while details are still running.
        if dt > 0:
            completed = max(0.0, pages_done - 1) + (dc / dt)
        else:
            completed = pages_done
        pct = (completed / total_pages) * 100 if total_pages else 0
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
    # Local tz so timestamps in the UI match the cron schedule (which fires
    # in container-local time, Europe/London via TZ env).
    from datetime import datetime
    return datetime.fromtimestamp(ts).astimezone().isoformat()


def _parse_cron_field(token: str, lo: int, hi: int) -> set[int]:
    """Parse a cron field. Supports '*', integers, ranges (10-14), and steps.

    Comma-separated combinations work too: '0,30 9-17/2'. Anything that
    fails to parse is silently dropped — install_cron is the only writer of
    the crontab so unexpected syntax is unlikely in practice.
    """
    if token == "*":
        return set(range(lo, hi + 1))

    def parse_part(part: str) -> set[int]:
        # Handle step syntax: "<range>/<step>" e.g. "*/30", "10-14/2".
        step = 1
        if "/" in part:
            base, _, step_s = part.partition("/")
            try:
                step = int(step_s)
            except ValueError:
                return set()
        else:
            base = part
        if base == "*":
            start, end = lo, hi
        elif "-" in base:
            a, _, b = base.partition("-")
            try:
                start, end = int(a), int(b)
            except ValueError:
                return set()
        else:
            try:
                v = int(base)
                return {v}
            except ValueError:
                return set()
        return set(range(start, end + 1, max(1, step)))

    out: set[int] = set()
    for part in token.split(","):
        out |= parse_part(part)
    return out


_JOB_LABELS = (
    ("scrape_listings.py", "scrape"),
    ("alerts.check_new_listings", "alerts"),
    ("fetch_amenities.py", "amenities"),
)


def _label_for_command(command: str) -> str | None:
    """Map a cron command line to a UI-friendly job label.

    The pipeline cron lines invoke `cron.run_stage` rather than the
    underlying scripts directly. `--stage scrape` resolves to "scrape", and
    `--recover` (with optional `--final`) is shown as "recovery sweep" so
    the next-runs list distinguishes the primary chain trigger from the
    hourly sweeps.
    """
    if "cron.run_stage" in command:
        m = re.search(r"--stage\s+(\w+)", command)
        if m and m.group(1) in ("scrape", "amenities", "alerts"):
            return m.group(1)
        if "--recover" in command:
            return "recovery"
    for needle, label in _JOB_LABELS:
        if needle in command:
            return label
    return None


def _next_fire(minute: str, hour: str, dom: str, month: str, dow: str,
               now: _dt.datetime) -> _dt.datetime | None:
    minutes = _parse_cron_field(minute, 0, 59)
    hours = _parse_cron_field(hour, 0, 23)
    doms = _parse_cron_field(dom, 1, 31)
    months = _parse_cron_field(month, 1, 12)
    # Cron weekday: 0=Sunday..6=Saturday. Python weekday(): 0=Monday..6=Sunday.
    dows = _parse_cron_field(dow, 0, 6)

    candidate = (now + _dt.timedelta(minutes=1)).replace(second=0, microsecond=0)
    for _ in range(8 * 24 * 60):
        cron_dow = (candidate.weekday() + 1) % 7
        if (candidate.minute in minutes and candidate.hour in hours
                and candidate.day in doms and candidate.month in months
                and cron_dow in dows):
            return candidate
        candidate += _dt.timedelta(minutes=1)
    return None


def next_runs() -> list[dict]:
    """Parse the installed crontab and return upcoming run times per job.

    Returns [{job, schedule, next_iso, next_epoch}, ...] sorted by soonest.
    Empty when crontab file missing (e.g. local dev outside the container).
    """
    if not CRONTAB_FILE.exists():
        return []
    # Use system-local time so cron field interpretation matches what cron
    # itself sees (TZ=Europe/London is set in the Dockerfile).
    now = _dt.datetime.now().astimezone()
    results: list[dict] = []
    for line in CRONTAB_FILE.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # Skip env assignment lines like "PATH=/usr/local/bin:..."
        head = stripped.split(None, 1)[0]
        if "=" in head:
            continue
        parts = stripped.split(None, 5)
        if len(parts) < 6:
            continue
        minute, hour, dom, month, dow, command = parts
        label = _label_for_command(command)
        if not label:
            continue
        nxt = _next_fire(minute, hour, dom, month, dow, now)
        if not nxt:
            continue
        results.append({
            "job": label,
            "schedule": f"{minute} {hour} {dom} {month} {dow}",
            "next_iso": nxt.isoformat(),
            "next_epoch": nxt.timestamp(),
        })
    results.sort(key=lambda r: r["next_epoch"])
    return results


def cron_status_payload() -> dict:
    job = _running_job()
    status = load_status()
    return {
        "running": bool(job),
        "job": job,
        "last_scrape": _last_scrape_mtime(),
        "next_runs": next_runs(),
        "stages": status.get("stages", {}),
        "status_summary": summary_line(status),
        **_scrape_progress(job),
    }
