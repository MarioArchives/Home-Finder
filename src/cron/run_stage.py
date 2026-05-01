"""Cron stage runner: chained scrape → amenities → alerts pipeline.

Each stage is a subprocess invocation gated by per-stage idempotency markers
in the data directory:

    .scrape_done       — listings JSON refreshed today
    .amenities_done    — amenities JSON refreshed today
    .alerts_done       — alert checker ran successfully today
    .stage_status.json — structured per-stage state for /api/cron/status

Two entry points:

    --stage <name>     Run one stage. On success, fire-and-forget the next.
    --recover          Sweep all stages in order, running any that haven't
                       succeeded today (and whose prerequisites are met).
                       Used by hourly recovery cron + container boot
                       catch-up. Stops at the first failure so we don't
                       alert on broken upstream data, except on the final
                       sweep where alerts may fire with stale amenities.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as _dt
import errno
import fcntl
import os
import subprocess
import sys
from pathlib import Path

from server_lib.config import (
    DATA_DIR,
    get_config,
    get_listings_file,
)

from .stage_status import (
    STAGES,
    load_status,
    mark_stale,
    record_attempt,
    record_failure,
    record_success,
)


MARKERS = {
    "scrape": DATA_DIR / ".scrape_done",
    "amenities": DATA_DIR / ".amenities_done",
    "alerts": DATA_DIR / ".alerts_done",
}

LOCKS = {
    "scrape": DATA_DIR / ".scrape.lock",
    "amenities": DATA_DIR / ".amenities.lock",
    "alerts": DATA_DIR / ".alerts.lock",
}


@contextlib.contextmanager
def _stage_lock(stage: str):
    """Acquire a non-blocking exclusive lock for `stage`.

    Yields True if the caller holds the lock, False if another process
    already does (in which case the stage is in flight and we should skip
    rather than start a second copy that'd race on the same output files).
    The lock is released when the context exits, either via fcntl unlock or
    process death (kernel auto-releases flocks on exit).
    """
    LOCKS[stage].parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(LOCKS[stage], os.O_CREAT | os.O_RDWR, 0o644)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as e:
            if e.errno in (errno.EWOULDBLOCK, errno.EAGAIN):
                yield False
                return
            raise
        try:
            yield True
        finally:
            with contextlib.suppress(OSError):
                fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _today_local() -> _dt.date:
    return _dt.datetime.now().astimezone().date()


def _marker_fresh(stage: str) -> bool:
    p = MARKERS[stage]
    if not p.exists():
        return False
    try:
        mtime = _dt.datetime.fromtimestamp(p.stat().st_mtime).astimezone()
    except OSError:
        return False
    return mtime.date() == _today_local()


def _file_fresh_today(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        mtime = _dt.datetime.fromtimestamp(path.stat().st_mtime).astimezone()
    except OSError:
        return False
    return mtime.date() == _today_local()


def _env() -> dict:
    cfg = get_config() or {}
    return {
        "CITY": os.environ.get("CITY") or cfg.get("city", "Manchester"),
        "LISTING_TYPE": os.environ.get("LISTING_TYPE") or cfg.get("listing_type", "rent"),
        "SOURCE": os.environ.get("SOURCE") or cfg.get("source", "rightmove"),
        "PAGES": os.environ.get("PAGES") or str(cfg.get("pages", 5)),
        "AMENITIES": os.environ.get("AMENITIES") or cfg.get("amenities", "climbing"),
    }


def _log_path() -> Path:
    return DATA_DIR / "cron.log"


def _run(cmd: list[str], extra_env: dict | None = None) -> tuple[int, str]:
    """Run a command, tee output into cron.log, return (rc, last_line).

    last_line is used as the error blurb for `.stage_status.json` when the
    stage fails — the script's own final stderr/stdout is usually the most
    informative thing the UI can show.
    """
    env = os.environ.copy()
    env.update(extra_env or {})
    log = _log_path()
    log.parent.mkdir(parents=True, exist_ok=True)
    last_line = ""
    with log.open("a", encoding="utf-8") as fp:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            env=env, text=True, bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            fp.write(line)
            fp.flush()
            stripped = line.strip()
            if stripped:
                last_line = stripped
        rc = proc.wait()
    return rc, last_line


def _trigger_next(stage: str) -> None:
    """Fire the next stage as a detached child so the current process exits.

    This keeps each cron invocation single-stage from the OS's POV — handy
    for debugging and matches the `_running_job()` cmdline detection in
    routes_cron.py.
    """
    nxt_idx = STAGES.index(stage) + 1
    if nxt_idx >= len(STAGES):
        return
    nxt = STAGES[nxt_idx]
    subprocess.Popen(
        [sys.executable, "-m", "cron.run_stage", "--stage", nxt],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


# ---------------------------------------------------------------------------
# Stage implementations
# ---------------------------------------------------------------------------

def run_scrape(env: dict) -> tuple[int, str]:
    listings_file = get_listings_file(env["CITY"], env["LISTING_TYPE"])
    cmd = [
        sys.executable, "/app/src/scrape_listings.py",
        "--city", env["CITY"],
        "--type", env["LISTING_TYPE"],
        "--pages", env["PAGES"],
        "--source", env["SOURCE"],
        "--output", str(listings_file),
    ]
    return _run(cmd)


def run_amenities(env: dict) -> tuple[int, str]:
    listings_file = get_listings_file(env["CITY"], env["LISTING_TYPE"])
    if not listings_file.exists():
        return 1, f"listings file missing: {listings_file}"
    cmd = [
        sys.executable, "/app/src/fetch_amenities.py",
        "--amenities", env["AMENITIES"],
        str(listings_file),
    ]
    return _run(cmd)


def run_alerts(env: dict, allow_stale_amenities: bool = False) -> tuple[int, str]:
    listings_file = get_listings_file(env["CITY"], env["LISTING_TYPE"])
    if not listings_file.exists():
        return 1, f"listings file missing: {listings_file}"
    extra = {
        "ALERT_USE_EXISTING": "1",
        "ALERT_LISTINGS_FILE": str(listings_file),
    }
    if allow_stale_amenities:
        extra["ALERT_ALLOW_STALE_AMENITIES"] = "1"
    cmd = [sys.executable, "-m", "alerts.check_new_listings"]
    return _run(cmd, extra_env=extra)


STAGE_FNS = {
    "scrape": run_scrape,
    "amenities": run_amenities,
    "alerts": run_alerts,
}


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def _prereqs_met(stage: str) -> tuple[bool, str]:
    """Soft dependency check. Returns (ok, reason)."""
    if stage == "scrape":
        return True, ""
    cfg = get_config() or {}
    city = cfg.get("city")
    listing_type = cfg.get("listing_type")
    if stage == "amenities":
        lf = get_listings_file(city, listing_type)
        if not _file_fresh_today(lf):
            return False, f"listings not refreshed today ({lf.name})"
        return True, ""
    if stage == "alerts":
        lf = get_listings_file(city, listing_type)
        if not _file_fresh_today(lf):
            return False, "listings not refreshed today"
        return True, ""
    return True, ""


def execute_stage(stage: str, *, force: bool = False,
                  allow_stale_amenities: bool = False) -> int:
    """Run a single stage with marker + status bookkeeping.

    Triggers the next stage on success when `force` is False (the normal
    cron path). Returns process exit code.
    """
    if stage not in STAGE_FNS:
        print(f"[run_stage] unknown stage: {stage}", file=sys.stderr)
        return 2

    if not force and _marker_fresh(stage):
        print(f"[run_stage] {stage}: already done today, skipping")
        # Still chain forward — sweep relies on this when an earlier stage
        # finished but later ones failed.
        _trigger_next(stage)
        return 0

    ok, reason = _prereqs_met(stage)
    if not ok and not force:
        print(f"[run_stage] {stage}: prerequisites not met — {reason}")
        record_failure(stage, f"prerequisite missing: {reason}")
        return 3

    # Per-stage exclusive lock prevents two parallel runs of the same stage
    # (e.g. the 09:M primary chain still scraping when the 10:00 recovery
    # sweep fires). The second invocation simply skips and waits for the
    # next sweep tick.
    with _stage_lock(stage) as got:
        if not got:
            print(f"[run_stage] {stage}: another instance already running, skipping")
            return 0

        record_attempt(stage)
        print(f"[run_stage] {stage}: starting")

        fn = STAGE_FNS[stage]
        if stage == "alerts":
            rc, last = fn(_env(), allow_stale_amenities=allow_stale_amenities)
        else:
            rc, last = fn(_env())

        if rc == 0:
            MARKERS[stage].touch()
            record_success(stage)
            print(f"[run_stage] {stage}: ok")
            _trigger_next(stage)
            return 0

        err = last or f"exited {rc}"
        record_failure(stage, err)
        print(f"[run_stage] {stage}: failed ({err})")
        return rc


def execute_recovery(*, final_attempt: bool = False) -> int:
    """Walk stages in order, running each that hasn't succeeded today.

    Stops at the first failure so we don't alert on broken upstream data.
    On the final sweep of the day, alerts may fire with stale amenities so
    users still get a daily Telegram even if Overpass is down.
    """
    print(f"[run_stage] recovery sweep (final={final_attempt})")
    status = load_status()

    for stage in STAGES:
        if _marker_fresh(stage):
            continue

        if stage == "alerts" and final_attempt:
            am_state = status["stages"].get("amenities", {}).get("state")
            if am_state in ("failing", "stale", "pending"):
                print("[run_stage] alerts: final sweep, allowing stale amenities")
                rc = execute_stage(stage, allow_stale_amenities=True)
                if rc != 0 and final_attempt:
                    mark_stale([s for s in STAGES if not _marker_fresh(s)])
                return rc

        rc = execute_stage(stage)
        if rc != 0:
            if final_attempt:
                mark_stale([s for s in STAGES if not _marker_fresh(s)])
            return rc

        # execute_stage returns 0 in three cases: (a) the stage just
        # succeeded, (b) the marker was already fresh, (c) another instance
        # holds the lock so we skipped. In (c) the marker won't be fresh
        # afterward — downstream stages would see stale prereqs, so stop
        # the sweep silently and let the next sweep retry.
        if not _marker_fresh(stage):
            print(f"[run_stage] {stage}: still in flight, deferring rest of sweep")
            return 0

        status = load_status()

    if final_attempt:
        mark_stale([s for s in STAGES if not _marker_fresh(s)])
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Cron stage runner.")
    parser.add_argument("--stage", choices=list(STAGES), help="Run one stage.")
    parser.add_argument("--recover", action="store_true",
                        help="Sweep all stages, running any not yet succeeded today.")
    parser.add_argument("--final", action="store_true",
                        help="Mark this as the day's final recovery attempt.")
    parser.add_argument("--force", action="store_true",
                        help="Run stage even if marker is fresh.")
    args = parser.parse_args()

    if args.stage:
        return execute_stage(args.stage, force=args.force)
    if args.recover:
        return execute_recovery(final_attempt=args.final)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
