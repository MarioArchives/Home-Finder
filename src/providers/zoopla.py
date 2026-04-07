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

            # Images
            image_urls = set()
            for el in soup.select("source, img"):
                for attr in ["srcset", "src"]:
                    val = el.get(attr, "")
                    if "zoocdn" in val and "agent_logo" not in val:
                        for part in val.split(","):
                            img_url = part.strip().split(" ")[0]
                            if img_url and not img_url.endswith(":p") and "/1024/" in img_url:
                                image_urls.add(img_url)
            if image_urls:
                extras["images"] = sorted(image_urls)

        except Exception as e:
            print(f"    [{self.name}] Error fetching detail: {e}")

        return extras
