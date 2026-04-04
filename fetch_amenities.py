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
import math
import sys
import time
import urllib.request
import urllib.parse


def haversine_metres(lat1, lon1, lat2, lon2):
    """Return distance in metres between two lat/lng points."""
    R = 6_371_000
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lon = to_rad(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def fetch_overpass(bbox, climbing_bbox):
    """Query Overpass API for bars, pubs, cafes, supermarkets, dept stores, malls, and climbing gyms."""
    south, west, north, east = bbox
    cs, cw, cn, ce = climbing_bbox
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
  node["sport"="climbing"]({cs},{cw},{cn},{ce});
  way["sport"="climbing"]({cs},{cw},{cn},{ce});
  node["leisure"="sports_centre"]["sport"="climbing"]({cs},{cw},{cn},{ce});
  way["leisure"="sports_centre"]["sport"="climbing"]({cs},{cw},{cn},{ce});
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
    if amenity in ("bar", "pub"):
        category = "bars"
    elif amenity == "cafe":
        category = "cafes"
    elif shop in ("supermarket", "department_store", "mall"):
        category = "shops"
    elif sport == "climbing":
        category = "climbing"
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
    args = parser.parse_args()

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
    # Wider bbox for climbing gyms (~10km) since they're rarer
    climbing_buffer = 0.1
    climbing_bbox = (
        min(lats) - climbing_buffer,
        min(lngs) - climbing_buffer,
        max(lats) + climbing_buffer,
        max(lngs) + climbing_buffer,
    )

    print(f"Querying Overpass API for amenities in bbox {bbox}...")
    start = time.time()
    overpass_data = fetch_overpass(bbox, climbing_bbox)
    elapsed = time.time() - start
    print(f"Overpass returned {len(overpass_data.get('elements', []))} elements in {elapsed:.1f}s.")

    # Parse amenities
    amenities = []
    for el in overpass_data.get("elements", []):
        result = categorise(el)
        if result:
            amenities.append(result)

    bars = sum(1 for a in amenities if a[2] == "bars")
    cafes = sum(1 for a in amenities if a[2] == "cafes")
    shops = sum(1 for a in amenities if a[2] == "shops")
    climbing_gyms = [a for a in amenities if a[2] == "climbing"]
    print(f"Parsed {len(amenities)} amenities: {bars} bars/pubs, {cafes} cafes, {shops} shops, {len(climbing_gyms)} climbing gyms.")

    # Compute per-property nearby amenities with full detail
    radius = args.radius
    results = {}
    for listing in with_coords:
        key = listing.get("url") or f"{listing['latitude']},{listing['longitude']}"
        nearby_list = []
        for lat, lon, category, name in amenities:
            dist = haversine_metres(listing["latitude"], listing["longitude"], lat, lon)
            if category != "climbing" and dist <= radius:
                nearby_list.append({
                    "lat": lat,
                    "lon": lon,
                    "category": category,
                    "name": name,
                    "distance_m": round(dist),
                })
        nearby_list.sort(key=lambda x: x["distance_m"])

        # Find closest climbing gym (no radius limit)
        closest_climbing = None
        for lat, lon, category, name in climbing_gyms:
            dist = haversine_metres(listing["latitude"], listing["longitude"], lat, lon)
            entry = {"lat": lat, "lon": lon, "category": "climbing", "name": name, "distance_m": round(dist)}
            if closest_climbing is None or dist < closest_climbing["distance_m"]:
                closest_climbing = entry
        if closest_climbing:
            nearby_list.append(closest_climbing)

        results[key] = {
            "bars": sum(1 for a in nearby_list if a["category"] == "bars"),
            "cafes": sum(1 for a in nearby_list if a["category"] == "cafes"),
            "shops": sum(1 for a in nearby_list if a["category"] == "shops"),
            "closest_climbing": closest_climbing,
            "places": nearby_list,
        }

    # Build output
    output_file = args.output
    if not output_file:
        base = args.listings_file.rsplit(".", 1)[0]
        if base.endswith("_listings"):
            output_file = base.replace("_listings", "_amenities") + ".json"
        else:
            output_file = base + "_amenities.json"

    output = {
        "source_file": args.listings_file,
        "radius_metres": radius,
        "total_amenities_found": len(amenities),
        "amenity_breakdown": {"bars_pubs": bars, "cafes": cafes, "shops": shops, "climbing_gyms": len(climbing_gyms)},
        "generated_at": __import__("datetime").datetime.now().isoformat(),
        "properties": results,
    }

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nSaved amenity data for {len(results)} properties to {output_file}")


if __name__ == "__main__":
    main()
