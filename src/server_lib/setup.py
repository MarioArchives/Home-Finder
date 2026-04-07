"""Setup orchestration: scraper execution, amenity fetching, cron installation."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from .config import (
    DATA_DIR, CONFIG_FILE, setup_state, setup_lock, ui_dir,
    get_listings_file, get_amenities_file,
)


def parse_scraper_line(line):
    """Parse a line of scraper output into progress updates."""
    line = line.strip()
    if not line:
        return

    with setup_lock:
        setup_state["progress"]["message"] = line

        m = re.match(r"\[(\w+)\] Fetching page (\d+)\.\.\.", line)
        if m:
            setup_state["progress"]["source"] = m.group(1)
            setup_state["progress"]["current_page"] = int(m.group(2))
            return

        m = re.match(r"\[(\w+)\] Page (\d+): (\d+) listings \(total: (\d+)\)", line)
        if m:
            setup_state["progress"]["listings_found"] = int(m.group(4))
            setup_state["progress"]["pages_done"] = setup_state["progress"].get("pages_done", 0) + 1
            setup_state["progress"]["detail_current"] = None
            setup_state["progress"]["detail_total"] = None
            return

        m = re.match(r"\[(\d+)/(\d+)\] (.+?)\.\.\.(.*)$", line)
        if m:
            setup_state["progress"]["detail_current"] = int(m.group(1))
            setup_state["progress"]["detail_total"] = int(m.group(2))
            setup_state["progress"]["current_listing"] = m.group(3).strip()
            return

        m = re.match(r"\[(\w+)\] Collected (\d+) listings total\.", line)
        if m:
            setup_state["progress"]["listings_found"] = int(m.group(2))
            return


def parse_amenities_line(line):
    """Parse a line of amenities output into progress updates."""
    line = line.strip()
    if not line:
        return
    with setup_lock:
        setup_state["progress"]["message"] = line


def run_setup(city, listing_type, source, pages, amenities="climbing", pin_data=None):
    """Run the scraper and amenities fetch in a background thread."""
    listings_file = get_listings_file(city, listing_type)
    amenities_file = get_amenities_file(city, listing_type)

    total_pages = pages * (2 if source == "both" else 1)
    with setup_lock:
        setup_state["phase"] = "scraping"
        setup_state["progress"] = {
            "source": source,
            "current_page": 0,
            "total_pages": total_pages,
            "pages_done": 0,
            "listings_found": 0,
            "message": f"Starting scrape for {city}...",
        }
        setup_state["error"] = None

    try:
        cmd = [
            sys.executable, "/app/scrape_listings.py",
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

        # Run amenities fetch
        with setup_lock:
            setup_state["phase"] = "amenities"
            setup_state["progress"] = {"message": "Fetching nearby amenities..."}

        cmd = [sys.executable, "/app/fetch_amenities.py", "--amenities", amenities, str(listings_file)]
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
                if re.match(r'^(CITY|LISTING_TYPE|PAGES|SOURCE|TELEGRAM_|DATA_DIR|NOTIFY_METHOD|SMTP_|EMAIL_)', k)}
    env_vars.update({"CITY": city, "LISTING_TYPE": listing_type, "SOURCE": source, "PAGES": str(pages), "AMENITIES": amenities})
    env_file.write_text("\n".join(f"{k}={v}" for k, v in env_vars.items()) + "\n")

    cron_content = f"""# Re-scrape listings daily at 6am
0 6 * * * cd /app && . {env_file} && python3 /app/scrape_listings.py --city "$CITY" --type "$LISTING_TYPE" --pages "$PAGES" --source "$SOURCE" --output "{listings_file}" >> "{DATA_DIR}/cron.log" 2>&1

# Check alerts for new listings at a random daily time ({rand_hour}:{rand_min:02d})
{rand_min} {rand_hour} * * * cd /app && . {env_file} && python3 -m alerts.check_new_listings >> "{DATA_DIR}/cron.log" 2>&1 && touch "{DATA_DIR}/.last_alert_check"

# Refresh amenities weekly on Sunday at 7am
0 7 * * 0 cd /app && . {env_file} && python3 /app/fetch_amenities.py --amenities "$AMENITIES" "{listings_file}" >> "{DATA_DIR}/cron.log" 2>&1

"""
    cron_path = Path("/etc/cron.d/property-update")
    try:
        cron_path.write_text(cron_content)
        cron_path.chmod(0o644)
        subprocess.run(["crontab", str(cron_path)], check=False)
    except Exception:
        pass
