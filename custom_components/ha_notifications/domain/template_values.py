"""Render nested template configuration and prepare service-call data."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Awaitable, Callable

from .confirmation import ConfirmationContext

TemplateRenderer = Callable[[str, dict[str, Any]], Awaitable[Any]]


def template_context(
    alert: Mapping[str, Any],
    attempt: int,
    now: Any,
    test: bool,
    *,
    notification_id: str | None = None,
    condition_facts: Mapping[str, bool] | None = None,
    trigger: str = "",
    confirmation: ConfirmationContext | None = None,
) -> dict[str, Any]:
    """Build the common template context at the rendering boundary."""

    values: dict[str, Any] = {
        "alert_id": alert["id"],
        "alert_name": alert["name"],
        "alert_active": True,
        "attempt": attempt,
        "test": test,
        "now": now,
        "notification_id": notification_id or f"ha_notifications_{alert['id']}",
        "conditions": dict(condition_facts or {}),
        "condition": dict(condition_facts or {}),
        "trigger": trigger,
    }
    if confirmation:
        values.update(confirmation.template_values())
    return values


async def render_template_values(
    value: Any, variables: dict[str, Any], render: TemplateRenderer
) -> Any:
    """Render Jinja values recursively within configured lists and mappings."""

    if isinstance(value, str):
        if not any(marker in value for marker in ("{{", "{%", "{#")):
            return value
        return await render(value, variables)
    if isinstance(value, list):
        return [
            await render_template_values(item, variables, render) for item in value
        ]
    if isinstance(value, dict):
        return {
            key: await render_template_values(item, variables, render)
            for key, item in value.items()
        }
    return value


def remove_nulls(value: Any) -> Any:
    """Remove null values from service-call data."""

    if isinstance(value, dict):
        return {
            key: remove_nulls(item) for key, item in value.items() if item is not None
        }
    if isinstance(value, list):
        return [remove_nulls(item) for item in value if item is not None]
    return value