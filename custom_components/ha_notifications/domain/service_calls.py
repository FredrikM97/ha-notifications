"""Plain Home Assistant service-call values produced by feature workflows."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field

from .confirmation import ConfirmationContext

if TYPE_CHECKING:
    from .runtime import AlertRuntimeState


class HomeAssistantServiceCall(BaseModel):
    """One service call ready for Home Assistant execution."""

    model_config = ConfigDict(frozen=True)

    domain: str
    service: str
    data: dict[str, Any] = Field(default_factory=dict)
    target: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class FollowUpActionsRequest:
    """Typed request for ordered post-delivery follow-up actions."""

    runtime: AlertRuntimeState
    actions: tuple[Mapping[str, Any], ...] = ()
    confirmation: ConfirmationContext | None = None
