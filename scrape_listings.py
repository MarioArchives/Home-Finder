#!/usr/bin/env python3
"""
Property listing scraper for Zoopla and Rightmove using Playwright.

Setup:
    pip install playwright beautifulsoup4
    playwright install chromium

Usage:
    python scrape_listings.py --city "Manchester" --type rent --source both
    python scrape_listings.py --city "London" --type buy --source rightmove
    python scrape_listings.py --city "Bristol" --type rent --source zoopla --pages 5
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

RESULTS_PER_PAGE_RM = 50


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


def _accept_cookies(page):
    """Try to dismiss cookie banners."""
    for selector in [
        "#onetrust-accept-btn-handler",
        "button:has-text('Accept all')",
        "button:has-text('Accept')",
    ]:
        try:
            page.click(selector, timeout=2000)
            page.wait_for_timeout(500)
            return
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Detail page scraping (shared browser context)
# ---------------------------------------------------------------------------

def _scrape_rightmove_detail(page, url: str) -> dict:
    """Visit a Rightmove listing page and extract extra details."""
    extras = {
        "council_tax": None,
        "size_sq_ft": None,
        "epc_rating": None,
        "latitude": None,
        "longitude": None,
        "key_features": [],
        "furnish_type": None,
        "let_type": None,
        "available_from": None,
        "min_tenancy": None,
        "deposit": None,
        "floorplan_url": None,
    }
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        soup = BeautifulSoup(page.content(), "html.parser")
        text = soup.get_text()

        # Floor plan — extract from embedded JSON "floorplans" array
        for script in soup.select("script"):
            if script.string and '"floorplans"' in (script.string or ""):
                fp = re.search(
                    r'"floorplans"\s*:\s*\[\s*\{[^}]*"url"\s*:\s*"([^"]+)"',
                    script.string,
                )
                if fp:
                    extras["floorplan_url"] = fp.group(1)
                    break
        # Fallback: img or link with floorplan in URL
        if not extras["floorplan_url"]:
            for img in soup.select('img[src*="floorplan"], img[src*="floor-plan"]'):
                src = img.get("src", "")
                if src:
                    extras["floorplan_url"] = src
                    break
        if not extras["floorplan_url"]:
            for a in soup.select('a[href*="floorplan"]'):
                href = a.get("href", "")
                if href:
                    if not href.startswith("http"):
                        href = "https://www.rightmove.co.uk" + href
                    extras["floorplan_url"] = href
                    break

        # Council tax — require "Band" before the letter to avoid matching "Ask agent" etc.
        ct = re.search(r"Council Tax:?\s*Band\s+([A-H])\b", text, re.IGNORECASE)
        if ct:
            extras["council_tax"] = f"Band {ct.group(1).upper()}"

        # Size from info reel — extract just the sq ft number
        size_el = soup.select_one('[data-testid="info-reel-SIZE-text"]')
        if size_el:
            size_text = size_el.get_text(strip=True)
            if "ask" not in size_text.lower():
                # The reel concatenates "X sq ftY sq m" — extract just the sq ft part
                sz_match = re.match(r"([\d,]+)\s*sq\.?\s*ft", size_text)
                if sz_match:
                    val = int(sz_match.group(1).replace(",", ""))
                    # Sanity check: a single property shouldn't exceed ~10,000 sq ft
                    if 50 <= val <= 10000:
                        extras["size_sq_ft"] = f"{val} sq ft"

        # Also try regex for sq ft in full text
        if not extras["size_sq_ft"]:
            sz = re.search(r"([\d,]+)\s*sq\.?\s*ft", text, re.IGNORECASE)
            if sz:
                val = int(sz.group(1).replace(",", ""))
                if 50 <= val <= 10000:
                    extras["size_sq_ft"] = f"{val} sq ft"

        # EPC
        epc = re.search(r"EPC [Rr]ating:?\s*([A-G])", text)
        if not epc:
            epc_el = soup.select_one('[data-testid*="epc"]')
            if epc_el:
                epc = re.search(r"([A-G])", epc_el.get_text())
        if epc:
            extras["epc_rating"] = epc.group(1).upper()

        # Coordinates from embedded scripts
        for script in soup.select("script"):
            if script.string and "latitude" in (script.string or ""):
                lat = re.search(r'"latitude"\s*:\s*([\d.-]+)', script.string)
                lng = re.search(r'"longitude"\s*:\s*([\d.-]+)', script.string)
                if lat and lng:
                    extras["latitude"] = float(lat.group(1))
                    extras["longitude"] = float(lng.group(1))
                    break

        # Available from / let available date
        avail = re.search(
            r"Let available date:\s*(.+?)(?=Deposit|Min\.|How|$)",
            text,
        )
        if avail:
            val = avail.group(1).strip()
            if "ask" not in val.lower():
                extras["available_from"] = val

        # Min tenancy
        mt = re.search(r"Min\.\s*Tenancy:\s*(.+?)(?=How|$)", text)
        if mt:
            val = mt.group(1).strip()
            if "ask" not in val.lower():
                extras["min_tenancy"] = val

        # Deposit
        dep = re.search(r"Deposit:\s*(.+?)(?=A deposit|Min\.|$)", text)
        if dep:
            val = dep.group(1).strip()
            if "ask" not in val.lower():
                extras["deposit"] = val

        # Key features
        kf = soup.select_one('[data-testid="keyFeatures"]')
        if kf:
            extras["key_features"] = [
                li.get_text(strip=True) for li in kf.select("li")
            ]

        # Furnish / let type
        ft = re.search(r"Furnish type:\s*([\w\s]+?)(?=Council|Let|PROPERTY|$)", text)
        if ft:
            extras["furnish_type"] = ft.group(1).strip()
        lt = re.search(r"Let type:\s*([\w\s]+?)(?=Furnish|Council|PROPERTY|$)", text)
        if lt:
            extras["let_type"] = lt.group(1).strip()

        # Images — grab full-res from detail page (larger than search thumbnails)
        image_urls = []
        for img in soup.select("img"):
            src = img.get("src", "")
            if "media.rightmove.co.uk" in src and "property-photo" in src:
                # Replace thumbnail size with larger version
                full_src = re.sub(r"_max_\d+x\d+", "_max_1024x768", src)
                if full_src not in image_urls:
                    image_urls.append(full_src)
        if image_urls:
            extras["images"] = image_urls

    except Exception as e:
        print(f"    [Rightmove] Error fetching detail: {e}")

    return extras


def _scrape_zoopla_detail(page, url: str) -> dict:
    """Visit a Zoopla listing page and extract extra details."""
    extras = {
        "council_tax": None,
        "size_sq_ft": None,
        "epc_rating": None,
        "latitude": None,
        "longitude": None,
        "key_features": [],
        "furnish_type": None,
        "let_type": None,
        "available_from": None,
        "min_tenancy": None,
        "deposit": None,
        "floorplan_url": None,
    }
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        soup = BeautifulSoup(page.content(), "html.parser")
        text = soup.get_text()

        # Floor plan
        for img in soup.select('img[src*="floorplan"], img[src*="floor-plan"], img[src*="FLOORPLAN"]'):
            src = img.get("src", "")
            if src:
                extras["floorplan_url"] = src
                break
        if not extras["floorplan_url"]:
            for a in soup.select('a[href*="floorplan"], a[href*="floor-plan"]'):
                href = a.get("href", "")
                if href:
                    if not href.startswith("http"):
                        href = "https://www.zoopla.co.uk" + href
                    extras["floorplan_url"] = href
                    break
        if not extras["floorplan_url"]:
            for script in soup.select("script"):
                if script.string and "floorplan" in (script.string or "").lower():
                    fp = re.search(r'"floorplan[^"]*"\s*:\s*"(https?://[^"]+)"', script.string, re.IGNORECASE)
                    if fp:
                        extras["floorplan_url"] = fp.group(1)
                        break

        # Council tax band
        ct = re.search(r"Council tax band\s+([A-H])\b", text, re.IGNORECASE)
        if ct:
            extras["council_tax"] = f"Band {ct.group(1).upper()}"

        # EPC
        epc = re.search(r"EPC [Rr]ating:?\s*([A-G])", text)
        if epc:
            extras["epc_rating"] = epc.group(1).upper()

        # Size
        sz = re.search(r"([\d,]+)\s*sq\.?\s*ft", text, re.IGNORECASE)
        if sz:
            extras["size_sq_ft"] = sz.group(1).replace(",", "") + " sq ft"

        # Coordinates from scripts
        for script in soup.select("script"):
            if script.string and "latitude" in (script.string or ""):
                lat = re.search(r'"latitude"\s*:\s*([\d.-]+)', script.string)
                lng = re.search(r'"longitude"\s*:\s*([\d.-]+)', script.string)
                if lat and lng:
                    extras["latitude"] = float(lat.group(1))
                    extras["longitude"] = float(lng.group(1))
                    break

        # Key features
        features_section = soup.select_one('[data-testid="keyFeatures"], [class*="keyFeature"]')
        if features_section:
            extras["key_features"] = [
                li.get_text(strip=True) for li in features_section.select("li")
            ]

        # Furnishing
        ft = re.search(r"(Furnished|Unfurnished|Part furnished)", text, re.IGNORECASE)
        if ft:
            extras["furnish_type"] = ft.group(1).strip()

        # Available from
        avail = re.search(r"Available\s+(immediately|from\s+.+?)(?=\.|Part|Furnished|Unfurnished|$)", text, re.IGNORECASE)
        if avail:
            extras["available_from"] = avail.group(0).strip()
        if not extras["available_from"]:
            avail2 = re.search(r"\*?available\s+(\d{1,2}(?:st|nd|rd|th)?\s+\w+(?:\s+\d{4})?)\*?", text, re.IGNORECASE)
            if avail2:
                extras["available_from"] = avail2.group(1).strip()

        # Deposit
        dep = re.search(r"Deposit\s*£([\d,]+)", text)
        if dep:
            extras["deposit"] = f"£{dep.group(1)}"

        # Letting arrangements / min tenancy
        la = re.search(r"Letting arrangements\s*(.+?)(?=Electric|EPC|Utilities|Report|$)", text)
        if la:
            val = la.group(1).strip()
            if "ask" not in val.lower():
                extras["min_tenancy"] = val

        # Images — grab high-res (1024/768) from srcset/src
        image_urls = set()
        for el in soup.select("source, img"):
            for attr in ["srcset", "src"]:
                val = el.get(attr, "")
                if "zoocdn" in val and "agent_logo" not in val:
                    for part in val.split(","):
                        url = part.strip().split(" ")[0]
                        if url and not url.endswith(":p") and "/1024/" in url:
                            image_urls.add(url)
        if image_urls:
            extras["images"] = sorted(image_urls)

    except Exception as e:
        print(f"    [Zoopla] Error fetching detail: {e}")

    return extras


# ---------------------------------------------------------------------------
# Rightmove
# ---------------------------------------------------------------------------

def _rightmove_resolve_location(page, city: str) -> str | None:
    """Use the Rightmove search bar to resolve a city to a location identifier."""
    page.goto("https://www.rightmove.co.uk/", wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    _accept_cookies(page)

    search_input = page.locator(
        "input#ta_searchInput, input[name='searchLocation'], input#search-input"
    )
    search_input.first.fill(city)
    page.wait_for_timeout(1500)

    try:
        suggestion = page.locator(
            "#ta_searchInput_list li, ul[id*='searchInput'] li, "
            ".autocomplete-suggestion"
        )
        suggestion.first.wait_for(timeout=5000)
        suggestion.first.click()
        page.wait_for_timeout(500)
    except Exception:
        pass

    try:
        page.click(
            "button:has-text('Search'), button[type='submit'], #submit",
            timeout=3000,
        )
    except Exception:
        pass

    page.wait_for_timeout(3000)

    match = re.search(r"locationIdentifier=([^&]+)", page.url)
    if match:
        return match.group(1)

    match = re.search(r'"locationIdentifier"\s*:\s*"([^"]+)"', page.content())
    if match:
        return match.group(1)

    return None


def _parse_rightmove_card(card, listing_type: str) -> dict:
    """Parse a single Rightmove property card from search results."""
    # Price
    price_el = card.select_one('[data-testid="property-price"]')
    price = ""
    if price_el:
        raw = price_el.get_text(strip=True)
        m = re.search(r"£[\d,]+(?:\s*(?:pcm|pw|pa))?", raw)
        price = m.group(0) if m else raw

    # Address
    address_el = card.select_one("address")
    address = address_el.get_text(strip=True) if address_el else ""

    # Property type and bedrooms
    property_type = ""
    bedrooms = None
    bathrooms = None
    info_el = card.select_one('[data-testid="property-information"]')
    if info_el:
        type_span = info_el.select_one('[class*="propertyType"]')
        beds_span = info_el.select_one('[class*="bedroomsCount"]')
        property_type = type_span.get_text(strip=True) if type_span else ""
        if beds_span:
            try:
                bedrooms = int(beds_span.get_text(strip=True))
            except ValueError:
                pass
        spans = info_el.select("span")
        if len(spans) >= 3:
            try:
                bathrooms = int(spans[2].get_text(strip=True))
            except ValueError:
                pass

    # Description
    desc_el = card.select_one('[data-testid="property-description"]')
    description = desc_el.get_text(strip=True) if desc_el else ""

    # Link
    link_el = card.select_one('a[data-testid="property-price"]')
    href = ""
    if link_el and link_el.get("href"):
        href = "https://www.rightmove.co.uk" + link_el["href"]

    # Agent
    agent = ""
    added_on = ""
    agent_el = card.select_one('[data-testid="marketed-by-text"]')
    if agent_el:
        raw = agent_el.get_text(strip=True)
        agent_match = re.search(r"by\s+(.+?)(?:Added|Reduced|$)", raw)
        agent = agent_match.group(1).strip().rstrip(",") if agent_match else ""
        date_match = re.search(
            r"(Added on \d+/\d+/\d+|Reduced on \d+/\d+/\d+|Reduced today|Added today)",
            raw,
        )
        added_on = date_match.group(0) if date_match else ""

    # Images
    images = [
        img["src"]
        for img in card.select('img[data-testid^="property-img"]')
        if img.get("src")
    ]

    return {
        "source": "rightmove",
        "listing_type": listing_type,
        "title": f"{bedrooms} bed {property_type}" if bedrooms and property_type else property_type,
        "address": address,
        "price": price,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "property_type": property_type,
        "agent": agent,
        "url": href,
        "added_on": added_on,
        "description": description,
        "images": images,
    }


def scrape_rightmove(context, city: str, listing_type: str, max_pages: int) -> list[dict]:
    """Scrape Rightmove listings for the given city."""
    page = context.new_page()
    detail_pages = [context.new_page(), context.new_page()]
    listings = []
    seen_urls = set()

    try:
        print(f"[Rightmove] Resolving location for '{city}'...")
        location_id = _rightmove_resolve_location(page, city)

        if not location_id:
            print(f"[Rightmove] Could not resolve location for '{city}'. Skipping.")
            return []

        print(f"[Rightmove] Location ID: {location_id}")

        for pg in range(1, max_pages + 1):
            index = (pg - 1) * RESULTS_PER_PAGE_RM
            if listing_type == "rent":
                url = (
                    f"https://www.rightmove.co.uk/property-to-rent/find.html"
                    f"?locationIdentifier={location_id}&index={index}"
                )
            else:
                url = (
                    f"https://www.rightmove.co.uk/property-for-sale/find.html"
                    f"?locationIdentifier={location_id}&index={index}"
                )

            print(f"[Rightmove] Fetching page {pg}...")
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(3000)

            soup = BeautifulSoup(page.content(), "html.parser")
            cards = soup.select('[data-testid^="propertyCard-"]')

            if not cards:
                print(f"[Rightmove] No more results on page {pg}.")
                break

            page_listings = []
            for card in cards:
                listing = _parse_rightmove_card(card, listing_type)
                # Deduplicate
                if listing["url"] and listing["url"] in seen_urls:
                    continue
                if listing["url"]:
                    seen_urls.add(listing["url"])
                page_listings.append(listing)

            # Fetch detail pages for extra info
            for i, listing in enumerate(page_listings):
                if listing["url"]:
                    print(
                        f"    [{i + 1}/{len(page_listings)}] {listing['address']}...",
                        end="",
                        flush=True,
                    )
                    dp = detail_pages[i % 2]
                    extras = _scrape_rightmove_detail(dp, listing["url"])
                    listing.update(extras)
                    print(f" done")
                    time.sleep(0.5)

            listings.extend(page_listings)
            print(f"[Rightmove] Page {pg}: {len(page_listings)} listings (total: {len(listings)})")
            time.sleep(1)

    finally:
        for dp in detail_pages:
            dp.close()
        page.close()

    print(f"[Rightmove] Collected {len(listings)} listings total.")
    return listings


# ---------------------------------------------------------------------------
# Zoopla
# ---------------------------------------------------------------------------

def _parse_zoopla_card(card, listing_type: str) -> dict:
    """Parse a single Zoopla listing card from search results."""
    # Price
    price_el = card.select_one('p[class*="priceText"]')
    price = price_el.get_text(strip=True) if price_el else ""

    # Address
    address_el = card.select_one("address")
    address = address_el.get_text(strip=True) if address_el else ""

    # Amenities
    bedrooms = None
    bathrooms = None
    for span in card.select('span[class*="amenityItem"]'):
        text = span.get_text(strip=True).lower()
        m = re.match(r"(\d+)", text)
        if m:
            val = int(m.group(1))
            if "bed" in text:
                bedrooms = val
            elif "bath" in text:
                bathrooms = val

    # Description
    desc_el = card.select_one('p[class*="summary"]')
    description = desc_el.get_text(strip=True) if desc_el else ""

    # Link
    link_el = card.select_one('a[data-testid="listing-card-content"]')
    href = ""
    if link_el and link_el.get("href"):
        href = link_el["href"]
        if not href.startswith("http"):
            href = "https://www.zoopla.co.uk" + href

    return {
        "source": "zoopla",
        "listing_type": listing_type,
        "title": f"{bedrooms} bed" if bedrooms else "",
        "address": address,
        "price": price,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "property_type": "",
        "agent": "",
        "url": href,
        "added_on": "",
        "description": description,
        "images": [],
    }


def scrape_zoopla(context, city: str, listing_type: str, max_pages: int) -> list[dict]:
    """Scrape Zoopla listings for the given city."""
    page = context.new_page()
    detail_pages = [context.new_page(), context.new_page()]
    slug = city.lower().strip().replace(" ", "-")
    listings = []
    seen_urls = set()
    cookies_accepted = False

    try:
        for pg in range(1, max_pages + 1):
            if listing_type == "rent":
                url = f"https://www.zoopla.co.uk/to-rent/property/{slug}/?pn={pg}"
            else:
                url = f"https://www.zoopla.co.uk/for-sale/details/{slug}/?pn={pg}"

            print(f"[Zoopla] Fetching page {pg}...")
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(3000)

            if not cookies_accepted:
                _accept_cookies(page)
                page.wait_for_timeout(1000)
                cookies_accepted = True

            soup = BeautifulSoup(page.content(), "html.parser")
            container = soup.select_one('[data-testid="regular-listings"]')
            if not container:
                print(f"[Zoopla] No results container on page {pg}.")
                break

            cards = container.select(":scope > div")
            if not cards:
                print(f"[Zoopla] No more results on page {pg}.")
                break

            page_listings = []
            for card in cards:
                if not card.select_one('a[data-testid="listing-card-content"]'):
                    continue
                listing = _parse_zoopla_card(card, listing_type)
                if listing["url"] and listing["url"] in seen_urls:
                    continue
                if listing["url"]:
                    seen_urls.add(listing["url"])
                page_listings.append(listing)

            # Fetch detail pages
            for i, listing in enumerate(page_listings):
                if listing["url"]:
                    print(
                        f"    [{i + 1}/{len(page_listings)}] {listing['address']}...",
                        end="",
                        flush=True,
                    )
                    dp = detail_pages[i % 2]
                    extras = _scrape_zoopla_detail(dp, listing["url"])
                    listing.update(extras)
                    print(f" done")
                    time.sleep(0.5)

            listings.extend(page_listings)
            print(f"[Zoopla] Page {pg}: {len(page_listings)} listings (total: {len(listings)})")
            time.sleep(1)

    finally:
        for dp in detail_pages:
            dp.close()
        page.close()

    print(f"[Zoopla] Collected {len(listings)} listings total.")
    return listings


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Scrape property listings from Rightmove and Zoopla."
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
        "--source", choices=["rightmove", "zoopla", "both"], default="both",
        help="Which site(s) to scrape (default: both).",
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
    source = args.source
    max_pages = args.pages
    output_file = args.output or f"{city.lower().replace(' ', '_')}_{listing_type}_listings.json"

    all_listings = []

    with sync_playwright() as pw:
        browser, context = create_browser(pw)
        try:
            if source in ("rightmove", "both"):
                all_listings.extend(
                    scrape_rightmove(context, city, listing_type, max_pages)
                )
            if source in ("zoopla", "both"):
                all_listings.extend(
                    scrape_zoopla(context, city, listing_type, max_pages)
                )
        finally:
            context.close()
            browser.close()

    if not all_listings:
        print("\nNo listings found.")
        print("Tips:")
        print("  - Try a well-known city name (e.g. 'Manchester' not 'Manc')")
        print("  - Try --source rightmove or --source zoopla individually")
        sys.exit(1)

    result = {
        "city": city,
        "listing_type": listing_type,
        "sources": source,
        "scraped_at": datetime.now().isoformat(),
        "total_listings": len(all_listings),
        "listings": all_listings,
    }

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(all_listings)} listings to {output_file}")


if __name__ == "__main__":
    main()
