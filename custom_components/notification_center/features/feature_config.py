"""Shared marker for feature-owned alert configuration models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class AlertFeatureConfig(BaseModel):
    """Marker model for configuration owned by an alert feature."""

    model_config = ConfigDict(extra="allow")
