"""Pure template-value rendering shared by controller sub-managers.

No Home Assistant import here - `render` is injected as a plain async
callable (`core.py` passes `gateway.render_template`), so this module never
touches the gateway itself.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

Render = Callable[[str, dict[str, Any]], Awaitable[Any]]


async def render_value(render: Render, value: Any, variables: dict[str, Any]) -> Any:
    """Recursively render templates inside scalars, lists, and mappings."""

    if isinstance(value, str):
        if not any(marker in value for marker in ("{{", "{%", "{#")):
            return value
        return await render(value, variables)

    if isinstance(value, list):
        return [await render_value(render, item, variables) for item in value]

    if isinstance(value, dict):
        return {
            key: await render_value(render, item, variables)
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
