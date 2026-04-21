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

        Both listings pages AND detail pages run in FRESH browser contexts.
        Zoopla sits behind Cloudflare, which fingerprints a context after a
        single request and challenges everything that follows from the same
        context — this applies to search results (`?pn=2` onwards) just as
        much as to detail pages. Throwing away the context after each request
        gives every hit a clean session, so CF treats them as independent
        visitors. A context is cheap (≈20–30ms to create and close), so the
        overhead is roughly 1s per 30 listings.

        The initial `context` passed in is used only for `resolve_location`
        (which some providers need for multi-step interactions that set
        state), and then discarded.
        """
        # Late import to avoid a cycle (base <- providers <- scrape_listings).
        from scrape_listings import create_context

        browser = context.browser
        listings = []
        seen_urls = set()

        # Resolve location on the provided (non-fresh) context. For providers
        # that need it (Rightmove), this is a multi-step interaction; for
        # Zoopla it's a no-op.
        resolve_page = context.new_page()
        try:
            location_id = self.resolve_location(resolve_page, city)
        finally:
            resolve_page.close()
        if location_id is False:
            print(f"[{self.name}] Could not resolve location for '{city}'. Skipping.")
            return []

        for pg in range(1, max_pages + 1):
            url = self.build_search_url(city, listing_type, pg, location_id)
            print(f"[{self.name}] Fetching page {pg}...")

            # The entire page-fetch + detail-fetch block is wrapped in a
            # try/except so a network failure (DNS, timeout, etc.) on page N
            # keeps the listings from pages 1..N-1 instead of crashing the
            # whole provider's scrape.
            try:
                # Fresh context for this listings page.
                list_ctx = create_context(browser)
                try:
                    page = list_ctx.new_page()
                    page.goto(url, wait_until="domcontentloaded")
                    page.wait_for_timeout(3000)
                    self.accept_cookies(page)
                    page.wait_for_timeout(1000)

                    html = page.content()
                    if "Just a moment" in html and "cf-" in html.lower():
                        for _ in range(3):
                            page.wait_for_timeout(1000)
                            html = page.content()
                            if "Just a moment" not in html:
                                break
                        else:
                            print(f"[{self.name}] Page {pg} blocked by Cloudflare. Stopping pagination.")
                            break

                    soup = BeautifulSoup(html, "html.parser")
                    cards = self.get_result_cards(soup)
                finally:
                    list_ctx.close()

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

                # Fetch detail pages for extra info — fresh context each time.
                for i, listing in enumerate(page_listings):
                    if not listing["url"]:
                        continue
                    print(
                        f"[{self.name}] [{i + 1}/{len(page_listings)}] {listing['address']}...",
                        end="",
                        flush=True,
                    )
                    detail_ctx = create_context(browser)
                    try:
                        dp = detail_ctx.new_page()
                        extras = self.scrape_detail(dp, listing["url"])
                        listing.update(extras)
                    finally:
                        detail_ctx.close()
                    print(" done")
                    time.sleep(0.5)

                listings.extend(page_listings)
                print(f"[{self.name}] Page {pg}: {len(page_listings)} listings (total: {len(listings)})")

            except Exception as e:
                print(f"[{self.name}] Page {pg} failed: {type(e).__name__}: {e}")
                print(f"[{self.name}] Keeping {len(listings)} listings from earlier pages.")
                break

            time.sleep(1)

        print(f"[{self.name}] Collected {len(listings)} listings total.")
        return listings
