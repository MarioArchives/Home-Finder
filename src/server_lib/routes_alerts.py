"""Route handlers for /api/alerts endpoints."""

import json
import uuid

from .config import DATA_DIR, CITY, LISTING_TYPE, LISTINGS_FILE, get_config, get_listings_file
from .data_store import (
    load_alerts, save_alerts, load_chats,
    matches_alert, get_chat_ids_for_alert, send_telegram,
    sync_chat_subscriptions, remove_alert_from_chats,
)
from alerts.format_notify import load_amenities, format_listing, format_alert_summary


def handle_alerts_get(handler):
    alerts = load_alerts()
    chats = load_chats()
    for alert in alerts:
        aid = alert["id"]
        subscribed_chats = []
        for chat in chats:
            subs = chat.get("alert_ids")
            if subs is None or aid in subs:
                subscribed_chats.append(chat["chat_id"])
        alert["chatIds"] = subscribed_chats if subscribed_chats != [c["chat_id"] for c in chats] else None
    handler._json_response(200, alerts)


def handle_alerts_post(handler, body):
    alert = {
        "id": str(uuid.uuid4()),
        "name": body.get("name", "Untitled alert"),
        "minPrice": body.get("minPrice"),
        "maxPrice": body.get("maxPrice"),
        "minBedrooms": body.get("minBedrooms"),
        "maxBedrooms": body.get("maxBedrooms"),
        "minBathrooms": body.get("minBathrooms"),
        "source": body.get("source"),
        "councilTaxBands": body.get("councilTaxBands"),
        "propertyTypes": body.get("propertyTypes"),
        "furnishTypes": body.get("furnishTypes"),
        "minSqFt": body.get("minSqFt"),
        "maxSqFt": body.get("maxSqFt"),
        "availableFrom": body.get("availableFrom"),
        "availableTo": body.get("availableTo"),
        "pinLat": body.get("pinLat"),
        "pinLng": body.get("pinLng"),
        "pinRadius": body.get("pinRadius"),
        "excludeShares": body.get("excludeShares", False),
        "search": body.get("search", ""),
        "createdAt": body.get("createdAt"),
    }
    chat_ids = body.get("chatIds")
    alerts = load_alerts()
    alerts.append(alert)
    save_alerts(alerts)
    if chat_ids is not None:
        sync_chat_subscriptions(alert["id"], chat_ids)
    alert["chatIds"] = chat_ids
    handler._json_response(201, alert)


def handle_alert_test(handler, alert_id):
    alerts = load_alerts()
    alert = next((a for a in alerts if a["id"] == alert_id), None)
    if not alert:
        handler._json_response(404, {"error": "Alert not found"})
        return

    config = get_config()
    lf = get_listings_file(
        config["city"] if config else None,
        config["listing_type"] if config else None,
    )
    if not lf.exists():
        lf = LISTINGS_FILE
    if not lf.exists():
        handler._json_response(404, {"error": "No listings file found"})
        return
    try:
        data = json.loads(lf.read_text())
        listings = data.get("listings", [])
    except (json.JSONDecodeError, IOError) as e:
        handler._json_response(500, {"error": f"Failed to read listings: {e}"})
        return

    matches = [l for l in listings if matches_alert(l, alert)]
    urls = [l.get("url", "") for l in matches if l.get("url")]

    city_name = config["city"] if config else CITY
    lt = config["listing_type"] if config else LISTING_TYPE
    amenities = load_amenities(DATA_DIR, city_name, lt)

    total = len(listings)
    targets = get_chat_ids_for_alert(alert_id)
    if matches:
        pct = (len(matches) / total * 100) if total else 0
        header = f"🧪 <b>Test</b>\n\n{format_alert_summary(alert)}"
        header += f"\n\n🏠 <b>{len(matches)} of {total} listings matched ({pct:.1f}%)</b>"
        for cid in targets:
            send_telegram(header, chat_id=cid)
        for listing in matches:
            msg = format_listing(listing, alert=alert, amenities=amenities)
            for cid in targets:
                send_telegram(msg, chat_id=cid)
    else:
        for cid in targets:
            send_telegram(
                f'🧪 <b>Test: 0 of {total} listings match "{alert["name"]}"</b>',
                chat_id=cid)

    handler._json_response(200, {"matches": len(urls), "urls": urls})


def handle_alert_put(handler, alert_id, body):
    alerts = load_alerts()
    idx = next((i for i, a in enumerate(alerts) if a["id"] == alert_id), None)
    if idx is None:
        handler._json_response(404, {"error": "Alert not found"})
        return

    existing = alerts[idx]
    updated = {
        "id": alert_id,
        "name": body.get("name", existing["name"]),
        "minPrice": body.get("minPrice"),
        "maxPrice": body.get("maxPrice"),
        "minBedrooms": body.get("minBedrooms"),
        "maxBedrooms": body.get("maxBedrooms"),
        "minBathrooms": body.get("minBathrooms"),
        "source": body.get("source"),
        "councilTaxBands": body.get("councilTaxBands"),
        "propertyTypes": body.get("propertyTypes"),
        "furnishTypes": body.get("furnishTypes"),
        "minSqFt": body.get("minSqFt"),
        "maxSqFt": body.get("maxSqFt"),
        "availableFrom": body.get("availableFrom"),
        "availableTo": body.get("availableTo"),
        "pinLat": body.get("pinLat"),
        "pinLng": body.get("pinLng"),
        "pinRadius": body.get("pinRadius"),
        "excludeShares": body.get("excludeShares", False),
        "search": body.get("search", ""),
        "createdAt": existing.get("createdAt"),
    }
    alerts[idx] = updated
    save_alerts(alerts)

    chat_ids = body.get("chatIds")
    sync_chat_subscriptions(alert_id, chat_ids)
    updated["chatIds"] = chat_ids
    handler._json_response(200, updated)


def handle_alert_delete(handler, alert_id):
    alerts = load_alerts()
    new_alerts = [a for a in alerts if a["id"] != alert_id]
    if len(new_alerts) == len(alerts):
        handler._json_response(404, {"error": "Alert not found"})
        return
    save_alerts(new_alerts)
    remove_alert_from_chats(alert_id)
    handler._json_response(200, {"ok": True})
