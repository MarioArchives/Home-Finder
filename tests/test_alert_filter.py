"""Pure-logic tests for alert matching.

These cover the filter combinations the UI exposes and the
no-data-shouldn't-match-a-bound bug fixed in this branch.
"""

import pytest

from alerts.alert_filter import (
    haversine_metres,
    matches_alert,
    parse_available_date,
    parse_price,
    parse_sq_ft,
)


# ── parse helpers ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("raw,expected", [
    ("£1,250 pcm", 1250.0),
    ("£1250pcm", 1250.0),
    ("£300 pw", pytest.approx(300 * 52 / 12)),
    ("£36,000 pa", 3000.0),
    ("£500,000", 500000.0),
    ("POA", None),
    ("", None),
    (None, None),
])
def test_parse_price(raw, expected):
    assert parse_price(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("750 sq ft", 750.0),
    ("1,200 sq ft", 1200.0),
    (None, None),
    ("", None),
    ("ask agent", None),
])
def test_parse_sq_ft(raw, expected):
    assert parse_sq_ft(raw) == expected


def test_parse_available_date_iso_like():
    d = parse_available_date("15/06/2026")
    assert d is not None
    assert (d.year, d.month, d.day) == (2026, 6, 15)


def test_parse_available_date_now_returns_today():
    d = parse_available_date("Now")
    assert d is not None


@pytest.mark.parametrize("raw", [None, "", "ask agent", "tbd"])
def test_parse_available_date_unparseable(raw):
    assert parse_available_date(raw) is None


def test_haversine_short_distance():
    # Manchester Piccadilly → Manchester Victoria is ~700m as the crow flies.
    d = haversine_metres(53.4774, -2.2309, 53.4875, -2.2422)
    assert 800 < d < 1700


# ── matches_alert: bug fixes ───────────────────────────────────────────────


def _listing(**kw) -> dict:
    base = {
        "price": "£1,200 pcm",
        "bedrooms": 2,
        "bathrooms": 1,
        "title": "2 bed flat",
        "description": "",
        "address": "",
    }
    base.update(kw)
    return base


def test_max_price_rejects_unpriced_listing():
    """Bug fix: a listing with no parseable price must NOT pass a max-price filter.
    The user said 'show me places under £1500' — they didn't ask for unpriced ones."""
    listing = _listing(price="POA")
    assert matches_alert(listing, {"maxPrice": 1500}) is False


def test_min_price_rejects_unpriced_listing():
    listing = _listing(price="POA")
    assert matches_alert(listing, {"minPrice": 800}) is False


def test_min_beds_rejects_listing_with_no_beds():
    """Bug fix: bedrooms=None must NOT pass a min-beds filter."""
    listing = _listing(bedrooms=None)
    assert matches_alert(listing, {"minBedrooms": 2}) is False


def test_max_beds_rejects_listing_with_no_beds():
    listing = _listing(bedrooms=None)
    assert matches_alert(listing, {"maxBedrooms": 3}) is False


def test_no_beds_filter_lets_unknown_beds_through():
    """If the user didn't filter on beds, missing data is fine."""
    listing = _listing(bedrooms=None)
    assert matches_alert(listing, {}) is True


# ── matches_alert: happy paths ─────────────────────────────────────────────


def test_match_within_price_and_bed_bounds():
    assert matches_alert(_listing(), {"maxPrice": 1500, "minBedrooms": 2}) is True


def test_reject_above_max_price():
    assert matches_alert(_listing(price="£2,000 pcm"), {"maxPrice": 1500}) is False


def test_reject_below_min_beds():
    assert matches_alert(_listing(bedrooms=1), {"minBedrooms": 2}) is False


def test_council_tax_band_filter_matches():
    listing = _listing(council_tax="Council tax: Band C")
    assert matches_alert(listing, {"councilTaxBands": ["A", "B", "C"]}) is True


def test_council_tax_band_filter_rejects():
    listing = _listing(council_tax="Council tax: Band E")
    assert matches_alert(listing, {"councilTaxBands": ["A", "B"]}) is False


def test_property_type_filter():
    listing = _listing(property_type="Flat")
    assert matches_alert(listing, {"propertyTypes": ["Flat", "Apartment"]}) is True
    assert matches_alert(listing, {"propertyTypes": ["House"]}) is False


def test_furnish_legacy_string_field():
    listing = _listing(furnish_type="Furnished")
    assert matches_alert(listing, {"furnishType": "Furnished"}) is True
    assert matches_alert(listing, {"furnishType": "Unfurnished"}) is False


def test_furnish_array_field_takes_precedence():
    listing = _listing(furnish_type="Part furnished")
    assert matches_alert(
        listing,
        {"furnishType": "Furnished", "furnishTypes": ["Part furnished"]},
    ) is True


def test_sqft_min_rejects_missing():
    """The min_sqft block was already strict — keep it that way."""
    listing = _listing(size_sq_ft=None)
    assert matches_alert(listing, {"minSqFt": 600}) is False


def test_sqft_min_passes_when_large_enough():
    listing = _listing(size_sq_ft="800 sq ft")
    assert matches_alert(listing, {"minSqFt": 600}) is True


def test_pin_radius_within():
    listing = _listing(latitude=53.4774, longitude=-2.2309)
    # ~5km box around Piccadilly, easily within
    assert matches_alert(listing, {"pinLat": 53.4774, "pinLng": -2.2309, "pinRadius": 1}) is True


def test_pin_radius_outside():
    listing = _listing(latitude=53.4774, longitude=-2.2309)
    # London target, Manchester listing — way outside 1km
    assert matches_alert(listing, {"pinLat": 51.5074, "pinLng": -0.1278, "pinRadius": 1}) is False


def test_pin_filter_rejects_listing_with_no_coords():
    listing = _listing(latitude=None, longitude=None)
    assert matches_alert(listing, {"pinLat": 53.4774, "pinLng": -2.2309, "pinRadius": 5}) is False


def test_exclude_shares_drops_room_share():
    listing = _listing(title="Double room in shared house", description="")
    assert matches_alert(listing, {"excludeShares": True}) is False


def test_exclude_shares_keeps_whole_flat():
    listing = _listing(title="2 bed flat", description="Self-contained")
    assert matches_alert(listing, {"excludeShares": True}) is True


def test_search_keyword_match():
    listing = _listing(title="Lovely flat near Northern Quarter")
    assert matches_alert(listing, {"search": "northern quarter"}) is True
    assert matches_alert(listing, {"search": "didsbury"}) is False
