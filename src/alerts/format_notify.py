"""Shared formatting functions for Telegram notifications."""

import json
from pathlib import Path

from alerts.alert_filter import haversine_metres


def load_amenities(data_dir: Path, city: str, listing_type: str) -> dict:
    """Load amenities data keyed by listing URL."""
    slug = city.lower().replace(" ", "_")
    amenities_file = data_dir / f"{slug}_{listing_type}_amenities.json"
    if amenities_file.exists():
        try:
            data = json.loads(amenities_file.read_text())
            return data.get("properties", {})
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def format_alert_summary(alert: dict) -> str:
    """Format a clean summary of what an alert is looking for."""
    parts = [f"🔔 <b>Alert: {alert.get('name', 'Unnamed')}</b>", ""]
    criteria = []

    max_p = alert.get("maxPrice")
    min_p = alert.get("minPrice")
    if min_p and max_p:
        criteria.append(f"£{min_p}–£{max_p} pcm")
    elif max_p:
        criteria.append(f"Up to £{max_p} pcm")
    elif min_p:
        criteria.append(f"From £{min_p} pcm")

    min_beds = alert.get("minBedrooms")
    max_beds = alert.get("maxBedrooms")
    if min_beds and max_beds:
        criteria.append(f"{min_beds}–{max_beds} bedrooms")
    elif min_beds:
        criteria.append(f"{min_beds}+ bedrooms")
    elif max_beds:
        criteria.append(f"Up to {max_beds} bedrooms")

    baths = alert.get("minBathrooms")
    if baths:
        criteria.append(f"{baths}+ bathrooms")

    furnish_types = alert.get("furnishTypes") or []
    if not furnish_types:
        old_furnish = alert.get("furnishType")
        if old_furnish:
            furnish_types = [old_furnish]
    if furnish_types:
        criteria.append(", ".join(furnish_types))

    bands = alert.get("councilTaxBands")
    if bands:
        criteria.append(f"Council tax {', '.join(bands)}")

    radius = alert.get("pinRadius")
    if radius:
        criteria.append(f"Within {radius}km of pin")

    if alert.get("excludeShares"):
        criteria.append("No house shares")

    if criteria:
        parts.append("  ".join(criteria))

    return "\n".join(parts)


def format_listing(listing: dict, alert: dict | None = None,
                   amenities: dict | None = None) -> str:
    """Format a listing for a Telegram message with key features."""
    parts = []
    title = listing.get("title") or "Property"
    address = listing.get("address") or "Unknown location"
    parts.append(f"<b>{title}</b>")
    parts.append(f"📍 {address}")
    parts.append(f"💰 {listing.get('price', 'N/A')}")

    beds = listing.get("bedrooms")
    baths = listing.get("bathrooms")
    if beds or baths:
        room_info = []
        if beds:
            room_info.append(f"{beds} bed")
        if baths:
            room_info.append(f"{baths} bath")
        parts.append(f"🛏 {' / '.join(room_info)}")

    tax = listing.get("council_tax")
    if tax:
        parts.append(f"🏛 Council tax: {tax}")

    furnish = listing.get("furnish_type")
    if furnish:
        parts.append(f"🪑 {furnish}")

    avail = listing.get("available_from")
    if avail:
        parts.append(f"📅 Available: {avail}")

    # Distance from alert pin
    lat = listing.get("latitude")
    lng = listing.get("longitude")
    if alert and lat and lng:
        pin_lat = alert.get("pinLat")
        pin_lng = alert.get("pinLng")
        if pin_lat is not None and pin_lng is not None:
            dist_m = haversine_metres(lat, lng, float(pin_lat), float(pin_lng))
            if dist_m < 1000:
                parts.append(f"📏 {int(dist_m)}m from pin")
            else:
                parts.append(f"📏 {dist_m / 1000:.1f}km from pin")

    # Nearby amenities
    url = listing.get("url")
    if amenities and url and url in amenities:
        props = amenities[url]
        nearby = []
        cafes = props.get("cafes")
        if cafes is not None:
            nearby.append(f"{cafes} cafes")
        bars = props.get("bars")
        if bars is not None:
            nearby.append(f"{bars} bars/pubs")
        shops = props.get("shops")
        if shops is not None:
            nearby.append(f"{shops} shops")
        if nearby:
            parts.append(f"☕ Nearby: {', '.join(nearby)}")

        # Closest amenities (climbing, cinema, gym, parks, etc.)
        amenity_icons = {
            "climbing": "🧗",
            "cinema": "🎬",
            "gym": "🏋",
            "parks": "🌳",
        }
        closest_amenities = props.get("closest_amenities", {})
        # Backwards compat: old data has closest_climbing at top level
        if not closest_amenities.get("climbing") and props.get("closest_climbing"):
            closest_amenities["climbing"] = props["closest_climbing"]
        for atype, entry in closest_amenities.items():
            if entry and "distance_m" in entry:
                icon = amenity_icons.get(atype, "📌")
                dist_km = entry["distance_m"] / 1000
                name = entry.get("name", "?")
                parts.append(f"{icon} Nearest {atype}: {name} ({dist_km:.1f}km)")

    if url:
        parts.append(f"\n<a href=\"{url}\">View listing</a>")

    return "\n".join(parts)
