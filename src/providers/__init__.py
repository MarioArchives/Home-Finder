"""Provider registry — maps provider names to their classes."""

from providers.rightmove import RightmoveProvider
from providers.zoopla import ZooplaProvider

PROVIDERS = {
    "rightmove": RightmoveProvider,
    "zoopla": ZooplaProvider,
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
