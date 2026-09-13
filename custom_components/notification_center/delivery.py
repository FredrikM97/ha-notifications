"""Notification delivery rendering, targeting, and dispatch."""

from __future__ import annotations

import inspect
import logging
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.template import Template
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(f"{__package__}.notifications")


@dataclass(frozen=True)
class LegacyMobileAppResolution:
    """Verified direct Mobile App delivery candidates for selected targets."""

    device_ids: set[str]
    services: list[str]


@dataclass(frozen=True)
class NotificationTargetResolution:
    """Expanded device, area, and config-entry targets for notification delivery."""

    device_ids: set[str]
    area_ids: set[str]
    config_entry_ids: set[str]


@dataclass
class RenderedNotification:
    """Template-rendered notification values ready for delivery planning."""

    title: Any
    message: Any
    target: dict[str, Any]
    extra_data: dict[str, Any]
    action: str
    confirmation: Any
    has_user_recipients: bool


@dataclass
class NotificationDeliveryPlan:
    """Resolved services and target for a notification delivery."""

    actions_to_call: list[str]
    route: str
    target: dict[str, Any]
    legacy_resolution: LegacyMobileAppResolution
    requested_counts: dict[str, int]


async def _async_render_template(template: Template, *args: Any, **kwargs: Any) -> Any:
    result = template.async_render(*args, **kwargs)
    if inspect.isawaitable(result):
        return await result
    return result


async def _render_value(
    hass: HomeAssistant, value: Any, variables: dict[str, Any]
) -> Any:
    """Recursively render templates."""
    if isinstance(value, str):
        if not any(marker in value for marker in ("{{", "{%", "{#")):
            return value
        return await _async_render_template(
            Template(value, hass), variables, parse_result=True, strict=False
        )
    if isinstance(value, list):
        return [await _render_value(hass, item, variables) for item in value]
    if isinstance(value, dict):
        return {
            key: await _render_value(hass, item, variables)
            for key, item in value.items()
        }
    return value


def _remove_none(value: Any) -> Any:
    """Remove null values before sending service data to Home Assistant."""
    if isinstance(value, dict):
        return {
            key: _remove_none(item) for key, item in value.items() if item is not None
        }
    if isinstance(value, list):
        return [_remove_none(item) for item in value if item is not None]
    return value


_GENERIC_NOTIFY_TARGET_KEYS = (
    "device_id",
    "area_id",
    "floor_id",
    "label_id",
    "entity_id",
)


def _target_values(target: dict[str, Any], key: str) -> list[str]:
    values = target.get(key, [])
    if not isinstance(values, list):
        values = [values]
    return [str(value) for value in values if value]


def _user_device_ids(
    hass: HomeAssistant, entity_registry: Any, user_ids: list[str]
) -> dict[str, set[str]]:
    devices_by_user = {user_id: set() for user_id in user_ids}
    states = getattr(hass, "states", None)
    if states is None:
        return devices_by_user
    for person in states.async_all("person"):
        user_id = str(person.attributes.get("user_id") or "")
        if user_id not in devices_by_user:
            continue
        trackers = person.attributes.get("device_trackers", [])
        if isinstance(trackers, str):
            trackers = [trackers]
        if not isinstance(trackers, list):
            continue
        for tracker in trackers:
            entry = entity_registry.entities.get(str(tracker))
            device_id = getattr(entry, "device_id", None)
            if device_id:
                devices_by_user[user_id].add(str(device_id))
    return devices_by_user


def _resolve_user_notification_target(
    hass: HomeAssistant, target: Any
) -> tuple[dict[str, Any], bool]:
    if not isinstance(target, dict):
        return {}, False
    resolved_target = {
        key: deepcopy(target[key])
        for key in _GENERIC_NOTIFY_TARGET_KEYS
        if key in target
    }
    user_ids = _target_values(target, "user_id")
    if not user_ids:
        return resolved_target, False
    entity_registry = er.async_get(hass)
    mobile_app_entries = hass.config_entries.async_entries("mobile_app")
    entry_user_ids = {
        entry.entry_id: str(entry.data.get("user_id"))
        for entry in mobile_app_entries
        if isinstance(getattr(entry, "data", None), dict) and entry.data.get("user_id")
    }
    entities_by_user = {user_id: [] for user_id in user_ids}
    device_ids_by_user = _user_device_ids(hass, entity_registry, user_ids)
    for entity in entity_registry.entities.values():
        if not entity.entity_id.startswith("notify."):
            continue
        mobile_app_user_id = entry_user_ids.get(
            getattr(entity, "config_entry_id", None)
        )
        for user_id in user_ids:
            if (
                mobile_app_user_id == user_id
                or getattr(entity, "device_id", None) in device_ids_by_user[user_id]
            ):
                entities_by_user[user_id].append(entity.entity_id)
    missing_user_ids = [
        user_id for user_id in user_ids if not entities_by_user[user_id]
    ]
    if missing_user_ids:
        raise ValueError(
            "Selected user has no notification-capable device: "
            + ", ".join(missing_user_ids)
        )
    entity_ids = _target_values(resolved_target, "entity_id")
    for user_id in user_ids:
        for entity_id in entities_by_user[user_id]:
            if entity_id not in entity_ids:
                entity_ids.append(entity_id)
    resolved_target["entity_id"] = entity_ids
    return resolved_target, True


def _resolve_target_devices(
    target: Any, area_registry: Any, device_registry: Any
) -> NotificationTargetResolution:
    """Expand device targets selected directly or through area, floor, and label."""
    if not isinstance(target, dict):
        return NotificationTargetResolution(set(), set(), set())
    device_ids = set(_target_values(target, "device_id"))
    area_ids = set(_target_values(target, "area_id"))
    floor_ids = set(_target_values(target, "floor_id"))
    label_ids = set(_target_values(target, "label_id"))
    area_ids.update(
        area.area_id
        for area in area_registry.areas.values()
        if area.floor_id in floor_ids
    )
    for device in device_registry.devices.values():
        if device.area_id in area_ids or label_ids.intersection(
            getattr(device, "labels", set())
        ):
            device_ids.add(device.id)
    config_entry_ids = {
        entry_id
        for device in device_registry.devices.values()
        if device.id in device_ids
        for entry_id in getattr(device, "config_entries", set())
    }
    return NotificationTargetResolution(device_ids, area_ids, config_entry_ids)


def _notification_entities_for_target(
    target: dict[str, Any],
    entity_registry: Any,
    resolution: NotificationTargetResolution,
) -> list[str]:
    """Find notify entities matching expanded target selectors."""
    entity_ids = _target_values(target, "entity_id")
    label_ids = set(_target_values(target, "label_id"))
    services = []
    for entity in entity_registry.entities.values():
        if (
            entity.entity_id.startswith("notify.")
            and (
                entity.entity_id in entity_ids
                or entity.device_id in resolution.device_ids
                or getattr(entity, "config_entry_id", None)
                in resolution.config_entry_ids
                or entity.area_id in resolution.area_ids
                or label_ids.intersection(getattr(entity, "labels", set()))
            )
            and entity.entity_id not in services
        ):
            services.append(entity.entity_id)
    return services


def _notification_services_for_target(
    hass: HomeAssistant,
    target: Any,
    resolution: NotificationTargetResolution | None = None,
) -> list[str]:
    if not isinstance(target, dict):
        return []
    device_registry, entity_registry = dr.async_get(hass), er.async_get(hass)
    resolution = resolution or _resolve_target_devices(
        target, ar.async_get(hass), device_registry
    )
    return _notification_entities_for_target(target, entity_registry, resolution)


def _mobile_app_entry_ids(mobile_app_entries: list[Any]) -> set[str]:
    """Return config entry IDs belonging to the Mobile App integration."""
    return {entry.entry_id for entry in mobile_app_entries}


def _mobile_app_entry_ids_for_entities(
    entity_ids: list[str], entity_registry: Any, mobile_app_entry_ids: set[str]
) -> tuple[set[str], set[str]]:
    """Resolve Mobile App entries and devices from selected notify entities."""
    entry_ids, device_ids = set(), set()
    for entity_id in entity_ids:
        entity = entity_registry.entities.get(entity_id)
        entry_id = getattr(entity, "config_entry_id", None)
        if entry_id in mobile_app_entry_ids:
            entry_ids.add(entry_id)
        if device_id := getattr(entity, "device_id", None):
            device_ids.add(device_id)
    return entry_ids, device_ids


def _mobile_app_entry_ids_and_names_for_devices(
    device_ids: set[str], device_registry: Any, mobile_app_entry_ids: set[str]
) -> tuple[set[str], dict[str, list[str]]]:
    """Find Mobile App entries and device names for resolved devices."""
    entry_ids, names_by_entry_id = set(), {}
    for device_id in device_ids:
        device = device_registry.devices.get(device_id)
        if device is None:
            continue
        for entry_id in set(getattr(device, "config_entries", set())).intersection(
            mobile_app_entry_ids
        ):
            entry_ids.add(entry_id)
            for name in (
                getattr(device, "name_by_user", None),
                getattr(device, "name", None),
            ):
                if name:
                    names_by_entry_id.setdefault(entry_id, []).append(str(name))
    return entry_ids, names_by_entry_id


def _add_mobile_app_entry_names(
    mobile_app_entries: list[Any],
    entry_ids: set[str],
    names_by_entry_id: dict[str, list[str]],
) -> None:
    """Add Mobile App entry titles and configured device names."""
    for entry in mobile_app_entries:
        if entry.entry_id not in entry_ids:
            continue
        entry_data = (
            getattr(entry, "data", {})
            if isinstance(getattr(entry, "data", {}), dict)
            else {}
        )
        for name in (getattr(entry, "title", None), entry_data.get("device_name")):
            if name:
                names_by_entry_id.setdefault(entry.entry_id, []).append(str(name))


def _legacy_mobile_app_service_name(name: str) -> str:
    """Normalize a Mobile App device name to its legacy notify service name."""
    return "mobile_app_" + name.lower().replace(" ", "_").replace("-", "_")


def _verified_legacy_mobile_app_services(
    hass: HomeAssistant, names_by_entry_id: dict[str, list[str]]
) -> list[str]:
    """Derive unique legacy services and retain only registered services."""
    services = []
    for names in names_by_entry_id.values():
        for name in names:
            service = _legacy_mobile_app_service_name(name)
            if service not in services and hass.services.has_service("notify", service):
                services.append(service)
    return services


def _legacy_mobile_app_services_for_target(
    hass: HomeAssistant,
    target: Any,
    entity_ids: list[str],
    resolution: NotificationTargetResolution | None = None,
) -> LegacyMobileAppResolution:
    if not isinstance(target, dict):
        return LegacyMobileAppResolution(set(), [])
    area_registry, device_registry, entity_registry = (
        ar.async_get(hass),
        dr.async_get(hass),
        er.async_get(hass),
    )
    mobile_app_entries = hass.config_entries.async_entries("mobile_app")
    resolution = resolution or _resolve_target_devices(
        target, area_registry, device_registry
    )
    mobile_app_entry_ids = _mobile_app_entry_ids(mobile_app_entries)
    mobile_entry_ids, entity_device_ids = _mobile_app_entry_ids_for_entities(
        entity_ids, entity_registry, mobile_app_entry_ids
    )
    device_ids = resolution.device_ids | entity_device_ids
    device_entry_ids, names_by_entry_id = _mobile_app_entry_ids_and_names_for_devices(
        device_ids, device_registry, mobile_app_entry_ids
    )
    mobile_entry_ids.update(device_entry_ids)
    _add_mobile_app_entry_names(
        mobile_app_entries, mobile_entry_ids, names_by_entry_id
    )
    return LegacyMobileAppResolution(
        device_ids, _verified_legacy_mobile_app_services(hass, names_by_entry_id)
    )


async def _async_render_notification(
    hass: HomeAssistant, notification: dict[str, Any], variables: dict[str, Any]
) -> RenderedNotification:
    title = await _render_value(hass, notification.get("title", ""), variables)
    message = await _render_value(hass, notification.get("message", ""), variables)
    target = await _render_value(hass, notification.get("target", {}), variables)
    target, has_user_recipients = _resolve_user_notification_target(hass, target)
    extra_data = await _render_value(hass, notification.get("data", {}), variables)
    return RenderedNotification(
        title,
        message,
        target,
        _remove_none(deepcopy(extra_data)) if isinstance(extra_data, dict) else {},
        str(notification.get("action") or ""),
        notification.get("confirmation", {}),
        has_user_recipients,
    )


def _notification_delivery_plan(
    hass: HomeAssistant, rendered: RenderedNotification
) -> NotificationDeliveryPlan:
    target_resolution = _resolve_target_devices(
        rendered.target, ar.async_get(hass), dr.async_get(hass)
    )
    resolved_actions = _notification_services_for_target(
        hass, rendered.target, target_resolution
    )
    legacy_resolution = _legacy_mobile_app_services_for_target(
        hass, rendered.target, resolved_actions, target_resolution
    )
    requested_counts = {
        key: len(_target_values(rendered.target, key))
        for key in _GENERIC_NOTIFY_TARGET_KEYS + ("user_id",)
        if _target_values(rendered.target, key)
    }
    has_target = any(
        values for values in rendered.target.values() if isinstance(values, (str, list))
    )
    explicit_legacy_action = rendered.action.startswith(
        "notify.mobile_app_"
    ) and hass.services.has_service("notify", rendered.action.split(".", 1)[1])
    if legacy_resolution.services:
        actions_to_call, route = (
            [f"notify.{service}" for service in legacy_resolution.services],
            "legacy_mobile_app",
        )
    elif explicit_legacy_action:
        actions_to_call, route = [rendered.action], "explicit_legacy_mobile_app"
    elif (
        rendered.action == "notify.send_message"
        or rendered.has_user_recipients
        or has_target
    ):
        actions_to_call, route = ["notify.send_message"], "generic_notify"
    elif rendered.action:
        actions_to_call, route = [rendered.action], "explicit_action"
    else:
        raise ValueError(
            "No valid notify service was found for the selected recipients."
        )
    return NotificationDeliveryPlan(
        actions_to_call, route, rendered.target, legacy_resolution, requested_counts
    )


def _validate_confirmation_delivery(
    alert_id: str, has_confirmation: bool, plan: NotificationDeliveryPlan
) -> None:
    if has_confirmation and plan.route not in (
        "legacy_mobile_app",
        "explicit_legacy_mobile_app",
    ):
        _LOGGER.warning(
            "Confirmation delivery unavailable alert_id=%s requested=%s "
            "resolved_devices=%d candidate_legacy_services=%s route=%s",
            alert_id,
            plan.requested_counts,
            len(plan.legacy_resolution.device_ids),
            plan.legacy_resolution.services,
            plan.route,
        )
        raise ValueError(
            "Confirmation buttons require a resolved Mobile App direct service; "
            "resolved devices: "
            f"{len(plan.legacy_resolution.device_ids)}, services: "
            f"{len(plan.legacy_resolution.services)}."
        )


def _service_data_for_notification(
    rendered: RenderedNotification,
    confirmation_action_id: str | None,
    has_confirmation: bool,
) -> dict[str, Any]:
    extra_data = rendered.extra_data
    if has_confirmation:
        actions = list(extra_data.get("actions", []))
        actions.append(
            {
                "action": confirmation_action_id,
                "title": rendered.confirmation.get("button", "Done") or "Done",
            }
        )
        extra_data["actions"] = actions
    service_data = {"message": str(rendered.message)}
    if rendered.title:
        service_data["title"] = str(rendered.title)
    if extra_data:
        service_data["data"] = extra_data
    return _remove_none(service_data)


async def _async_dispatch_notification(
    hass: HomeAssistant,
    plan: NotificationDeliveryPlan,
    service_data: dict[str, Any],
    action: str,
    extra_data: dict[str, Any],
    context: Context | None,
) -> None:
    if action and "." not in action:
        raise ValueError(f"Invalid notification action: {action}")
    for action_to_call in plan.actions_to_call:
        if "." not in action_to_call:
            raise ValueError(f"Invalid notification action: {action_to_call}")
        domain, service = action_to_call.split(".", 1)
        try:
            await hass.services.async_call(
                domain,
                service,
                service_data=service_data,
                target=None
                if plan.route in ("legacy_mobile_app", "explicit_legacy_mobile_app")
                else plan.target,
                blocking=True,
                context=context,
            )
        except Exception as err:
            detail = str(err)
            if action_to_call == "notify.send_message" and extra_data:
                detail = (
                    f"{detail} The selected notification recipient does not accept "
                    "notification data such as confirmation actions."
                )
            raise RuntimeError(
                f"Notification service {action_to_call} rejected the payload: {detail}"
            ) from err


class NotificationDispatcher:
    """Send notifications through Home Assistant."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def async_send(
        self,
        alert: dict[str, Any],
        *,
        attempt: int,
        confirmation_action_id: str | None,
        context: Context | None,
        test: bool = False,
    ) -> None:
        notification = alert["notification"]
        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "attempt": attempt,
            "test": test,
            "now": dt_util.now(),
            "notification_id": f"notification_center_{alert['id']}",
            "confirmation_action_id": confirmation_action_id,
        }
        rendered = await _async_render_notification(self.hass, notification, variables)
        has_confirmation = bool(
            confirmation_action_id and rendered.confirmation.get("enabled", False)
        )
        plan = _notification_delivery_plan(self.hass, rendered)
        _LOGGER.debug(
            "Notification delivery plan alert_id=%s requested=%s "
            "resolved_devices=%d candidate_legacy_services=%s",
            alert["id"],
            plan.requested_counts,
            len(plan.legacy_resolution.device_ids),
            plan.legacy_resolution.services,
        )
        _validate_confirmation_delivery(alert["id"], has_confirmation, plan)
        _LOGGER.info(
            "Notification delivery alert_id=%s route=%s recipients=%d",
            alert["id"],
            plan.route,
            len(plan.actions_to_call),
        )
        await _async_dispatch_notification(
            self.hass,
            plan,
            _service_data_for_notification(
                rendered, confirmation_action_id, has_confirmation
            ),
            rendered.action,
            rendered.extra_data,
            context,
        )

    async def async_clear(
        self, alert: dict[str, Any], *, context: Context | None
    ) -> None:
        notification, action = (
            alert["notification"],
            str(alert["notification"].get("action") or ""),
        )
        target = await _render_value(
            self.hass,
            notification.get("target", {}),
            {
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "now": dt_util.now(),
            },
        )
        target_resolution = _resolve_target_devices(
            target, ar.async_get(self.hass), dr.async_get(self.hass)
        )
        resolved_actions = _notification_services_for_target(
            self.hass, target, target_resolution
        )
        legacy_resolution = _legacy_mobile_app_services_for_target(
            self.hass, target, resolved_actions, target_resolution
        )
        actions_to_call = (
            [f"notify.{service}" for service in legacy_resolution.services]
            if legacy_resolution.services
            else [action]
            if action.startswith("notify.")
            else []
        )
        for action_to_call in actions_to_call:
            domain, service = action_to_call.split(".", 1)
            await self.hass.services.async_call(
                domain,
                service,
                service_data={
                    "message": "clear_notification",
                    "data": {"tag": f"notification_center_{alert['id']}"},
                },
                target=None
                if legacy_resolution.services
                else target
                if target
                else None,
                blocking=True,
                context=context,
            )
