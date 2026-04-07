#!/usr/bin/env python3
"""
Fetch nearby amenities (bars, cafes, big shops) for scraped property listings.

Reads a listings JSON file, queries the Overpass API once for all amenities in
the area, computes per-property counts within 1km, and saves the result as a
companion JSON file.

Usage:
    python fetch_amenities.py manchester_rent_listings.json
    python fetch_amenities.py --radius 1500 manchester_rent_listings.json

Output:
    manchester_rent_amenities.json
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.parse

from alerts.alert_filter import haversine_metres


OPTIONAL_AMENITY_QUERIES = {
    "climbing": [
        'node["sport"="climbing"]({bbox})',
        'way["sport"="climbing"]({bbox})',
        'node["leisure"="sports_centre"]["sport"="climbing"]({bbox})',
        'way["leisure"="sports_centre"]["sport"="climbing"]({bbox})',
    ],
    "cinema": [
        'node["amenity"="cinema"]({bbox})',
        'way["amenity"="cinema"]({bbox})',
    ],
    "gym": [
        'node["leisure"="fitness_centre"]({bbox})',
        'way["leisure"="fitness_centre"]({bbox})',
        'node["leisure"="sports_centre"]({bbox})',
        'way["leisure"="sports_centre"]({bbox})',
    ],
    "parks": [
        'node["leisure"="park"]({bbox})',
        'way["leisure"="park"]({bbox})',
        'relation["leisure"="park"]({bbox})',
    ],
}

ALL_OPTIONAL_AMENITIES = list(OPTIONAL_AMENITY_QUERIES.keys())


def fetch_overpass(bbox, wide_bbox, amenity_types):
    """Query Overpass API for bars, pubs, cafes, supermarkets, dept stores, malls, and selected optional amenities."""
    south, west, north, east = bbox
    ws, ww, wn, we = wide_bbox

    optional_lines = []
    for atype in amenity_types:
        queries = OPTIONAL_AMENITY_QUERIES.get(atype, [])
        for q in queries:
            optional_lines.append("  " + q.format(bbox=f"{ws},{ww},{wn},{we}"))

    optional_block = "\n".join(optional_lines)
    query = f"""
[out:json][timeout:90];
(
  node["amenity"="bar"]({south},{west},{north},{east});
  node["amenity"="pub"]({south},{west},{north},{east});
  node["amenity"="cafe"]({south},{west},{north},{east});
  node["shop"="supermarket"]({south},{west},{north},{east});
  node["shop"="department_store"]({south},{west},{north},{east});
  node["shop"="mall"]({south},{west},{north},{east});
  way["shop"="supermarket"]({south},{west},{north},{east});
  way["shop"="department_store"]({south},{west},{north},{east});
  way["shop"="mall"]({south},{west},{north},{east});
{optional_block}
);
out center;"""

    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]
    data = urllib.parse.urlencode({"data": query}).encode()
    for endpoint in endpoints:
        try:
            print(f"  Trying {endpoint}...")
            req = urllib.request.Request(endpoint, data=data)
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            print(f"  Failed: {e}")
    raise RuntimeError("All Overpass endpoints failed.")


def categorise(element):
    """Return (lat, lon, category, name) or None."""
    lat = element.get("lat") or (element.get("center") or {}).get("lat")
    lon = element.get("lon") or (element.get("center") or {}).get("lon")
    if lat is None or lon is None:
        return None
    tags = element.get("tags", {})
    amenity = tags.get("amenity", "")
    shop = tags.get("shop", "")
    sport = tags.get("sport", "")
    leisure = tags.get("leisure", "")
    if amenity in ("bar", "pub"):
        category = "bars"
    elif amenity == "cafe":
        category = "cafes"
    elif shop in ("supermarket", "department_store", "mall"):
        category = "shops"
    elif sport == "climbing":
        category = "climbing"
    elif amenity == "cinema":
        category = "cinema"
    elif leisure in ("fitness_centre", "sports_centre") and sport != "climbing":
        category = "gym"
    elif leisure == "park":
        category = "parks"
    else:
        return None
    return lat, lon, category, tags.get("name", "")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch nearby amenities for property listings."
    )
    parser.add_argument("listings_file", help="Path to the scraped listings JSON file.")
    parser.add_argument(
        "--radius", type=int, default=1000,
        help="Search radius in metres (default: 1000).",
    )
    parser.add_argument(
        "--output", default=None,
        help="Output file path. Defaults to <name>_amenities.json.",
    )
    parser.add_argument(
        "--amenities", default="climbing",
        help="Comma-separated optional amenity types to fetch. "
             f"Available: {','.join(ALL_OPTIONAL_AMENITIES)}. Default: climbing.",
    )
    args = parser.parse_args()
    amenity_types = [a.strip() for a in args.amenities.split(",") if a.strip()]

    with open(args.listings_file, encoding="utf-8") as f:
        listings_data = json.load(f)

    listings = listings_data.get("listings", [])
    with_coords = [l for l in listings if l.get("latitude") and l.get("longitude")]

    if not with_coords:
        print("No listings with coordinates found.")
        sys.exit(1)

    print(f"Found {len(with_coords)} listings with coordinates.")

    # Compute bounding box with buffer
    lats = [l["latitude"] for l in with_coords]
    lngs = [l["longitude"] for l in with_coords]
    buffer = 0.012  # ~1.3km at UK latitudes
    bbox = (
        min(lats) - buffer,
        min(lngs) - buffer,
        max(lats) + buffer,
        max(lngs) + buffer,
    )
    # Wider bbox for optional amenities (~10km) since they're rarer
    wide_buffer = 0.1
    wide_bbox = (
        min(lats) - wide_buffer,
        min(lngs) - wide_buffer,
        max(lats) + wide_buffer,
        max(lngs) + wide_buffer,
    )

    print(f"Querying Overpass API for amenities in bbox {bbox}...")
    print(f"Optional amenity types: {', '.join(amenity_types)}")
    start = time.time()
    overpass_data = fetch_overpass(bbox, wide_bbox, amenity_types)
    elapsed = time.time() - start
    print(f"Overpass returned {len(overpass_data.get('elements', []))} elements in {elapsed:.1f}s.")

    # Parse amenities
    amenities = []
    for el in overpass_data.get("elements", []):
        result = categorise(el)
        if result:
            amenities.append(result)

    # Count core amenities
    bars = sum(1 for a in amenities if a[2] == "bars")
    cafes = sum(1 for a in amenities if a[2] == "cafes")
    shops = sum(1 for a in amenities if a[2] == "shops")

    # Group optional amenities by type
    optional_pools = {}
    for atype in amenity_types:
        pool = [a for a in amenities if a[2] == atype]
        optional_pools[atype] = pool
        print(f"  {atype}: {len(pool)} found")

    print(f"Parsed {len(amenities)} amenities: {bars} bars/pubs, {cafes} cafes, {shops} shops.")

    # Core categories counted within radius; optional categories find closest (no limit)
    core_categories = {"bars", "cafes", "shops"}
    radius = args.radius
    results = {}
    for listing in with_coords:
        key = listing.get("url") or f"{listing['latitude']},{listing['longitude']}"
        nearby_list = []
        for lat, lon, category, name in amenities:
            if category in core_categories:
                dist = haversine_metres(listing["latitude"], listing["longitude"], lat, lon)
                if dist <= radius:
                    nearby_list.append({
                        "lat": lat, "lon": lon, "category": category,
                        "name": name, "distance_m": round(dist),
                    })
        nearby_list.sort(key=lambda x: x["distance_m"])

        # Find closest for each optional amenity type
        closest = {}
        for atype, pool in optional_pools.items():
            best = None
            for lat, lon, category, name in pool:
                dist = haversine_metres(listing["latitude"], listing["longitude"], lat, lon)
                entry = {"lat": lat, "lon": lon, "category": atype, "name": name, "distance_m": round(dist)}
                if best is None or dist < best["distance_m"]:
                    best = entry
            if best:
                closest[atype] = best
                nearby_list.append(best)

        result_entry = {
            "bars": sum(1 for a in nearby_list if a["category"] == "bars"),
            "cafes": sum(1 for a in nearby_list if a["category"] == "cafes"),
            "shops": sum(1 for a in nearby_list if a["category"] == "shops"),
            "closest_climbing": closest.get("climbing"),
            "closest_amenities": closest,
            "places": nearby_list,
        }
        results[key] = result_entry

    # Build output
    output_file = args.output
    if not output_file:
        base = args.listings_file.rsplit(".", 1)[0]
        if base.endswith("_listings"):
            output_file = base.replace("_listings", "_amenities") + ".json"
        else:
            output_file = base + "_amenities.json"

    breakdown = {"bars_pubs": bars, "cafes": cafes, "shops": shops}
    for atype, pool in optional_pools.items():
        breakdown[atype] = len(pool)

    output = {
        "source_file": args.listings_file,
        "radius_metres": radius,
        "total_amenities_found": len(amenities),
        "amenity_types": amenity_types,
        "amenity_breakdown": breakdown,
        "generated_at": __import__("datetime").datetime.now().isoformat(),
        "properties": results,
    }

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nSaved amenity data for {len(results)} properties to {output_file}")


if __name__ == "__main__":
    main()
