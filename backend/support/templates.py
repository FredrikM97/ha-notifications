"""Home Assistant template rendering helpers shared by feature workflows."""

from __future__ import annotations

import inspect
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.template import Template


async def render_template(
    hass: HomeAssistant,
    source: str,
    variables: dict[str, Any] | None = None,
) -> Any:
    """Render one template using Home Assistant's template engine."""

    result = Template(source, hass).async_render(
        variables,
        parse_result=True,
        strict=False,
    )
    if inspect.isawaitable(result):
        return await result
    return result