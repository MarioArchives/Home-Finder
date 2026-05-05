"""Put `src/` on sys.path so tests can `from alerts.alert_filter import ...`
exactly the way the production code does (it relies on PYTHONPATH=/app/src
in the Dockerfile)."""

import sys
from pathlib import Path

_SRC = Path(__file__).parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
