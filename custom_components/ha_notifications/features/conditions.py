"""Validate visual conditions and compile them for Home Assistant."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from homeassistant.helpers.template import TemplateError, result_as_boolean
from pydantic import ConfigDict, Field, field_validator, model_validator

from ..const import ConditionType
from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from ..domain.durations import parse_duration
from ..support.templates import render_template
from .feature_config import AlertFeatureConfig


class ConditionFeature(FeatureBase):
    """Own condition compilation and frontend validation routes."""

    name = "conditions"

    def __init__(self, hass: Any, *_args: Any) -> None:
        super().__init__(hass, *_args)
        self._hass = hass

    @websocket_route(
        "conditions.validate",
        command="validate_conditions",
        arguments=(WebsocketArgument("alert", dict),),
        error_code="condition_invalid",
        error_message="Condition is invalid.",
    )
    async def validate(self, alert: dict[str, Any]) -> bool:
        """Compile and evaluate a condition without persisting an alert."""

        try:
            result = await render_template(
                self._hass, compile_condition(alert)
            )
        except TemplateError as err:
            error = str(err)
        else:
            result_as_boolean(result)
            error = None
        if error is not None:
            raise ValueError(f"Condition template failed: {error}")
        return True

class ConditionConfig(AlertFeatureConfig):
    """Validated visual condition used by the editor and trigger workflow."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    type: str = ConditionType.TEMPLATE.value
    template: str | None = None
    model_for: Any = Field(default=None, alias="for")

    @field_validator("model_for", mode="before")
    @classmethod
    def normalize_duration(cls, value: Any) -> Any:
        if value is None or value == "[object Object]":
            return None
        try:
            parse_duration(value)
        except ValueError:
            return None
        return value

    @model_validator(mode="before")
    @classmethod
    def normalize_input(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return {"template": str(value or "")}
        values = dict(value)
        if "for" in values:
            values["model_for"] = values.pop("for")
        return values


def _seconds(value: Any) -> int:
    """Get whole seconds."""

    duration = parse_duration(value, timedelta())

    return max(0, int(duration.total_seconds()))


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _combine(expressions: list[str], operator: str) -> str:
    if not expressions:
        return ""
    if len(expressions) == 1:
        return expressions[0]
    return "(" + operator.join(expressions) + ")"


def _template_result_name(index: int) -> str:
    return f"nc_condition_{index}"


def _template_condition_block(template: str, result_name: str) -> str | None:
    stripped = template.strip()
    if stripped.startswith("{{") and stripped.endswith("}}"):
        stripped = stripped[2:-2].strip()
        if not stripped:
            return None
        return f"{{% set {result_name} = ({stripped}) %}}"

    if not stripped:
        return None

    if "{%" in stripped:
        return f"{{% set {result_name} %}}{stripped}{{% endset %}}"

    return f"{{% set {result_name} = ({stripped}) %}}"


def compile_condition(alert: Any) -> str:
    """Compile visual conditions into one Jinja condition."""

    expressions: list[str] = []
    template_blocks: list[str] = []

    for condition in alert.get("conditions", []):
        condition = ConditionConfig.model_validate(condition).model_dump(
            exclude_none=True, by_alias=True
        )
        if condition.get("enabled") is False:
            continue

        condition_type = condition.get("type")

        if condition_type == ConditionType.STATE:
            entity_ids = [
                str(item) for item in _list(condition.get("entity_id")) if item
            ]
            states = [str(item) for item in _list(condition.get("state")) if item]

            if not entity_ids or not states:
                continue

            duration = _seconds(condition.get("for"))
            entity_expressions = []

            for entity_id in entity_ids:
                state_expressions = [
                    f"is_state({json.dumps(entity_id)}, {json.dumps(state)})"
                    for state in states
                ]
                expression = _combine(state_expressions, " or ")

                if duration:
                    expression = (
                        "("
                        f"{expression}"
                        " and "
                        f"(now() - states["
                        f"{json.dumps(entity_id)}"
                        "].last_changed)"
                        ".total_seconds() >= "
                        f"{duration}"
                        ")"
                    )

                entity_expressions.append(expression)

            expressions.append(_combine(entity_expressions, " or "))

        elif condition_type == ConditionType.NUMERIC:
            entity_ids = [
                str(item) for item in _list(condition.get("entity_id")) if item
            ]

            if not entity_ids:
                continue

            entity_expressions = []
            duration = _seconds(condition.get("for"))

            for entity_id in entity_ids:
                value = f"states({json.dumps(entity_id)}) | float(0)"
                parts: list[str] = []

                if condition.get("above") is not None:
                    parts.append(f"{value} > {float(condition['above'])}")

                if condition.get("below") is not None:
                    parts.append(f"{value} < {float(condition['below'])}")

                if duration:
                    parts.append(
                        f"(now() - states[{json.dumps(entity_id)}].last_changed)"
                        f".total_seconds() >= {duration}"
                    )

                if parts:
                    entity_expressions.append(_combine(parts, " and "))

            if entity_expressions:
                expressions.append(_combine(entity_expressions, " or "))

        elif condition_type == ConditionType.ATTRIBUTE:
            entity_id = str(condition.get("entity_id", ""))
            attribute = str(condition.get("attribute", ""))
            expected = condition.get("value")

            if entity_id and attribute:
                expressions.append(
                    f"state_attr("
                    f"{json.dumps(entity_id)}, "
                    f"{json.dumps(attribute)}"
                    f") == "
                    f"{json.dumps(expected)}"
                )

        elif condition_type == ConditionType.TEMPLATE:
            template = str(condition.get("template", "")).strip()

            if template:
                result_name = _template_result_name(len(template_blocks))
                block = _template_condition_block(template, result_name)
                if block:
                    template_blocks.append(block)
                    expressions.append(f"({result_name} | bool)")

    if not expressions:
        return "{{ true }}"

    operator = " and "
    if alert.get("logic") in ("any", "or"):
        operator = " or "

    expression = "{{ " + operator.join(expressions) + " }}"
    if template_blocks:
        return "\n".join(template_blocks + [expression])

    return expression
