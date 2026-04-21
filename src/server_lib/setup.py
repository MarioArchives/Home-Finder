"""Setup orchestration: scraper execution, amenity fetching, cron installation."""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from .config import (
    DATA_DIR, CONFIG_FILE, setup_state, setup_preferences, setup_lock, ui_dir,
    get_listings_file, get_amenities_file,
)


def _recompute_aggregates(progress):
    """Recompute top-level totals from per-source state."""
    sources = progress.get("sources", {})
    if not sources:
        return
    progress["pages_done"] = sum(s.get("pages_done", 0) for s in sources.values())
    progress["listings_found"] = sum(s.get("listings_found", 0) for s in sources.values())


def parse_scraper_line(line):
    """Parse a line of scraper output into per-source progress updates.

    Providers run in parallel threads when more than one is selected, so
    stdout lines interleave. Each regex routes by the `[name]` prefix to
    update only that provider's sub-state — otherwise the sources would
    overwrite each other's page/detail counters.
    """
    line = line.strip()
    if not line:
        return

    with setup_lock:
        progress = setup_state["progress"]
        progress["message"] = line
        sources = progress.get("sources")
        if not sources:
            return

        m = re.match(r"\[(\w+)\] \[(\d+)/(\d+)\] (.+?)\.\.\.(.*)$", line)
        if m and m.group(1) in sources:
            s = sources[m.group(1)]
            s["detail_current"] = int(m.group(2))
            s["detail_total"] = int(m.group(3))
            s["current_listing"] = m.group(4).strip()
            return

        m = re.match(r"\[(\w+)\] Fetching page (\d+)\.\.\.", line)
        if m and m.group(1) in sources:
            sources[m.group(1)]["current_page"] = int(m.group(2))
            return

        m = re.match(r"\[(\w+)\] Page (\d+): (\d+) listings \(total: (\d+)\)", line)
        if m and m.group(1) in sources:
            s = sources[m.group(1)]
            s["listings_found"] = int(m.group(4))
            s["pages_done"] = s.get("pages_done", 0) + 1
            s["detail_current"] = None
            s["detail_total"] = None
            s["current_listing"] = None
            _recompute_aggregates(progress)
            return

        m = re.match(r"\[(\w+)\] Collected (\d+) listings total\.", line)
        if m and m.group(1) in sources:
            s = sources[m.group(1)]
            s["listings_found"] = int(m.group(2))
            s["completed"] = True
            s["detail_current"] = None
            s["detail_total"] = None
            s["current_listing"] = None
            _recompute_aggregates(progress)
            return


def parse_amenities_line(line):
    """Parse a line of amenities output into progress updates."""
    line = line.strip()
    if not line:
        return
    with setup_lock:
        setup_state["progress"]["message"] = line


def run_setup(city, listing_type, source, pages):
    """Run the scraper and amenities fetch in a background thread."""
    listings_file = get_listings_file(city, listing_type)
    amenities_file = get_amenities_file(city, listing_type)

    source_names = ["rightmove", "zoopla"] if source == "both" else [source]
    total_pages = pages * len(source_names)
    sources_state = {
        name: {
            "current_page": 0,
            "total_pages": pages,
            "pages_done": 0,
            "listings_found": 0,
            "detail_current": None,
            "detail_total": None,
            "current_listing": None,
            "completed": False,
        }
        for name in source_names
    }
    with setup_lock:
        setup_state["phase"] = "scraping"
        setup_state["progress"] = {
            "source": source,
            "sources": sources_state,
            "total_pages": total_pages,
            "pages_done": 0,
            "listings_found": 0,
            "message": f"Starting scrape for {city}...",
        }
        setup_state["error"] = None

    try:
        cmd = [
            sys.executable, "/app/src/scrape_listings.py",
            "--city", city,
            "--type", listing_type,
            "--pages", str(pages),
            "--source", source,
            "--output", str(listings_file),
        ]
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        scraper_output = []
        for line in (proc.stdout or []):
            print(f"[scraper] {line}", end="", flush=True)
            scraper_output.append(line.rstrip())
            parse_scraper_line(line)
        proc.wait()

        if proc.returncode != 0:
            tail = "\n".join(scraper_output[-5:]) if scraper_output else "(no output)"
            print(f"[setup] Scraper exited with code {proc.returncode}:\n{tail}", flush=True)
            with setup_lock:
                setup_state["phase"] = "error"
                setup_state["error"] = f"Scraping failed (exit code {proc.returncode}). Last output:\n{tail}"
            return

        # Wait for user preferences before running amenities
        with setup_lock:
            setup_state["progress"]["awaiting_preferences"] = True
            setup_state["progress"]["message"] = "Scraping complete — waiting for your preferences..."

        deadline = time.time() + 600  # 10 minute timeout
        amenities = "climbing"
        pin_data = None
        while time.time() < deadline:
            with setup_lock:
                if setup_preferences["submitted"]:
                    amenities = setup_preferences["amenities"]
                    pin_data = setup_preferences["pin_data"]
                    break
            time.sleep(2)
        else:
            with setup_lock:
                amenities = setup_preferences["amenities"]
                pin_data = setup_preferences["pin_data"]

        # Run amenities fetch
        with setup_lock:
            setup_state["phase"] = "amenities"
            setup_state["progress"] = {"message": "Fetching nearby amenities..."}

        cmd = [sys.executable, "/app/src/fetch_amenities.py", "--amenities", amenities, str(listings_file)]
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        amenities_output = []
        for line in (proc.stdout or []):
            print(f"[amenities] {line}", end="", flush=True)
            amenities_output.append(line.rstrip())
            parse_amenities_line(line)
        proc.wait()
        if proc.returncode != 0:
            tail = "\n".join(amenities_output[-5:]) if amenities_output else "(no output)"
            print(f"[setup] Amenities exited with code {proc.returncode}:\n{tail}", flush=True)

        # Create symlinks in UI directory
        ui_listings = ui_dir / "listings.json"
        ui_amenities = ui_dir / "amenities.json"
        for link in (ui_listings, ui_amenities):
            try:
                link.unlink()
            except FileNotFoundError:
                pass
        os.symlink(listings_file, ui_listings)
        if amenities_file.exists():
            os.symlink(amenities_file, ui_amenities)

        # Save config
        config = {
            "city": city,
            "listing_type": listing_type,
            "source": source,
            "pages": pages,
            "amenities": amenities,
        }
        if pin_data:
            config["pin"] = pin_data
        CONFIG_FILE.write_text(json.dumps(config, indent=2))

        install_cron(city, listing_type, source, pages, listings_file, amenities_file, amenities)

        with setup_lock:
            setup_state["phase"] = "complete"
            setup_state["progress"] = {"message": "Setup complete!"}

    except Exception as e:
        with setup_lock:
            setup_state["phase"] = "error"
            setup_state["error"] = str(e)


def install_cron(city, listing_type, source, pages, listings_file, amenities_file, amenities="climbing"):
    """Install cron jobs for periodic scraping."""
    import random
    rand_hour = random.randint(6, 22)
    rand_min = random.randint(0, 59)

    env_file = DATA_DIR / ".env.cron"
    env_vars = {k: v for k, v in os.environ.items()
                if re.match(r'^(CITY|LISTING_TYPE|PAGES|SOURCE|TELEGRAM_|DATA_DIR|PYTHONPATH)', k)}
    env_vars.update({"CITY": city, "LISTING_TYPE": listing_type, "SOURCE": source, "PAGES": str(pages), "AMENITIES": amenities, "PYTHONPATH": "/app/src"})
    # `export` is required: cron sources this file under /bin/sh, and without
    # export these would be shell-local (not inherited by the python subprocess
    # that runs `-m alerts.check_new_listings`, which needs PYTHONPATH set).
    env_file.write_text("\n".join(f"export {k}={v}" for k, v in env_vars.items()) + "\n")

    cron_content = f"""# Cron runs with a minimal PATH that doesn't include /usr/local/bin
# where python3 lives in python:3.13-slim. Without this, every job fails
# with "python3: not found".
PATH=/usr/local/bin:/usr/bin:/bin

# Re-scrape listings daily at 6am
0 6 * * * cd /app && . {env_file} && python3 /app/src/scrape_listings.py --city "$CITY" --type "$LISTING_TYPE" --pages "$PAGES" --source "$SOURCE" --output "{listings_file}" >> "{DATA_DIR}/cron.log" 2>&1

# Check alerts for new listings at a random daily time ({rand_hour}:{rand_min:02d})
{rand_min} {rand_hour} * * * cd /app && . {env_file} && python3 -m alerts.check_new_listings >> "{DATA_DIR}/cron.log" 2>&1 && touch "{DATA_DIR}/.last_alert_check"

# Refresh amenities weekly on Sunday at 7am
0 7 * * 0 cd /app && . {env_file} && python3 /app/src/fetch_amenities.py --amenities "$AMENITIES" "{listings_file}" >> "{DATA_DIR}/cron.log" 2>&1

"""
    cron_path = Path("/etc/cron.d/property-update")
    try:
        cron_path.write_text(cron_content)
        cron_path.chmod(0o644)
        subprocess.run(["crontab", str(cron_path)], check=False)
    except Exception:
        pass
