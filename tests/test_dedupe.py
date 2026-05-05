"""Pure-logic tests for cross-provider listing dedupe.

Mirrors the contract documented in src/dedupe.py:
- Listings with the same normalised description + beds + monthly price merge.
- Short or missing descriptions never merge — they pass through untouched.
- The richest listing (most enrichment fields) wins as the merged primary.
- Other URLs/sources are preserved as alt_urls / alt_sources.
"""

import pytest

from dedupe import dedupe


# Long enough to clear the 40-char minimum in _fingerprint.
_DESC_A = "A spacious modern two bed flat near the city centre with great links."
_DESC_B = "Charming Victorian terrace with original features in a sought-after area."


def _listing(**kw) -> dict:
    base = {
        "source": "rightmove",
        "url": "https://example.com/a",
        "description": _DESC_A,
        "bedrooms": 2,
        "price": "£1,200 pcm",
        "title": "2 bed flat",
    }
    base.update(kw)
    return base


def test_no_duplicates_passes_through():
    a = _listing()
    b = _listing(description=_DESC_B, url="https://example.com/b")
    merged, dropped = dedupe([a, b])
    assert dropped == 0
    assert len(merged) == 2


def test_same_fingerprint_merges():
    a = _listing(source="rightmove", url="https://rm/1", latitude=53.4)
    b = _listing(source="zoopla", url="https://zp/1")
    merged, dropped = dedupe([a, b])
    assert dropped == 1
    assert len(merged) == 1
    primary = merged[0]
    # Rightmove was richer (had latitude), so it stays primary.
    assert primary["source"] == "rightmove"
    assert primary["url"] == "https://rm/1"
    assert primary["alt_urls"] == ["https://zp/1"]
    assert primary["alt_sources"] == ["zoopla"]


def test_richer_listing_wins_regardless_of_order():
    """Order shouldn't decide the primary — richness should."""
    sparse = _listing(source="rightmove", url="https://rm/1")
    rich = _listing(
        source="zoopla", url="https://zp/1",
        latitude=53.4, longitude=-2.2, epc_rating="C", floorplan_url="x",
    )
    merged, _ = dedupe([sparse, rich])
    assert merged[0]["source"] == "zoopla"
    assert merged[0]["url"] == "https://zp/1"
    assert merged[0]["alt_urls"] == ["https://rm/1"]


def test_merge_fills_missing_fields_from_other_members():
    """Whatever the primary lacks, the other listing gets to contribute."""
    a = _listing(source="rightmove", url="https://rm/1", floorplan_url="rm-fp.jpg")
    b = _listing(
        source="zoopla", url="https://zp/1",
        latitude=53.4, longitude=-2.2, epc_rating="C",  # 3 fields → richer
        floorplan_url=None,
    )
    merged, _ = dedupe([a, b])
    primary = merged[0]
    # zoopla wins as primary, but inherits rightmove's floorplan
    assert primary["source"] == "zoopla"
    assert primary["floorplan_url"] == "rm-fp.jpg"


def test_short_description_never_merges():
    """Below the 40-char threshold, no fingerprint → no merge risk."""
    a = _listing(description="Nice flat")
    b = _listing(description="Nice flat", source="zoopla", url="https://zp/1")
    merged, dropped = dedupe([a, b])
    assert dropped == 0
    assert len(merged) == 2


def test_missing_description_never_merges():
    a = _listing(description=None)
    b = _listing(description=None, source="zoopla", url="https://zp/1")
    merged, dropped = dedupe([a, b])
    assert dropped == 0
    assert len(merged) == 2


def test_missing_beds_or_price_never_merges():
    """Two listings with the same description but no beds/price are
    too risky to collapse — different units in the same building share copy."""
    a = _listing(bedrooms=None)
    b = _listing(bedrooms=None, source="zoopla", url="https://zp/1")
    merged, _ = dedupe([a, b])
    assert len(merged) == 2

    c = _listing(price="POA")
    d = _listing(price="POA", source="zoopla", url="https://zp/1")
    merged, _ = dedupe([c, d])
    assert len(merged) == 2


def test_different_beds_do_not_merge_even_when_description_matches():
    """Building boilerplate guard — description match alone is not enough."""
    a = _listing(bedrooms=1)
    b = _listing(bedrooms=2, source="zoopla", url="https://zp/1")
    merged, dropped = dedupe([a, b])
    assert dropped == 0
    assert len(merged) == 2


def test_different_prices_do_not_merge():
    a = _listing(price="£1,200 pcm")
    b = _listing(price="£1,500 pcm", source="zoopla", url="https://zp/1")
    merged, dropped = dedupe([a, b])
    assert dropped == 0
    assert len(merged) == 2


def test_pcm_and_pw_with_equivalent_amounts_merge():
    """£300 pw → 1300 monthly equiv, so the rounding has to land on the
    same monthly value for the fingerprint to match."""
    weekly = round(300 * 52 / 12)  # 1300
    a = _listing(price=f"£{weekly} pcm")
    b = _listing(price="£300 pw", source="zoopla", url="https://zp/1")
    merged, dropped = dedupe([a, b])
    assert dropped == 1
    assert len(merged) == 1


def test_three_way_merge_collects_all_alt_urls():
    a = _listing(source="rightmove", url="https://rm/1")
    b = _listing(source="zoopla", url="https://zp/1")
    c = _listing(source="onthemarket", url="https://otm/1")
    merged, dropped = dedupe([a, b, c])
    assert dropped == 2
    assert len(merged) == 1
    primary = merged[0]
    assert len(primary["alt_urls"]) == 2
    assert len(primary["alt_sources"]) == 2


def test_normalisation_ignores_punctuation_and_case():
    a = _listing(description=_DESC_A)
    # Same description with different case + punctuation should fingerprint identically.
    b = _listing(
        description=_DESC_A.upper().replace(" ", "  ").replace(".", "!!!"),
        source="zoopla", url="https://zp/1",
    )
    merged, dropped = dedupe([a, b])
    assert dropped == 1


def test_unkeyed_passes_through_with_keyed():
    """The mixed-bag case: some listings dedupe, some can't be keyed at all."""
    a = _listing()
    b = _listing(source="zoopla", url="https://zp/1")  # merges with a
    c = _listing(description="too short", url="https://example.com/c")  # passes through
    merged, dropped = dedupe([a, b, c])
    assert dropped == 1
    assert len(merged) == 2


@pytest.mark.parametrize("price_a,price_b,should_merge", [
    ("£1,200 pcm", "£1200 pcm", True),
    ("£1,200 pcm", "£1,201 pcm", False),
    ("£0 pcm", "£0 pcm", False),  # zero price → no fingerprint
])
def test_price_parsing_edges(price_a, price_b, should_merge):
    a = _listing(price=price_a)
    b = _listing(price=price_b, source="zoopla", url="https://zp/1")
    merged, dropped = dedupe([a, b])
    assert (dropped == 1) == should_merge
