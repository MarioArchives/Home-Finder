#!/usr/bin/env python3
"""
Property listings HTTP server.

Serves the React SPA, provides REST API for setup, alerts, and Telegram config.
Route handlers are in server/routes_*.py; data helpers in server/data_store.py.
"""

import json
import os
import re
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# Add src/ to Python path so all internal imports resolve
sys.path.insert(0, str(Path(__file__).parent / "src"))

from server_lib.config import load_telegram_env
from server_lib.routes_setup import handle_status, handle_setup_post, handle_setup_progress, handle_setup_preferences, handle_sources
from server_lib.routes_alerts import (
    handle_alerts_get, handle_alerts_post, handle_alert_test,
    handle_alert_put, handle_alert_delete,
)
from server_lib.routes_telegram import (
    handle_telegram_status, handle_chats_get, handle_telegram_setup,
    handle_discover_chats, handle_add_chat,
)
from server_lib.routes_cron import handle_cron_status
from server_lib.telegram_listener import start_listener

from server_lib import config as cfg

load_telegram_env()


class AppHandler(SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path == "/api/status":
            handle_status(self)
        elif self.path == "/api/sources":
            handle_sources(self)
        elif self.path == "/api/setup/progress":
            handle_setup_progress(self)
        elif self.path == "/api/alerts":
            handle_alerts_get(self)
        elif self.path == "/api/chats":
            handle_chats_get(self)
        elif self.path == "/api/telegram/status":
            handle_telegram_status(self)
        elif self.path == "/api/cron/status":
            handle_cron_status(self)
        else:
            # SPA fallback
            path = self.translate_path(self.path)
            if not os.path.exists(path) and not self.path.startswith("/api/"):
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/setup":
            body = self._read_json_body()
            if body is None: return
            handle_setup_post(self, body)

        elif (m := re.match(r"^/api/alerts/([^/]+)/test$", self.path)):
            handle_alert_test(self, m.group(1))

        elif self.path == "/api/alerts":
            body = self._read_json_body()
            if body is None: return
            handle_alerts_post(self, body)

        elif self.path == "/api/setup/preferences":
            body = self._read_json_body()
            if body is None: return
            handle_setup_preferences(self, body)

        elif self.path == "/api/telegram/setup":
            body = self._read_json_body()
            if body is None: return
            handle_telegram_setup(self, body)

        elif self.path == "/api/telegram/discover-chats":
            handle_discover_chats(self)

        elif self.path == "/api/telegram/add-chat":
            body = self._read_json_body()
            if body is None: return
            handle_add_chat(self, body)

        else:
            self._json_response(404, {"error": "Not found"})

    def do_PUT(self):
        if (m := re.match(r"^/api/alerts/([^/]+)$", self.path)):
            body = self._read_json_body()
            if body is None:
                return
            handle_alert_put(self, m.group(1), body)
        else:
            self._json_response(404, {"error": "Not found"})

    def do_DELETE(self):
        if self.path.startswith("/api/alerts/"):
            alert_id = self.path[len("/api/alerts/"):]
            handle_alert_delete(self, alert_id)
        else:
            self._json_response(404, {"error": "Not found"})

    # ---- Helpers ----

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, ValueError):
            self._json_response(400, {"error": "Invalid JSON"})
            return None

    def _json_response(self, status: int, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        if args and isinstance(args[0], str) and args[0].startswith("GET"):
            return
        super().log_message(format, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    cfg.ui_dir = Path(os.path.abspath(directory))
    os.chdir(directory)
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Serving on http://0.0.0.0:{port} (directory: {directory})")
    start_listener()
    server.serve_forever()


if __name__ == "__main__":
    main()
