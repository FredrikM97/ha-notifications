"""Normalize/validate incoming frontend payloads - the one real logic piece
at the frontend boundary. Everything else in `bridge/` is a thin
pass-through to `controller/core.py`.
"""

from __future__ import annotations

from typing import Any

from ..domain.alert_schema import DEFAULT_CONFIG_NORMALIZER


def normalize_alert(alert: dict[str, Any]) -> dict[str, Any]:
    """Normalize an incoming alert payload into the canonical shape."""

    return DEFAULT_CONFIG_NORMALIZER.normalize_alert_document(alert)
