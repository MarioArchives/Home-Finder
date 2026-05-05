"""OpenRent property listing provider (rentals only)."""

import re

from bs4 import BeautifulSoup

from providers.base import ListingProvider

RESULTS_PER_PAGE = 20

_FURNISH_TOKENS = {
    "furnished": "Furnished",
    "unfurnished": "Unfurnished",
    "part furnished": "Part Furnished",
    "part-furnished": "Part Furnished",
    "partly furnished": "Part Furnished",
}


class OpenRentProvider(ListingProvider):
    name = "openrent"
    display_name = "OpenRent"
    icon = "\U0001F511"
    color = "#ff6a00"
    bg = "rgba(255, 106, 0, 0.12)"
    supports_buy = False

    def resolve_location(self, page, city: str) -> str | None:
        """OpenRent takes a city slug directly — no resolution needed."""
        return None

    def build_search_url(self, city: str, listing_type: str, page: int,
                         location_id: str | None) -> str:
        slug = city.lower().strip().replace(" ", "-")
        skip = (page - 1) * RESULTS_PER_PAGE
        # `isLive=true` excludes already-let listings; OpenRent keeps them
        # visible by default, which would pollute the feed with stale data.
        return (
            f"https://www.openrent.co.uk/properties-to-rent/{slug}"
            f"?isLive=true&skip={skip}"
        )

    def scrape(self, context, city: str, listing_type: str, max_pages: int) -> list[dict]:
        """OpenRent has no sales listings — skip cleanly when buy is requested."""
        if listing_type == "buy":
            print(f"[{self.name}] OpenRent has no sales listings, skipping.")
            print(f"[{self.name}] Collected 0 listings total.")
            return []
        return super().scrape(context, city, listing_type, max_pages)

    def get_result_cards(self, soup: BeautifulSoup) -> list:
        return soup.select("a.search-property-card")

    def parse_card(self, card, listing_type: str) -> dict:
        href = card.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.openrent.co.uk" + href

        title_el = card.select_one("div.fw-medium.text-primary.fs-3")
        title = title_el.get_text(strip=True) if title_el else ""

        price = ""
        price_el = card.select_one("div.pim span.fs-4")
        if price_el:
            price = f"{price_el.get_text(strip=True)} pcm"

        bedrooms = None
        bathrooms = None
        furnish_type = None
        for li in card.select("ul.inline-list-divide li"):
            text = li.get_text(strip=True)
            low = text.lower()
            if "bed" in low:
                m = re.match(r"(\d+)", text)
                if m:
                    bedrooms = int(m.group(1))
            elif "bath" in low:
                m = re.match(r"(\d+)", text)
                if m:
                    bathrooms = int(m.group(1))
            else:
                for token, canonical in _FURNISH_TOKENS.items():
                    if token in low:
                        furnish_type = canonical
                        break

        desc_el = card.select_one("div.line-clamp-2")
        description = desc_el.get_text(strip=True) if desc_el else ""

        images: list[str] = []
        img = card.select_one("img.propertyPic")
        if img and img.get("src"):
            src = img["src"]
            if src.startswith("//"):
                src = "https:" + src
            images.append(src)

        # OpenRent listings are private landlords — there's no agent.
        # Use the title as the address fallback (it always encodes the
        # locality, e.g. "1 Bed Flat, Charlotte Street, M1").
        return {
            "source": "openrent",
            "listing_type": listing_type,
            "title": title,
            "address": title,
            "price": price,
            "bedrooms": bedrooms,
            "bathrooms": bathrooms,
            "property_type": "",
            "agent": "",
            "url": href,
            "added_on": "",
            "description": description,
            "images": images,
            "furnish_type": furnish_type,
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
            page.wait_for_timeout(1500)
            html = page.content()
            soup = BeautifulSoup(html, "html.parser")

            # Removed / no-longer-live detection. OpenRent shows a green
            # "Available" badge on live listings; let-agreed listings replace
            # it with a different status. We pre-filter with isLive=true on
            # search, so this is belt-and-braces for race conditions.
            available_badge = soup.find(
                "span",
                class_=lambda c: c and "text-bg-success" in c,
                string=lambda s: s and "Available" in s,
            )
            if not available_badge:
                # The badge text sits inside a nested <span>; widen the match.
                if not soup.select_one("span.text-bg-success .badge-text"):
                    extras["_removed"] = True
                    return extras

            # Coordinates
            map_el = soup.select_one("#map[data-lat][data-lng]")
            if map_el:
                try:
                    extras["latitude"] = float(map_el["data-lat"])
                    extras["longitude"] = float(map_el["data-lng"])
                except (ValueError, KeyError):
                    pass

            # Walk the labelled tables: <tr><td class="fw-medium">Label</td><td>value</td></tr>
            for tr in soup.select("table tr"):
                tds = tr.find_all("td")
                if len(tds) < 2:
                    continue
                label_td = tds[0]
                if "fw-medium" not in (label_td.get("class") or []):
                    # Some rows put fw-medium on a child span (e.g. DSS row).
                    if not label_td.select_one(".fw-medium"):
                        continue
                label = label_td.get_text(strip=True)
                value = tds[1].get_text(strip=True)
                if not value or value.lower() in ("ask", "—", "-"):
                    continue

                if label == "Rent PCM":
                    # Prefer the detail-page price (card price can be a
                    # formatting variant). Suffix with "pcm" to match the
                    # convention used elsewhere.
                    extras["price"] = f"{value} pcm"
                elif label == "Deposit":
                    extras["deposit"] = value
                elif label == "Available From":
                    extras["available_from"] = value
                elif label == "Minimum Tenancy":
                    extras["min_tenancy"] = value
                elif label == "Furnishing":
                    extras["furnish_type"] = value
                elif label == "EPC Rating":
                    m = re.match(r"([A-G])", value.upper())
                    if m:
                        extras["epc_rating"] = m.group(1)
                elif label in ("Size", "Floor Area", "Property Size"):
                    sz = re.search(r"([\d,]+)\s*sq\.?\s*ft", value, re.IGNORECASE)
                    if sz:
                        val = int(sz.group(1).replace(",", ""))
                        if 50 <= val <= 10000:
                            extras["size_sq_ft"] = f"{val} sq ft"

            # Description fallback — OpenRent landlords often mention size
            # only in the free-text blurb, never in the structured table.
            if not extras["size_sq_ft"]:
                page_text = soup.get_text(" ", strip=True)
                sz = re.search(r"([\d,]+)\s*sq\.?\s*ft", page_text, re.IGNORECASE)
                if sz:
                    val = int(sz.group(1).replace(",", ""))
                    if 50 <= val <= 10000:
                        extras["size_sq_ft"] = f"{val} sq ft"

            # Bedrooms/bathrooms — refresh from the detail badges if missing.
            beds_match = re.search(
                r">(\d+)\s*<span[^>]*>\s*bedrooms?\s*</span>", html, re.IGNORECASE,
            )
            if beds_match:
                extras["bedrooms"] = int(beds_match.group(1))
            baths_match = re.search(
                r">(\d+)\s*<span[^>]*>\s*bathrooms?\s*</span>", html, re.IGNORECASE,
            )
            if baths_match:
                extras["bathrooms"] = int(baths_match.group(1))

            # Description — the full text that the search card truncates.
            desc_el = soup.select_one("#descriptionText > div")
            if desc_el:
                # Replace <br> with newlines so the rendered text reads
                # naturally instead of running paragraphs together.
                for br in desc_el.find_all("br"):
                    br.replace_with("\n")
                extras["description"] = desc_el.get_text("\n", strip=True)

            # Full-resolution image set lives on lightbox anchors.
            image_urls: list[str] = []
            for a in soup.select("a.lightbox_item[href]"):
                src = a["href"]
                if src.startswith("//"):
                    src = "https:" + src
                if src not in image_urls:
                    image_urls.append(src)
            if image_urls:
                extras["images"] = image_urls

        except Exception as e:
            print(f"    [{self.name}] Error fetching detail: {e}")

        return extras
