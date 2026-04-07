"""Base class for property listing providers."""

import time
from abc import ABC, abstractmethod

from bs4 import BeautifulSoup


class ListingProvider(ABC):
    """Interface that each property listing source must implement."""

    name: str  # e.g. "rightmove", "zoopla"

    @abstractmethod
    def resolve_location(self, page, city: str) -> str | None:
        """Resolve a city name to a provider-specific location identifier.

        Return None if the provider uses the city slug directly (e.g. Zoopla).
        """

    @abstractmethod
    def build_search_url(self, city: str, listing_type: str, page: int,
                         location_id: str | None) -> str:
        """Build the search results URL for a given page number."""

    @abstractmethod
    def get_result_cards(self, soup: BeautifulSoup) -> list:
        """Extract listing card elements from a search results page."""

    @abstractmethod
    def parse_card(self, card, listing_type: str) -> dict:
        """Parse a single listing card into the standard listing dict."""

    @abstractmethod
    def scrape_detail(self, page, url: str) -> dict:
        """Visit a listing detail page and extract extra fields."""

    def accept_cookies(self, page):
        """Try to dismiss cookie banners. Override if provider needs custom handling."""
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

    def scrape(self, context, city: str, listing_type: str, max_pages: int) -> list[dict]:
        """Shared scrape loop — pages through search results, parses cards,
        fetches detail pages. Providers only need to implement the abstract methods.
        """
        page = context.new_page()
        detail_pages = [context.new_page(), context.new_page()]
        listings = []
        seen_urls = set()
        cookies_accepted = False

        try:
            # Resolve location if the provider needs it
            location_id = self.resolve_location(page, city)
            if location_id is False:
                # Provider explicitly failed to resolve
                print(f"[{self.name}] Could not resolve location for '{city}'. Skipping.")
                return []

            for pg in range(1, max_pages + 1):
                url = self.build_search_url(city, listing_type, pg, location_id)

                print(f"[{self.name}] Fetching page {pg}...")
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_timeout(3000)

                if not cookies_accepted:
                    self.accept_cookies(page)
                    page.wait_for_timeout(1000)
                    cookies_accepted = True

                soup = BeautifulSoup(page.content(), "html.parser")
                cards = self.get_result_cards(soup)

                if not cards:
                    print(f"[{self.name}] No more results on page {pg}.")
                    break

                page_listings = []
                for card in cards:
                    listing = self.parse_card(card, listing_type)
                    if listing is None:
                        continue
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
                        extras = self.scrape_detail(dp, listing["url"])
                        listing.update(extras)
                        print(" done")
                        time.sleep(0.5)

                listings.extend(page_listings)
                print(f"[{self.name}] Page {pg}: {len(page_listings)} listings (total: {len(listings)})")
                time.sleep(1)

        finally:
            for dp in detail_pages:
                dp.close()
            page.close()

        print(f"[{self.name}] Collected {len(listings)} listings total.")
        return listings
