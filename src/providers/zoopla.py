"""Zoopla property listing provider."""

import re

from bs4 import BeautifulSoup

from providers.base import ListingProvider


class ZooplaProvider(ListingProvider):
    name = "zoopla"

    def resolve_location(self, page, city: str) -> str | None:
        """Zoopla uses a city slug directly — no resolution needed."""
        return None

    def build_search_url(self, city: str, listing_type: str, page: int,
                         location_id: str | None) -> str:
        slug = city.lower().strip().replace(" ", "-")
        if listing_type == "rent":
            return f"https://www.zoopla.co.uk/to-rent/property/{slug}/?pn={page}"
        return f"https://www.zoopla.co.uk/for-sale/details/{slug}/?pn={page}"

    def get_result_cards(self, soup: BeautifulSoup) -> list:
        container = soup.select_one('[data-testid="regular-listings"]')
        if not container:
            return []
        cards = [
            card for card in container.select(":scope > div")
            if card.select_one('a[data-testid="listing-card-content"]')
        ]
        return cards

    def parse_card(self, card, listing_type: str) -> dict:
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

    def scrape_detail(self, page, url: str) -> dict:
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
            html = page.content()

            # Zoopla is behind Cloudflare and intermittently serves a
            # "Just a moment..." JS challenge on detail URLs, which leaves a
            # ~30KB stub that contains none of the listing data. When detected,
            # give the challenge ~3s to auto-resolve, then bail out rather than
            # wasting the per-listing budget on something we can't bypass.
            if "Just a moment" in html and "cf-" in html.lower():
                for _ in range(3):
                    page.wait_for_timeout(1000)
                    html = page.content()
                    if "Just a moment" not in html:
                        break
                else:
                    # Still challenged — nothing useful to extract.
                    return extras

            # Zoopla ships the listing data inside Next.js streaming RSC script
            # payloads (e.g. `self.__next_f.push([1,"...\"latitude\":53.4..."])`).
            # soup.get_text() strips all that, so we search the raw HTML with
            # regexes that tolerate both `"key"` and `\"key\"` (JSON-in-JS).

            # Match a JSON key whether or not its quotes are backslash-escaped.
            def _k(key: str) -> str:
                return rf'\\?"{re.escape(key)}\\?"'

            def _v_str(key: str) -> str:
                return _k(key) + r'\s*:\s*\\?"([^"\\]+)\\?"'

            # Coordinates — require lat and lng together to avoid matching
            # unrelated latitude fields (agent offices, etc).
            coords = re.search(
                _k("latitude") + r"\s*:\s*([\d.-]+)\s*,\s*"
                + _k("longitude") + r"\s*:\s*([\d.-]+)",
                html,
            )
            if coords:
                try:
                    extras["latitude"] = float(coords.group(1))
                    extras["longitude"] = float(coords.group(2))
                except ValueError:
                    pass

            # EPC — only trust if the page declares hasEpc:true.
            if re.search(_k("hasEpc") + r"\s*:\s*true", html):
                epc = re.search(_k("efficiencyRating") + r'\s*:\s*\\?"([A-G])\\?"', html)
                if epc:
                    extras["epc_rating"] = epc.group(1).upper()

            # Council tax band (lives in a "features" tile)
            ct = re.search(
                r'Council tax band\\?"\s*,\s*\\?"value\\?"\s*:\s*\\?"([A-H])\\?"',
                html,
            )
            if ct:
                extras["council_tax"] = f"Band {ct.group(1).upper()}"

            # Furnishing
            fs = re.search(_v_str("furnishedState"), html)
            if fs:
                extras["furnish_type"] = fs.group(1).strip()

            # Deposit — another "features" tile
            dep = re.search(
                r'Deposit\\?"\s*,\s*\\?"value\\?"\s*:\s*\\?"([^"\\]+)',
                html,
            )
            if dep:
                extras["deposit"] = dep.group(1).strip()

            # Minimum tenancy — lives under "Letting arrangements" tile
            la = re.search(
                r'Letting arrangements\\?"\s*,\s*\\?"value\\?"\s*:\s*\\?"([^"\\]+)',
                html,
            )
            if la:
                val = la.group(1).strip()
                if val and "ask" not in val.lower():
                    extras["min_tenancy"] = val

            # Available from — try structured key first, then free text.
            af = re.search(_v_str("availableFromDate"), html)
            if af:
                extras["available_from"] = af.group(1).strip()
            else:
                af2 = re.search(
                    r"Available\s+(immediately|from\s+[\w\s,]{3,60}?)(?=[\\\"<.])",
                    html,
                    re.IGNORECASE,
                )
                if af2:
                    extras["available_from"] = af2.group(0).strip()

            # Size — any "N sq ft" in the raw HTML; bound to plausible range.
            sz = re.search(r"(\d[\d,]*)\s*sq\.?\s*ft", html, re.IGNORECASE)
            if sz:
                try:
                    val = int(sz.group(1).replace(",", ""))
                    if 50 <= val <= 10000:
                        extras["size_sq_ft"] = f"{val} sq ft"
                except ValueError:
                    pass

            # Floor plan — only if the page declares one exists.
            if re.search(_k("hasFloorplan") + r"\s*:\s*true", html):
                fp = re.search(
                    r"(https?://[^\s\"\\<>]*floor[^\s\"\\<>]*)",
                    html,
                    re.IGNORECASE,
                )
                if fp:
                    extras["floorplan_url"] = fp.group(1)

            # Key features — "bullets":[ "...", "..." ]
            bm = re.search(_k("bullets") + r"\s*:\s*\[([^\]]{2,4000})\]", html)
            if bm:
                bullets = re.findall(r'\\?"([^"\\]{3,120})\\?"', bm.group(1))
                # de-dupe while preserving order
                seen = set()
                dedup = []
                for b in bullets:
                    if b not in seen:
                        seen.add(b)
                        dedup.append(b)
                if dedup:
                    extras["key_features"] = dedup

            # Images — Zoopla CDN URLs, prefer the largest resolution available.
            img_urls = set(
                re.findall(r"https://lid\.zoocdn\.com/u/\d+/\d+/[a-f0-9]+\.jpg", html)
            )
            if img_urls:
                # Group by hash; keep the largest WxH per hash.
                best: dict[str, tuple[int, str]] = {}
                for u in img_urls:
                    m = re.search(
                        r"/u/(\d+)/(\d+)/([a-f0-9]+)\.jpg$", u
                    )
                    if not m:
                        continue
                    w, h, hashid = int(m.group(1)), int(m.group(2)), m.group(3)
                    area = w * h
                    if hashid not in best or area > best[hashid][0]:
                        best[hashid] = (area, u)
                if best:
                    extras["images"] = sorted(u for _, u in best.values())

        except Exception as e:
            print(f"    [{self.name}] Error fetching detail: {e}")

        return extras
