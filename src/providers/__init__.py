"""Provider registry — single source of truth for listing sources.

Adding a new source: write a `Provider` class that subclasses
`ListingProvider`, set its metadata classvars (display_name, icon, color,
bg, supports_buy) and scrape methods, then register the class in
`PROVIDERS` below. Nothing else in the app should hardcode source names.
"""

from providers.openrent import OpenRentProvider
from providers.rightmove import RightmoveProvider
from providers.zoopla import ZooplaProvider

PROVIDERS = {
    "rightmove": RightmoveProvider,
    "zoopla": ZooplaProvider,
    "openrent": OpenRentProvider,
}

# Convenience aliases accepted everywhere a `source` value is parsed (CLI,
# setup wizard, alert checker, cron env). "both" is kept purely for backwards
# compatibility with configs/cron files written before more than two
# providers existed — it now resolves identically to "all" so existing
# installs automatically pick up newly-added providers without the user
# having to re-run setup.
SOURCE_ALIASES: dict[str, list[str]] = {
    "all": list(PROVIDERS.keys()),
    "both": list(PROVIDERS.keys()),
}


def get_provider(name: str):
    """Return an instantiated provider by name."""
    cls = PROVIDERS.get(name)
    if cls is None:
        raise ValueError(
            f"Unknown provider '{name}'. Available: {', '.join(PROVIDERS)}"
        )
    return cls()


def get_all_provider_names() -> list[str]:
    """Return sorted list of all registered provider names."""
    return sorted(PROVIDERS.keys())


def resolve_sources(value: str) -> list[str]:
    """Resolve a CLI/config `source` value into a concrete list of provider names.

    Accepts:
      - a registered alias (e.g. "all", "both"), expanded via SOURCE_ALIASES;
      - a single provider name;
      - a comma-separated list of provider names.

    Unknown names raise ValueError so callers can surface a clear error
    instead of silently scraping nothing.
    """
    value = (value or "").strip()
    if not value:
        raise ValueError("source value is empty")
    if value in SOURCE_ALIASES:
        return [n for n in SOURCE_ALIASES[value] if n in PROVIDERS]
    names = [s.strip() for s in value.split(",") if s.strip()]
    unknown = [n for n in names if n not in PROVIDERS]
    if unknown:
        raise ValueError(
            f"Unknown source(s): {', '.join(unknown)}. "
            f"Available: {', '.join(get_all_provider_names())}"
        )
    return names


def list_provider_meta() -> list[dict]:
    """Serialised provider metadata for the UI (`/api/sources`)."""
    return [
        {
            "name": cls.name,
            "display_name": cls.display_name or cls.name,
            "icon": cls.icon,
            "color": cls.color,
            "bg": cls.bg,
            "supports_buy": cls.supports_buy,
        }
        for cls in PROVIDERS.values()
    ]


def valid_source_values() -> set[str]:
    """All accepted `source` strings — provider names plus aliases."""
    return set(PROVIDERS.keys()) | set(SOURCE_ALIASES.keys())
