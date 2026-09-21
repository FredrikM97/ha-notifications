"""Home Assistant Jinja evaluation shared by feature workflows."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from typing import Any
from weakref import WeakKeyDictionary

from homeassistant.core import HomeAssistant
from homeassistant.helpers.template import Template

TemplateRenderer = Callable[[str, dict[str, Any]], Awaitable[Any]]


class JinjaEvaluator:
    """Evaluate Home Assistant Jinja templates and configured values."""

    _instances: WeakKeyDictionary[HomeAssistant, JinjaEvaluator] = (
        WeakKeyDictionary()
    )

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    @classmethod
    def for_hass(cls, hass: HomeAssistant) -> JinjaEvaluator:
        """Return the evaluator shared by one Home Assistant instance."""

        try:
            evaluator = cls._instances.get(hass)
        except TypeError:
            return cls(hass)
        if evaluator is None:
            evaluator = cls(hass)
            try:
                cls._instances[hass] = evaluator
            except TypeError:
                return evaluator
        return evaluator

    async def render(
        self,
        source: str,
        variables: dict[str, Any] | None = None,
    ) -> Any:
        """Render one template using Home Assistant's template engine."""

        result = Template(source, self._hass).async_render(
            variables,
            parse_result=True,
            strict=False,
        )
        if inspect.isawaitable(result):
            return await result
        return result

    async def values(self, value: Any, variables: dict[str, Any]) -> Any:
        """Render Jinja values recursively within lists and mappings."""

        return await render_values(value, variables, self.render)


async def render_values(
    value: Any, variables: dict[str, Any], render: TemplateRenderer
) -> Any:
    """Render configured values recursively with a Jinja evaluator."""

    if isinstance(value, str):
        if not any(marker in value for marker in ("{{", "{%", "{#")):
            return value
        return await render(value, variables)
    if isinstance(value, list):
        return [await render_values(item, variables, render) for item in value]
    if isinstance(value, dict):
        return {
            key: await render_values(item, variables, render)
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
