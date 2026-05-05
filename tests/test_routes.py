"""End-to-end route tests for the FastAPI server.

These hit the app via TestClient (in-process, no real HTTP). The DATA_DIR is
redirected to a per-test temp directory via the `isolated_data_dir` fixture
so we don't trample real alerts.json / chats.json on disk.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def isolated_data_dir(tmp_path, monkeypatch):
    """Point the server's DATA_DIR + alerts/chats files at a tmp dir.

    server_lib.config captures DATA_DIR at import time, so we have to patch
    the module-level constants directly — env var changes after import are
    ignored.
    """
    from server_lib import config as cfg

    monkeypatch.setattr(cfg, "DATA_DIR", tmp_path)
    monkeypatch.setattr(cfg, "ALERTS_FILE", tmp_path / "alerts.json")
    monkeypatch.setattr(cfg, "CHATS_FILE", tmp_path / "chat_ids.json")
    monkeypatch.setattr(cfg, "CONFIG_FILE", tmp_path / "config.json")

    # data_store.py captured ALERTS_FILE / CHATS_FILE by name, not by ref.
    from server_lib import data_store
    monkeypatch.setattr(data_store, "ALERTS_FILE", tmp_path / "alerts.json")
    monkeypatch.setattr(data_store, "CHATS_FILE", tmp_path / "chat_ids.json")
    return tmp_path


@pytest.fixture
def client():
    from server_lib.app import app
    with TestClient(app) as c:
        yield c


def test_status_returns_setup_needed_when_no_listings(client, isolated_data_dir):
    resp = client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] in ("setup_needed", "ready")  # depends on host filesystem
    assert "telegram_configured" in body


def test_sources_endpoint_returns_known_providers(client):
    resp = client.get("/api/sources")
    assert resp.status_code == 200
    sources = resp.json()["sources"]
    names = {s["name"] for s in sources}
    assert "rightmove" in names
    assert "openrent" in names


def test_alerts_round_trip(client, isolated_data_dir):
    # Initially empty
    resp = client.get("/api/alerts")
    assert resp.status_code == 200
    assert resp.json() == []

    # Create
    payload = {
        "name": "Cheap 2-beds",
        "maxPrice": 1500,
        "minBedrooms": 2,
        "search": "balcony",
    }
    resp = client.post("/api/alerts", json=payload)
    assert resp.status_code == 201
    created = resp.json()
    assert created["name"] == "Cheap 2-beds"
    assert created["maxPrice"] == 1500
    assert created["minBedrooms"] == 2
    assert "id" in created
    alert_id = created["id"]

    # Read
    resp = client.get("/api/alerts")
    assert resp.status_code == 200
    alerts = resp.json()
    assert len(alerts) == 1
    assert alerts[0]["id"] == alert_id

    # Update
    resp = client.put(f"/api/alerts/{alert_id}", json={"name": "Renamed", "maxPrice": 2000})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
    assert resp.json()["maxPrice"] == 2000

    # Delete
    resp = client.delete(f"/api/alerts/{alert_id}")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    # Confirm deletion
    resp = client.get("/api/alerts")
    assert resp.json() == []


def test_alert_put_unknown_id_returns_404(client, isolated_data_dir):
    resp = client.put("/api/alerts/no-such-id", json={"name": "x"})
    assert resp.status_code == 404


def test_alert_delete_unknown_id_returns_404(client, isolated_data_dir):
    resp = client.delete("/api/alerts/no-such-id")
    assert resp.status_code == 404


def test_alert_post_with_invalid_json_returns_422(client, isolated_data_dir):
    # `pages` field expects an int for /api/setup; sending a non-decodable
    # body to /api/alerts triggers FastAPI's auto-validation.
    resp = client.post(
        "/api/alerts",
        content=b"not-json-at-all",
        headers={"Content-Type": "application/json"},
    )
    # FastAPI returns 422 for bad JSON bodies on a typed endpoint.
    assert resp.status_code == 422


def test_setup_rejects_missing_city(client, isolated_data_dir):
    resp = client.post("/api/setup", json={"city": "", "type": "rent"})
    assert resp.status_code == 400
    assert "city" in resp.json()["detail"].lower()


def test_setup_rejects_invalid_type(client, isolated_data_dir):
    resp = client.post("/api/setup", json={"city": "Manchester", "type": "lease"})
    assert resp.status_code == 400


def test_setup_rejects_unknown_source(client, isolated_data_dir):
    resp = client.post("/api/setup", json={
        "city": "Manchester", "type": "rent", "source": "made-up",
    })
    assert resp.status_code == 400


def test_telegram_status_reports_unconfigured_by_default(client, isolated_data_dir, monkeypatch):
    # Ensure no token leaks in from the dev environment.
    from server_lib import config as cfg
    monkeypatch.setattr(cfg, "TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setattr(cfg, "TELEGRAM_CHAT_ID", "")
    resp = client.get("/api/telegram/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is False
    assert body["has_bot_token"] is False


def test_telegram_setup_requires_token(client, isolated_data_dir):
    resp = client.post("/api/telegram/setup", json={"bot_token": "", "chat_id": ""})
    assert resp.status_code == 400


def test_chats_endpoint_returns_list(client, isolated_data_dir):
    resp = client.get("/api/chats")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_add_chat_then_appears_in_list(client, isolated_data_dir):
    resp = client.post("/api/telegram/add-chat", json={
        "chat_id": "123456789", "name": "Tester",
    })
    assert resp.status_code == 201
    resp = client.get("/api/chats")
    chat_ids = [c["chat_id"] for c in resp.json()]
    assert "123456789" in chat_ids


def test_add_chat_duplicate_returns_409(client, isolated_data_dir):
    client.post("/api/telegram/add-chat", json={"chat_id": "999", "name": "A"})
    resp = client.post("/api/telegram/add-chat", json={"chat_id": "999", "name": "B"})
    assert resp.status_code == 409


def test_request_size_limit_rejects_oversized_body(client, isolated_data_dir):
    # Claim a 2 MB body; middleware should refuse before any handler runs.
    huge = b"x" * 2_000_000
    resp = client.post("/api/alerts", content=huge,
                       headers={"Content-Type": "application/json",
                                "Content-Length": str(len(huge))})
    assert resp.status_code == 413


def test_unknown_api_path_returns_404_not_spa(client, isolated_data_dir):
    resp = client.get("/api/no-such-route")
    assert resp.status_code == 404
    # Should be JSON detail, not the React index.html shell.
    assert "text/html" not in resp.headers.get("content-type", "").lower()
