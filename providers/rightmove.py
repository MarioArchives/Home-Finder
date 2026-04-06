"""Rightmove property listing provider."""

import re

from bs4 import BeautifulSoup

from providers.base import ListingProvider

RESULTS_PER_PAGE = 50


class RightmoveProvider(ListingProvider):
    name = "rightmove"

    def resolve_location(self, page, city: str) -> str | None | bool:
        """Use the Rightmove search bar to resolve a city to a location identifier."""
        print(f"[{self.name}] Resolving location for '{city}'...")
        page.goto("https://www.rightmove.co.uk/", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)
        self.accept_cookies(page)

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
            location_id = match.group(1)
            print(f"[{self.name}] Location ID: {location_id}")
            return location_id

        match = re.search(r'"locationIdentifier"\s*:\s*"([^"]+)"', page.content())
        if match:
            location_id = match.group(1)
            print(f"[{self.name}] Location ID: {location_id}")
            return location_id

        return False  # Explicitly failed

    def build_search_url(self, city: str, listing_type: str, page: int,
                         location_id: str | None) -> str:
        index = (page - 1) * RESULTS_PER_PAGE
        if listing_type == "rent":
            return (
                f"https://www.rightmove.co.uk/property-to-rent/find.html"
                f"?locationIdentifier={location_id}&index={index}"
            )
        return (
            f"https://www.rightmove.co.uk/property-for-sale/find.html"
            f"?locationIdentifier={location_id}&index={index}"
        )

    def get_result_cards(self, soup: BeautifulSoup) -> list:
        return soup.select('[data-testid^="propertyCard-"]')

    def parse_card(self, card, listing_type: str) -> dict:
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

            # Council tax
            ct = re.search(r"Council Tax:?\s*Band\s+([A-H])\b", text, re.IGNORECASE)
            if ct:
                extras["council_tax"] = f"Band {ct.group(1).upper()}"

            # Size from info reel
            size_el = soup.select_one('[data-testid="info-reel-SIZE-text"]')
            if size_el:
                size_text = size_el.get_text(strip=True)
                if "ask" not in size_text.lower():
                    sz_match = re.match(r"([\d,]+)\s*sq\.?\s*ft", size_text)
                    if sz_match:
                        val = int(sz_match.group(1).replace(",", ""))
                        if 50 <= val <= 10000:
                            extras["size_sq_ft"] = f"{val} sq ft"

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

            # Available from
            avail = re.search(
                r"Let available date:\s*(.+?)(?=Deposit|Min\.|How|$)", text,
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

            # Images
            image_urls = []
            for img in soup.select("img"):
                src = img.get("src", "")
                if "media.rightmove.co.uk" in src and "property-photo" in src:
                    full_src = re.sub(r"_max_\d+x\d+", "_max_1024x768", src)
                    if full_src not in image_urls:
                        image_urls.append(full_src)
            if image_urls:
                extras["images"] = image_urls

        except Exception as e:
            print(f"    [{self.name}] Error fetching detail: {e}")

        return extras
