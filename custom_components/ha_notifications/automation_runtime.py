"""Prepare generated automations for Home Assistant's frontend config API."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypedDict

from homeassistant.components import automation as ha_automation
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import category_registry as cr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import label_registry as lr

from .automation import (
    GENERATED_DESCRIPTION,
    automation_id,
)
from .const import (
    AUTOMATION_CATEGORY,
    AUTOMATION_CATEGORY_SCOPE,
    AUTOMATION_LABEL,
    COMMAND_CANCEL_RUN,
    DOMAIN,
    EVENT_COMMAND,
)
from .history import history_store


class AutomationChanges(TypedDict):
    """Explicit operations for Home Assistant's per-ID automation API."""

    upsert: list[dict[str, Any]]
    delete: list[str]
    description: str


@callback
def track_automation_metadata(
    hass: HomeAssistant,
    entry: Any,
) -> Callable[[], None]:
    """Tag managed entities when HA registers them, without frontend polling."""
    category_registry = cr.async_get(hass)
    category = next(
        (
            item
            for item in category_registry.async_list_categories(
                scope=AUTOMATION_CATEGORY_SCOPE,
            )
            if item.name == AUTOMATION_CATEGORY
        ),
        None,
    )
    if category is None:
        category = category_registry.async_create(
            name=AUTOMATION_CATEGORY,
            scope=AUTOMATION_CATEGORY_SCOPE,
        )
    label_registry = lr.async_get(hass)
    label = label_registry.async_get_label_by_name(AUTOMATION_LABEL)
    if label is None:
        label = label_registry.async_create(name=AUTOMATION_LABEL)
    registry = er.async_get(hass)

    @callback
    def apply_metadata(entity: er.RegistryEntry) -> None:
        if (
            label.label_id in entity.labels
            and entity.categories.get(AUTOMATION_CATEGORY_SCOPE) == category.category_id
        ):
            return
        registry.async_update_entity(
            entity.entity_id,
            labels=entity.labels | {label.label_id},
            categories={**entity.categories, AUTOMATION_CATEGORY_SCOPE: category.category_id},
        )

    @callback
    def entity_created(event: Event) -> None:
        if event.data["action"] != "create":
            return
        entity = registry.async_get(event.data["entity_id"])
        if entity is None or entity.domain != "automation" or entity.platform != "automation":
            return
        runtime = entry.runtime_data
        if any(item["id"] == entity.unique_id for item in runtime.automations or []):
            apply_metadata(entity)

    for automation in entry.runtime_data.automations or []:
        entity_id = registry.async_get_entity_id("automation", "automation", automation["id"])
        if entity_id is not None:
            apply_metadata(registry.entities[entity_id])
    return hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, entity_created)


def automation_changes(
    automations: list[dict[str, Any]],
    deleted_ids: list[str],
) -> AutomationChanges:
    """Build API operations from known IDs, not inferred filesystem contents."""
    return {"upsert": automations, "delete": deleted_ids, "description": GENERATED_DESCRIPTION}


def stale_automation_ids(
    hass: HomeAssistant,
    automations: list[dict[str, Any]],
) -> list[str]:
    """Discover stale IDs only for the explicit Reload recovery action."""
    desired = {item["id"] for item in automations}
    return sorted(
        entity.unique_id
        for entity in er.async_get(hass).entities.values()
        if entity.domain == "automation"
        and entity.platform == "automation"
        and entity.unique_id.startswith(f"{DOMAIN}_")
        and entity.unique_id not in desired
    )


def automation_entity_id(hass: HomeAssistant, alert: dict[str, Any]) -> str:
    """Resolve the automation's current entity ID, including user renames."""
    unique_id = automation_id(alert)
    component = hass.data.get(ha_automation.DATA_COMPONENT)
    for entity in getattr(component, "entities", ()):
        if entity.unique_id == unique_id:
            return entity.entity_id
    return (
        er.async_get(hass).async_get_entity_id("automation", "automation", unique_id)
        or f"automation.{unique_id}"
    )


def active_flow_ids(entries: list[dict[str, Any]], alert_id: str) -> list[str]:
    """Return history flows that have not reported a terminal event."""
    active_statuses = {"started", "waiting", "running"}
    terminal_statuses = {
        "cancelled",
        "completed",
        "inactive",
        "confirmation_completed",
        "confirmation_timeout",
    }
    latest: dict[str, bool] = {}
    for entry in entries:
        config = entry.get("config", {})
        event = entry.get("event", {})
        if not isinstance(config, dict) or not isinstance(event, dict):
            continue
        flow_id = event.get("flow_id")
        event_type = event.get("type")
        if (
            config.get("id") != alert_id
            or not isinstance(flow_id, str)
            or not flow_id
            or event_type not in active_statuses | terminal_statuses
            or flow_id in latest
        ):
            continue
        latest[flow_id] = event_type in active_statuses
    return [flow_id for flow_id, active in latest.items() if active]


async def async_cancel_run(
    hass: HomeAssistant,
    entry: Any,
    alert: dict[str, Any],
) -> bool:
    """Stop a managed run and close its history before replacing configuration."""
    alert_id = alert["id"]
    history = history_store(hass, entry)
    entries = await history.async_entries(alert_id)
    entity_id = automation_entity_id(hass, alert)
    state = hass.states.get(entity_id)
    if not active_flow_ids(entries, alert_id) and (
        state is None or not state.attributes.get("current", 0)
    ):
        return False

    hass.bus.async_fire(
        EVENT_COMMAND,
        {"alert_id": alert_id, "command": COMMAND_CANCEL_RUN},
    )
    if state is not None:
        await hass.services.async_call(
            "automation",
            "turn_off",
            {"entity_id": entity_id, "stop_actions": True},
            blocking=True,
        )
        if alert.get("enabled", True):
            await hass.services.async_call(
                "automation",
                "turn_on",
                {"entity_id": entity_id},
                blocking=True,
            )
    for flow_id in active_flow_ids(await history.async_entries(alert_id), alert_id):
        await history.async_record(
            alert_id,
            str(alert.get("name", alert_id)),
            "cancelled",
            "Automation run cancelled",
            {"action": "automation_cancelled"},
            flow_id=flow_id,
        )
    return True


async def async_cancel_changed_automations(
    hass: HomeAssistant,
    entry: Any,
    automations: list[dict[str, Any]],
) -> None:
    """Cancel only changed or deleted runs while their alert config still exists."""
    runtime = getattr(entry, "runtime_data", None)
    previous = getattr(runtime, "automations", None) or []
    desired = {item["id"]: item for item in automations}
    changed = {item["id"] for item in previous if desired.get(item["id"]) != item}
    if not changed:
        return
    for alert in runtime.config["alerts"]:
        if automation_id(alert) in changed:
            await async_cancel_run(hass, entry, alert)


def generated_automation(
    document: list[dict[str, Any]],
    alert: dict[str, Any],
) -> dict[str, Any] | None:
    """Return the generated automation document owned by ``alert``."""
    unique_id = automation_id(alert)
    return next((item for item in document if item.get("id") == unique_id), None)


def automation_status(
    document: list[dict[str, Any]],
    alert: dict[str, Any],
) -> str:
    """Return the ownership/status projection for one generated automation."""
    generated = generated_automation(document, alert)
    if generated is None:
        return "missing"
    if generated.get("description") != GENERATED_DESCRIPTION:
        return "conflict"
    if generated.get("initial_state") is False:
        return "disabled"
    return "managed"


def automation_runtime_status(
    hass: HomeAssistant,
    document: list[dict[str, Any]],
    alert: dict[str, Any],
) -> dict[str, Any]:
    """Combine ownership metadata with non-invasive HA runtime metadata."""
    state = hass.states.get(automation_entity_id(hass, alert))
    generated = generated_automation(document, alert) or {}
    current = state.attributes.get("current", 0) if state is not None else 0
    status = automation_status(document, alert)
    if status == "managed" and state is None:
        status = "missing"
    runtime_status = {
        "status": status,
        "enabled": state is not None and state.state == "on",
        "mode": generated.get("mode", "single"),
        "current": current if isinstance(current, int) else 0,
    }
    if generated:
        runtime_status["automation_id"] = generated["id"]
    return runtime_status
