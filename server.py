#!/usr/bin/env python3
"""Property listings server entry point.

Thin wrapper around the FastAPI app in `server_lib.app`. Launches uvicorn,
which gives us graceful SIGTERM handling, request size limits, and a real
ASGI loop in place of the old hand-rolled `ThreadingHTTPServer`.

CLI: `python server.py [PORT] [UI_DIR]`
  PORT defaults to 8080.
  UI_DIR defaults to "." — points at the built React `dist/` directory so
  the SPA fallback in app.py can serve `index.html` and assets.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server_lib import config as cfg


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    cfg.ui_dir = Path(os.path.abspath(directory))

    # Import after cfg.ui_dir is set so the app picks up the right path.
    import uvicorn
    from server_lib.app import app

    print(f"Serving on http://0.0.0.0:{port} (ui_dir: {cfg.ui_dir})", flush=True)
    # access_log=False keeps the noisy per-request logging suppressed, matching
    # the behaviour of the old AppHandler.log_message override.
    uvicorn.run(app, host="0.0.0.0", port=port, access_log=False)


if __name__ == "__main__":
    main()
