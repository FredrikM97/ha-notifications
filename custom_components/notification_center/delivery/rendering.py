"""Template rendering for notification delivery."""

from __future__ import annotations

import inspect
from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.template import Template

from .recipients import resolve_user_notification_target
from .types import NotificationRegistrySnapshot, RenderedNotification


async def async_render_template(template: Template, *args: Any, **kwargs: Any) -> Any:
    """Render a Home Assistant template that may return awaitable results."""

    result = template.async_render(*args, **kwargs)
    if inspect.isawaitable(result):
        return await result
    return result


async def render_value(
    hass: HomeAssistant,
    value: Any,
    variables: dict[str, Any],
) -> Any:
    """Recursively render templates."""

    if isinstance(value, str):
        if not any(marker in value for marker in ("{{", "{%", "{#")):
            return value
        return await async_render_template(
            Template(value, hass), variables, parse_result=True, strict=False
        )

    if isinstance(value, list):
        return [await render_value(hass, item, variables) for item in value]

    if isinstance(value, dict):
        return {
            key: await render_value(hass, item, variables)
            for key, item in value.items()
        }

    return value


def remove_none(value: Any) -> Any:
    """Remove null values before sending service data to Home Assistant."""

    if isinstance(value, dict):
        return {
            key: remove_none(item) for key, item in value.items() if item is not None
        }

    if isinstance(value, list):
        return [remove_none(item) for item in value if item is not None]

    return value


async def async_render_notification(
    hass: HomeAssistant,
    notification: dict[str, Any],
    variables: dict[str, Any],
    registries: NotificationRegistrySnapshot,
) -> RenderedNotification:
    """Render a configured notification into values ready for planning."""

    title = await render_value(hass, notification.get("title", ""), variables)
    message = await render_value(hass, notification.get("message", ""), variables)
    target = await render_value(hass, notification.get("target", {}), variables)
    target, has_user_recipients = resolve_user_notification_target(registries, target)
    extra_data = await render_value(hass, notification.get("data", {}), variables)

    return RenderedNotification(
        title,
        message,
        target,
        remove_none(deepcopy(extra_data)) if isinstance(extra_data, dict) else {},
        str(notification.get("action") or ""),
        notification.get("confirmation", {}),
        has_user_recipients,
    )