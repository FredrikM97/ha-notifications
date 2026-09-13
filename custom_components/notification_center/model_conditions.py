"""Condition compilation for Notification Center alerts."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from .durations import parse_duration


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


def compile_condition(alert: dict[str, Any]) -> str:
    """Compile visual conditions into one Jinja condition."""

    expressions: list[str] = []
    template_blocks: list[str] = []

    for condition in alert.get("conditions", []):
        if condition.get("enabled") is False:
            continue

        condition_type = condition.get("type")

        if condition_type == "state":
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

        elif condition_type == "numeric":
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
                    entity_expressions.append(
                        _combine(parts, " and ")
                    )

            if entity_expressions:
                expressions.append(
                    _combine(entity_expressions, " or ")
                )

        elif condition_type == "attribute":
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

        elif condition_type == "template":
            template = str(condition.get("template", "")).strip()

            if template:
                result_name = _template_result_name(len(template_blocks))
                block = _template_condition_block(template, result_name)
                if block:
                    template_blocks.append(block)
                    expressions.append(f"({result_name} | bool)")

    if not expressions:
        return "{{ true }}"

    operator = " or " if alert.get("logic") in ("any", "or") else " and "

    expression = "{{ " + operator.join(expressions) + " }}"
    if template_blocks:
        return "\n".join(template_blocks + [expression])

    return expression