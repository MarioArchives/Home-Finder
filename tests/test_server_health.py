"""Smoke test: the FastAPI app boots and /api/status responds."""

from fastapi.testclient import TestClient

from server_lib.app import app


def test_status_endpoint_responds():
    with TestClient(app) as client:
        resp = client.get("/api/status")
    assert resp.status_code == 200
    payload = resp.json()
    assert "status" in payload
    assert "telegram_configured" in payload


def test_sources_endpoint_lists_providers():
    with TestClient(app) as client:
        resp = client.get("/api/sources")
    assert resp.status_code == 200
    payload = resp.json()
    assert "sources" in payload
    assert isinstance(payload["sources"], list)
    assert len(payload["sources"]) > 0


def test_unknown_api_route_404s():
    with TestClient(app) as client:
        resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
