"""Pure handlers for /api/alerts — wired into FastAPI in app.py."""

import json
import uuid

from fastapi import HTTPException

from .config import DATA_DIR, CITY, LISTING_TYPE, LISTINGS_FILE, get_config, get_listings_file
from .data_store import (
    load_alerts, save_alerts, load_chats,
    matches_alert, get_chat_ids_for_alert, send_telegram,
    sync_chat_subscriptions, remove_alert_from_chats,
)
from alerts.format_notify import load_amenities, format_listing, format_alert_summary


# Field names mirrored 1:1 from the React UI payload — keep in sync with
# AlertCreate / AlertUpdate Pydantic models in app.py.
_ALERT_FIELDS = (
    "minPrice", "maxPrice", "minBedrooms", "maxBedrooms", "minBathrooms",
    "source", "councilTaxBands", "propertyTypes", "furnishTypes",
    "minSqFt", "maxSqFt", "availableFrom", "availableTo",
    "pinLat", "pinLng", "pinRadius",
)


def _alert_from_payload(payload: dict, *, name: str, alert_id: str,
                       created_at) -> dict:
    alert = {"id": alert_id, "name": name}
    for f in _ALERT_FIELDS:
        alert[f] = payload.get(f)
    alert["excludeShares"] = payload.get("excludeShares", False)
    alert["search"] = payload.get("search", "")
    alert["createdAt"] = created_at
    return alert


def list_alerts_with_subscribers() -> list[dict]:
    alerts = load_alerts()
    chats = load_chats()
    all_chat_ids = [c["chat_id"] for c in chats]
    for alert in alerts:
        aid = alert["id"]
        subscribed_chats = []
        for chat in chats:
            subs = chat.get("alert_ids")
            if subs is None or aid in subs:
                subscribed_chats.append(chat["chat_id"])
        # `chatIds = None` means "subscribed to every chat" — keeps the wire
        # format compact when the alert hasn't been narrowed.
        alert["chatIds"] = subscribed_chats if subscribed_chats != all_chat_ids else None
    return alerts


def create_alert(payload: dict) -> dict:
    alert = _alert_from_payload(
        payload,
        name=payload.get("name", "Untitled alert"),
        alert_id=str(uuid.uuid4()),
        created_at=payload.get("createdAt"),
    )
    chat_ids = payload.get("chatIds")
    alerts = load_alerts()
    alerts.append(alert)
    save_alerts(alerts)
    if chat_ids is not None:
        sync_chat_subscriptions(alert["id"], chat_ids)
    alert["chatIds"] = chat_ids
    return alert


def update_alert(alert_id: str, payload: dict) -> dict:
    alerts = load_alerts()
    idx = next((i for i, a in enumerate(alerts) if a["id"] == alert_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    existing = alerts[idx]
    updated = _alert_from_payload(
        payload,
        name=payload.get("name", existing["name"]),
        alert_id=alert_id,
        created_at=existing.get("createdAt"),
    )
    alerts[idx] = updated
    save_alerts(alerts)

    chat_ids = payload.get("chatIds")
    sync_chat_subscriptions(alert_id, chat_ids)
    updated["chatIds"] = chat_ids
    return updated


def delete_alert(alert_id: str) -> dict:
    alerts = load_alerts()
    new_alerts = [a for a in alerts if a["id"] != alert_id]
    if len(new_alerts) == len(alerts):
        raise HTTPException(status_code=404, detail="Alert not found")
    save_alerts(new_alerts)
    remove_alert_from_chats(alert_id)
    return {"ok": True}


def test_alert(alert_id: str) -> dict:
    alerts = load_alerts()
    alert = next((a for a in alerts if a["id"] == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    config = get_config()
    lf = get_listings_file(
        config["city"] if config else None,
        config["listing_type"] if config else None,
    )
    if not lf.exists():
        lf = LISTINGS_FILE
    if not lf.exists():
        raise HTTPException(status_code=404, detail="No listings file found")
    try:
        data = json.loads(lf.read_text())
        listings = data.get("listings", [])
    except (json.JSONDecodeError, IOError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to read listings: {e}")

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
            images = listing.get("images") or []
            photo = images[0] if images else None
            for cid in targets:
                send_telegram(msg, chat_id=cid, photo_url=photo)
    else:
        for cid in targets:
            send_telegram(
                f'🧪 <b>Test: 0 of {total} listings match "{alert["name"]}"</b>',
                chat_id=cid)

    return {"matches": len(urls), "urls": urls}
