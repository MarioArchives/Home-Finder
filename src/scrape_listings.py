#!/usr/bin/env python3
"""
Property listing scraper supporting multiple providers (Rightmove, Zoopla, etc.).

Setup:
    pip install playwright beautifulsoup4
    playwright install chromium

Usage:
    python scrape_listings.py --city "Manchester" --type rent --source all
    python scrape_listings.py --city "London" --type buy --source rightmove
    python scrape_listings.py --city "Bristol" --type rent --source zoopla --pages 5
    python scrape_listings.py --city "Manchester" --type rent --source rightmove,zoopla
"""

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from playwright.sync_api import sync_playwright

from dedupe import dedupe
from providers import get_provider, get_all_provider_names, PROVIDERS


def create_context(browser):
    """Build a Chromium browser context with realistic defaults.

    Separated from create_browser so providers can spin up additional
    contexts (e.g. a fresh one for detail pages, to avoid Cloudflare
    linking the session that visited the listings page).
    """
    context = browser.new_context(
        user_agent=(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1920, "height": 1080},
        locale="en-GB",
    )
    # Hide the most obvious automation fingerprints that Cloudflare looks at.
    context.add_init_script(
        """
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        window.chrome = { runtime: {} };
        """
    )
    return context


def create_browser(pw):
    """Launch a Chromium browser with a primary context.

    Zoopla sits behind Cloudflare bot detection — without these launch
    flags plus the init-script tweaks applied per context, detail pages
    get served a "Just a moment..." challenge.
    """
    browser = pw.chromium.launch(
        headless=True,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
            "--no-sandbox",
        ],
    )
    return browser, create_context(browser)


def scrape_source(context, source_name: str, city: str, listing_type: str,
                  max_pages: int) -> list[dict]:
    """Scrape listings from a single provider using an existing context."""
    provider = get_provider(source_name)
    return provider.scrape(context, city, listing_type, max_pages)


def _run_provider_isolated(source_name: str, city: str, listing_type: str,
                           max_pages: int) -> list[dict]:
    """Run one provider end-to-end with its own browser + playwright loop.

    Used as the thread worker when scraping multiple providers concurrently.
    Playwright's sync API is not thread-safe across its own event loop, so
    each thread must own its sync_playwright context.
    """
    with sync_playwright() as pw:
        browser, context = create_browser(pw)
        try:
            return scrape_source(context, source_name, city, listing_type, max_pages)
        finally:
            context.close()
            browser.close()


def scrape_all(sources: list[str], city: str, listing_type: str,
               max_pages: int) -> list[dict]:
    """Scrape all given providers, concurrently when there's more than one.

    Each provider runs in its own thread with its own Chromium instance,
    so Rightmove and Zoopla scrape in parallel rather than back-to-back.
    """
    if len(sources) == 1:
        # Avoid the thread-pool + extra Playwright loop when there's
        # nothing to parallelise with.
        return _run_provider_isolated(sources[0], city, listing_type, max_pages)

    all_listings: list[dict] = []
    with ThreadPoolExecutor(max_workers=len(sources)) as ex:
        futures = {
            ex.submit(_run_provider_isolated, s, city, listing_type, max_pages): s
            for s in sources
        }
        for fut in as_completed(futures):
            src = futures[fut]
            try:
                all_listings.extend(fut.result())
            except Exception as e:
                print(f"[{src}] Scrape failed: {type(e).__name__}: {e}")
    return all_listings


def main():
    all_names = get_all_provider_names()

    parser = argparse.ArgumentParser(
        description="Scrape property listings from multiple providers."
    )
    parser.add_argument(
        "--city", required=True,
        help="City or area to search (e.g. 'Manchester', 'London').",
    )
    parser.add_argument(
        "--type", choices=["rent", "buy"], required=True,
        help="Listing type: 'rent' for rentals, 'buy' for sales.",
    )
    parser.add_argument(
        "--source", default="all",
        help=(
            f"Comma-separated list of sources, or 'all'. "
            f"Available: {', '.join(all_names)} (default: all)."
        ),
    )
    parser.add_argument(
        "--pages", type=int, default=5,
        help="Max pages to scrape per source (default: 5).",
    )
    parser.add_argument(
        "--output", default=None,
        help="Output JSON file path. Defaults to '<city>_<type>_listings.json'.",
    )
    parser.add_argument(
        "--no-details", action="store_true",
        help="Skip fetching individual listing pages (faster but less data).",
    )

    args = parser.parse_args()
    city = args.city
    listing_type = args.type
    max_pages = args.pages
    output_file = args.output or f"{city.lower().replace(' ', '_')}_{listing_type}_listings.json"

    # Parse source list
    if args.source == "all" or args.source == "both":
        sources = all_names
    else:
        sources = [s.strip() for s in args.source.split(",")]
        for s in sources:
            if s not in PROVIDERS:
                print(f"Error: Unknown source '{s}'. Available: {', '.join(all_names)}")
                sys.exit(1)

    all_listings = scrape_all(sources, city, listing_type, max_pages)

    if not all_listings:
        print("\nNo listings found.")
        print("Tips:")
        print("  - Try a well-known city name (e.g. 'Manchester' not 'Manc')")
        print(f"  - Try a single source: --source {all_names[0]}")
        sys.exit(1)

    # Merge duplicates across (and within) providers. Same-property listings
    # on Rightmove + Zoopla share agent-pasted descriptions, so grouping on
    # (description, beds, price) is reliable.
    before = len(all_listings)
    all_listings, merged = dedupe(all_listings)
    if merged > 0:
        print(f"Merged {merged} duplicate listing(s) ({before} -> {len(all_listings)}).")

    result = {
        "city": city,
        "listing_type": listing_type,
        "sources": ",".join(sources),
        "scraped_at": datetime.now().isoformat(),
        "total_listings": len(all_listings),
        "listings": all_listings,
    }

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(all_listings)} listings to {output_file}")


if __name__ == "__main__":
    main()
