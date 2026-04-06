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
from datetime import datetime

from playwright.sync_api import sync_playwright

from providers import get_provider, get_all_provider_names, PROVIDERS


def create_browser(pw):
    """Launch a Chromium browser that looks like a real user."""
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(
        user_agent=(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1920, "height": 1080},
        locale="en-GB",
    )
    return browser, context


def scrape_source(context, source_name: str, city: str, listing_type: str,
                  max_pages: int) -> list[dict]:
    """Scrape listings from a single provider by name."""
    provider = get_provider(source_name)
    return provider.scrape(context, city, listing_type, max_pages)


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

    all_listings = []

    with sync_playwright() as pw:
        browser, context = create_browser(pw)
        try:
            for source_name in sources:
                all_listings.extend(
                    scrape_source(context, source_name, city, listing_type, max_pages)
                )
        finally:
            context.close()
            browser.close()

    if not all_listings:
        print("\nNo listings found.")
        print("Tips:")
        print("  - Try a well-known city name (e.g. 'Manchester' not 'Manc')")
        print(f"  - Try a single source: --source {all_names[0]}")
        sys.exit(1)

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
