"""Plain Home Assistant service-call values produced by feature workflows."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ServiceCall(BaseModel):
    """One service call ready for Home Assistant execution."""

    model_config = ConfigDict(frozen=True)

    domain: str
    service: str
    data: dict[str, Any] = Field(default_factory=dict)
    target: dict[str, Any] | None = None