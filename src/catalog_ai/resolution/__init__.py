"""Select already normalized/validated candidates; never invent values."""
from .resolver import resolve_and_score

__all__ = ["resolve_and_score"]
