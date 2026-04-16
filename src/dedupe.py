"""Cross-provider listing deduplication.

Same property often appears on multiple sites (Rightmove + Zoopla) because
the same agent lists on both. We fingerprint each listing with
(normalised description, bedrooms, monthly price) and merge matching
groups — keeping the richer listing as primary and tracking companion
URLs/sources for cross-reference.

Why description? Agents typically paste the exact same copy on every site,
so a normalised description (letters + digits only, lowercased) hashes to
the same value across providers even when addresses are formatted
differently. Why also beds + price? Large developments re-use the same
boilerplate description for every unit in the building — matching on
description alone would collapse legitimately distinct flats. Requiring
beds + price agreement avoids that.
"""

from __future__ import annotations

import re


# Minimum length of the normalised description required to be a reliable
# fingerprint. Very short descriptions (or empty) are not distinguishing
# enough to risk merging on.
_MIN_DESCRIPTION_CHARS = 40

# Fields used to score how "rich" a listing is when picking the primary
# member of a merged group.
_RICHNESS_FIELDS = (
    "latitude", "longitude", "epc_rating", "council_tax", "size_sq_ft",
    "floorplan_url", "available_from", "min_tenancy", "deposit",
    "furnish_type", "let_type", "key_features", "images",
)


def _normalise_description(desc: str | None) -> str:
    """Strip everything that isn't a letter or digit and lowercase."""
    if not desc:
        return ""
    return re.sub(r"[^a-z0-9]", "", desc.lower())


def _monthly_price(price: str | None) -> int | None:
    """Parse a price string into an integer monthly-equivalent value.

    Handles "£1,250 pcm", "£288 pw", "£300,000" (sale). Returns None if
    unparseable. Sale prices are returned as-is (we're not trying to
    compare sale vs rent).
    """
    if not price:
        return None
    s = price.lower().replace(",", "")
    nums = re.findall(r"\d+", s)
    if not nums:
        return None
    val = int(nums[0])
    if val == 0:
        return None
    if "pw" in s or "per week" in s or "/wk" in s:
        # Convert weekly to monthly equivalent (52 weeks / 12 months).
        val = round(val * 52 / 12)
    return val


def _fingerprint(listing: dict) -> tuple[str, int, int] | None:
    """Compute the dedup key for a listing, or None if it can't be keyed."""
    desc = _normalise_description(listing.get("description"))
    if len(desc) < _MIN_DESCRIPTION_CHARS:
        return None
    beds = listing.get("bedrooms")
    price = _monthly_price(listing.get("price"))
    if beds is None or price is None:
        return None
    return (desc, int(beds), price)


def _richness(listing: dict) -> int:
    """Count how many enrichment fields are populated."""
    return sum(1 for f in _RICHNESS_FIELDS if listing.get(f))


def _pick_primary(group: list[dict]) -> dict:
    """Pick the group member that has the most enrichment fields populated.
    Ties are broken by keeping the first occurrence (stable)."""
    return max(group, key=_richness)


def _is_empty(v) -> bool:
    return v in (None, "", [], {})


def _merge_group(group: list[dict]) -> dict:
    """Merge a group of duplicates into one listing.

    The primary (richest) listing keeps its url/source as the scalar value.
    Other members contribute:
      - Field fallbacks (fill in anything the primary is missing from).
      - alt_urls / alt_sources arrays for cross-reference.
    """
    if len(group) == 1:
        return group[0]

    primary = _pick_primary(group)
    merged = dict(primary)

    alt_urls: list[str] = []
    alt_sources: list[str] = []
    for other in group:
        if other is primary:
            continue
        for k, v in other.items():
            if _is_empty(merged.get(k)) and not _is_empty(v):
                merged[k] = v
        u = other.get("url")
        if u and u != merged.get("url") and u not in alt_urls:
            alt_urls.append(u)
        s = other.get("source")
        if s and s != merged.get("source") and s not in alt_sources:
            alt_sources.append(s)

    if alt_urls:
        merged["alt_urls"] = alt_urls
    if alt_sources:
        merged["alt_sources"] = alt_sources
    return merged


def dedupe(listings: list[dict]) -> tuple[list[dict], int]:
    """Group listings by fingerprint, merge each group.

    Listings that can't be fingerprinted (missing price/beds/description)
    pass through untouched — we never *lose* data, only merge confident
    matches.

    Returns (merged_listings, num_duplicates_collapsed).
    """
    groups: dict[tuple, list[dict]] = {}
    unkeyed: list[dict] = []
    for listing in listings:
        fp = _fingerprint(listing)
        if fp is None:
            unkeyed.append(listing)
        else:
            groups.setdefault(fp, []).append(listing)

    merged = [_merge_group(g) for g in groups.values()]
    merged.extend(unkeyed)
    return merged, len(listings) - len(merged)
