"""Registration helpers for feature-owned alert configuration fields."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import BaseModel


FeatureModel = type[BaseModel]
FeatureDefaultFactory = Callable[[], Any]

_REGISTERED_FEATURES: dict[str, tuple[FeatureModel, Any]] = {}


def register_alert_feature(
    field_name: str,
    model: FeatureModel,
    *,
    default: Any = None,
    default_factory: FeatureDefaultFactory | None = None,
) -> None:
    """Register one feature-owned field on the flat alert document."""

    if default_factory is not None:
        field_default: Any = default_factory
    else:
        field_default = default
    _REGISTERED_FEATURES[field_name] = (model, field_default)


def registered_alert_features() -> dict[str, tuple[FeatureModel, Any]]:
    """Return registered fields in registration order."""

    return dict(_REGISTERED_FEATURES)
