"""
Pure filtering logic for matching listings against alert criteria.
No heavy dependencies — safe to import from server.py without pulling in scrapers.
"""

import math
import re
from datetime import datetime

SHARE_KEYWORDS = [
    "house share", "flat share", "room share", "shared house",
    "shared flat", "room in a", "room to rent", "double room",
    "single room", "en-suite room", "room available",
]


def parse_price(price_str: str) -> float | None:
    """Extract monthly rent as a number from a price string."""
    if not price_str:
        return None
    m = re.search(r"£([\d,]+)", price_str)
    if not m:
        return None
    amount = float(m.group(1).replace(",", ""))
    lower = price_str.lower()
    if "pw" in lower:
        amount = amount * 52 / 12
    elif "pa" in lower:
        amount = amount / 12
    return amount


def parse_sq_ft(size_str: str | None) -> float | None:
    """Extract square footage as a number from a size string."""
    if not size_str:
        return None
    m = re.search(r"([\d,]+)", size_str.replace(",", ""))
    return float(m.group(1)) if m else None


def parse_available_date(val: str | None) -> datetime | None:
    """Parse 'DD/MM/YYYY' or 'Now' into a datetime."""
    if not val:
        return None
    if val.lower() == "now":
        return datetime.now()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", val)
    if not m:
        return None
    return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)))


def haversine_metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in metres between two lat/lon points."""
    R = 6371000
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lon = to_rad(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2
         + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2))
         * math.sin(d_lon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def matches_alert(listing: dict, alert: dict) -> bool:
    """Check if a listing matches an alert's criteria."""
    price = parse_price(listing.get("price", ""))

    # Price
    max_price = alert.get("maxPrice")
    if max_price is not None:
        if price is not None and price > max_price:
            return False

    min_price = alert.get("minPrice")
    if min_price is not None:
        if price is not None and price < min_price:
            return False

    # Bedrooms
    min_beds = alert.get("minBedrooms")
    if min_beds is not None:
        beds = listing.get("bedrooms")
        if beds is not None and beds < min_beds:
            return False

    # Bathrooms
    min_baths = alert.get("minBathrooms")
    if min_baths is not None:
        baths = listing.get("bathrooms")
        if baths is not None and baths < min_baths:
            return False

    # Source
    source = alert.get("source")
    if source:
        listing_source = listing.get("source") or ""
        if listing_source and listing_source != source:
            return False

    # Council tax bands
    allowed_bands = alert.get("councilTaxBands")
    if allowed_bands:
        tax = listing.get("council_tax") or ""
        if tax:
            band = re.search(r"Band\s*([A-H])", tax, re.IGNORECASE)
            if band and band.group(1).upper() not in allowed_bands:
                return False

    # Property types
    allowed_types = alert.get("propertyTypes")
    if allowed_types:
        ptype = listing.get("property_type") or ""
        if ptype and ptype not in allowed_types:
            return False

    # Furnishing
    furnish = alert.get("furnishType")
    if furnish:
        listing_furnish = listing.get("furnish_type") or ""
        if listing_furnish and listing_furnish != furnish:
            return False

    # Square footage
    min_sqft = alert.get("minSqFt")
    max_sqft = alert.get("maxSqFt")
    if min_sqft is not None or max_sqft is not None:
        sqft = parse_sq_ft(listing.get("size_sq_ft"))
        if sqft is None:
            return False
        if min_sqft is not None and sqft < min_sqft:
            return False
        if max_sqft is not None and sqft > max_sqft:
            return False

    # Available date range
    avail_from = alert.get("availableFrom")
    avail_to = alert.get("availableTo")
    if avail_from or avail_to:
        avail_date = parse_available_date(listing.get("available_from"))
        if not avail_date:
            return False
        if avail_from:
            from_date = datetime.fromisoformat(avail_from)
            if avail_date < from_date:
                return False
        if avail_to:
            to_date = datetime.fromisoformat(avail_to)
            if avail_date > to_date.replace(hour=23, minute=59, second=59):
                return False

    # Geo-distance pin filter
    pin_lat = alert.get("pinLat")
    pin_lng = alert.get("pinLng")
    pin_radius = alert.get("pinRadius")
    if pin_lat is not None and pin_lng is not None and pin_radius:
        lat = listing.get("latitude")
        lng = listing.get("longitude")
        if not lat or not lng:
            return False
        dist = haversine_metres(lat, lng, float(pin_lat), float(pin_lng))
        if dist > float(pin_radius) * 1000:
            return False

    # Exclude shares
    if alert.get("excludeShares"):
        text = f"{listing.get('title', '')} {listing.get('description', '')} {listing.get('address', '')}".lower()
        if any(kw in text for kw in SHARE_KEYWORDS):
            return False

    # Search keywords
    search = alert.get("search", "").strip().lower()
    if search:
        haystack = f"{listing.get('title', '')} {listing.get('address', '')} {listing.get('description', '')} {listing.get('agent', '')}".lower()
        if search not in haystack:
            return False

    return True
