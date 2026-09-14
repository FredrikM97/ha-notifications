"""Pure notification composition: decide what to send/clear and to whom.

Replaces the old `delivery/` folder (`dispatch.py`, `rendering.py`,
`planning.py`, `recipients.py`, `mobile_app.py`, `execution.py`). This
module never touches Home Assistant: `render` and `has_service` are
injected callables (bound to `ha/gateway.py` methods by `controller/core.py`
at call time), and `RegistrySnapshot` is plain data `core.py` fetched once.
Every public function returns `list[Command]` for `core.py` to execute.
"""

from __future__ import annotations

import logging
from copy import deepcopy
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Callable

from .commands import CallService, Command
from .rendering import Render, remove_none, render_value

_LOGGER = logging.getLogger(__name__)

HasService = Callable[[str, str], bool]


class NotificationRoute(StrEnum):
    """How a notification was resolved to concrete notify service calls."""

    LEGACY_MOBILE_APP = "legacy_mobile_app"
    EXPLICIT_LEGACY_MOBILE_APP = "explicit_legacy_mobile_app"
    GENERIC_NOTIFY = "generic_notify"
    EXPLICIT_ACTION = "explicit_action"


GENERIC_NOTIFY_TARGET_KEYS = (
    "device_id",
    "area_id",
    "floor_id",
    "label_id",
    "entity_id",
)


# ----------------------------------------------------------------------
# Plain data
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class RegistrySnapshot:
    """Home Assistant registries/state needed to plan one delivery, as data."""

    area_registry: Any
    device_registry: Any
    entity_registry: Any
    mobile_app_entries: list[Any]
    mobile_app_entry_ids: set[str]
    person_states: list[Any]


@dataclass(frozen=True)
class _LegacyMobileAppResolution:
    device_ids: set[str]
    services: list[str]


@dataclass(frozen=True)
class _TargetResolution:
    device_ids: set[str]
    area_ids: set[str]
    config_entry_ids: set[str]


@dataclass
class _RenderedNotification:
    title: Any
    message: Any
    target: dict[str, Any]
    extra_data: dict[str, Any]
    action: str
    confirmation: Any
    has_user_recipients: bool


# ----------------------------------------------------------------------
# Public entry points
# ----------------------------------------------------------------------


async def compose_send(
    alert: dict[str, Any],
    variables: dict[str, Any],
    confirmation_action_id: str | None,
    snapshot: RegistrySnapshot,
    render: Render,
    has_service: HasService,
) -> list[Command]:
    """Build the Home Assistant service calls that send one notification."""

    notification = alert["notification"]
    rendered = await _render_notification(notification, variables, render, snapshot)
    has_confirmation = bool(
        confirmation_action_id and rendered.confirmation.get("enabled", False)
    )

    resolution = _resolve_target_devices(rendered.target, snapshot)
    resolved_actions = _notification_services_for_target(
        snapshot, rendered.target, resolution
    )
    legacy = _legacy_mobile_app_services_for_target(
        snapshot, resolved_actions, resolution.device_ids, has_service
    )
    requested_counts = _requested_target_counts(rendered.target)
    route_name, actions_to_call = _notification_route(
        snapshot, rendered, legacy.services, has_service
    )

    _log_plan(alert["id"], route_name, actions_to_call, requested_counts, legacy)
    _validate_confirmation_delivery(alert["id"], has_confirmation, route_name, legacy)

    service_data = _service_data_for_notification(
        rendered, confirmation_action_id, has_confirmation
    )
    target = (
        None
        if route_name
        in (NotificationRoute.LEGACY_MOBILE_APP, NotificationRoute.EXPLICIT_LEGACY_MOBILE_APP)
        else rendered.target
    )

    commands: list[Command] = []
    for action_to_call in actions_to_call:
        if "." not in action_to_call:
            raise ValueError(f"Invalid notification action: {action_to_call}")
        domain, service = action_to_call.split(".", 1)
        commands.append(CallService(domain, service, service_data, target))

    return commands


async def compose_clear(
    alert: dict[str, Any],
    variables: dict[str, Any],
    snapshot: RegistrySnapshot,
    render: Render,
    has_service: HasService,
) -> list[Command]:
    """Build the Home Assistant service calls that clear one notification."""

    notification = alert["notification"]
    target = await render_value(render, notification.get("target", {}), variables)
    if not isinstance(target, dict):
        target = {}

    resolution = _resolve_target_devices(target, snapshot)
    resolved_actions = _notification_services_for_target(snapshot, target, resolution)
    legacy = _legacy_mobile_app_services_for_target(
        snapshot, resolved_actions, resolution.device_ids, has_service
    )
    action = str(notification.get("action") or "")

    if legacy.services:
        actions_to_call = [f"notify.{service}" for service in legacy.services]
        clear_target = None
    elif action.startswith("notify."):
        actions_to_call = [action]
        clear_target = target or None
    else:
        actions_to_call = []
        clear_target = target or None

    commands: list[Command] = []
    for action_to_call in actions_to_call:
        domain, service = action_to_call.split(".", 1)
        commands.append(
            CallService(
                domain,
                service,
                {
                    "message": "clear_notification",
                    "data": {"tag": f"notification_center_{alert['id']}"},
                },
                clear_target,
            )
        )

    return commands


# ----------------------------------------------------------------------
# Rendering (was delivery/rendering.py)
# ----------------------------------------------------------------------


async def _render_notification(
    notification: dict[str, Any],
    variables: dict[str, Any],
    render: Render,
    snapshot: RegistrySnapshot,
) -> _RenderedNotification:
    title = await render_value(render, notification.get("title", ""), variables)
    message = await render_value(render, notification.get("message", ""), variables)
    target = await render_value(render, notification.get("target", {}), variables)
    target, has_user_recipients = _resolve_user_notification_target(snapshot, target)
    extra_data = await render_value(render, notification.get("data", {}), variables)

    return _RenderedNotification(
        title,
        message,
        target,
        _normalized_extra_data(extra_data),
        str(notification.get("action") or ""),
        notification.get("confirmation", {}),
        has_user_recipients,
    )


def _normalized_extra_data(extra_data: Any) -> dict[str, Any]:
    if not isinstance(extra_data, dict):
        return {}
    return remove_none(deepcopy(extra_data))


# ----------------------------------------------------------------------
# Recipients (was delivery/recipients.py)
# ----------------------------------------------------------------------


def target_values(target: dict[str, Any], key: str) -> list[str]:
    """Return a target field as a non-empty list of strings."""

    values = target.get(key, [])
    if not isinstance(values, list):
        values = [values]
    return [str(value) for value in values if value]


def _resolve_user_notification_target(
    snapshot: RegistrySnapshot, target: Any
) -> tuple[dict[str, Any], bool]:
    if not isinstance(target, dict):
        return {}, False

    resolved_target = {
        key: deepcopy(target[key])
        for key in GENERIC_NOTIFY_TARGET_KEYS
        if key in target
    }
    user_ids = target_values(target, "user_id")
    if not user_ids:
        return resolved_target, False

    entry_user_ids = {
        entry.entry_id: str(entry.data.get("user_id"))
        for entry in snapshot.mobile_app_entries
        if isinstance(getattr(entry, "data", None), dict) and entry.data.get("user_id")
    }
    entities_by_user: dict[str, list[str]] = {user_id: [] for user_id in user_ids}
    device_ids_by_user = _user_device_ids(snapshot, user_ids)

    for entity in snapshot.entity_registry.entities.values():
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

    entity_ids = target_values(resolved_target, "entity_id")
    for user_id in user_ids:
        for entity_id in entities_by_user[user_id]:
            if entity_id not in entity_ids:
                entity_ids.append(entity_id)
    resolved_target["entity_id"] = entity_ids

    return resolved_target, True


def _resolve_target_devices(
    target: Any, snapshot: RegistrySnapshot
) -> _TargetResolution:
    if not isinstance(target, dict):
        return _TargetResolution(set(), set(), set())

    device_ids = set(target_values(target, "device_id"))
    area_ids = set(target_values(target, "area_id"))
    floor_ids = set(target_values(target, "floor_id"))
    label_ids = set(target_values(target, "label_id"))

    area_ids.update(
        area.area_id
        for area in snapshot.area_registry.areas.values()
        if area.floor_id in floor_ids
    )

    for device in snapshot.device_registry.devices.values():
        if device.area_id in area_ids or label_ids.intersection(
            getattr(device, "labels", set())
        ):
            device_ids.add(device.id)

    config_entry_ids = {
        entry_id
        for device in snapshot.device_registry.devices.values()
        if device.id in device_ids
        for entry_id in getattr(device, "config_entries", set())
    }

    return _TargetResolution(device_ids, area_ids, config_entry_ids)


def _notification_services_for_target(
    snapshot: RegistrySnapshot,
    target: Any,
    resolution: _TargetResolution | None = None,
) -> list[str]:
    if not isinstance(target, dict):
        return []

    resolution = resolution or _resolve_target_devices(target, snapshot)
    entity_ids = target_values(target, "entity_id")
    label_ids = set(target_values(target, "label_id"))
    services = []

    for entity in snapshot.entity_registry.entities.values():
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


def _user_device_ids(
    snapshot: RegistrySnapshot, user_ids: list[str]
) -> dict[str, set[str]]:
    devices_by_user: dict[str, set[str]] = {user_id: set() for user_id in user_ids}

    for person in snapshot.person_states:
        user_id = str(person.attributes.get("user_id") or "")
        if user_id not in devices_by_user:
            continue

        trackers = person.attributes.get("device_trackers", [])
        if isinstance(trackers, str):
            trackers = [trackers]
        if not isinstance(trackers, list):
            continue

        for tracker in trackers:
            entry = snapshot.entity_registry.entities.get(str(tracker))
            device_id = getattr(entry, "device_id", None)
            if device_id:
                devices_by_user[user_id].add(str(device_id))

    return devices_by_user


# ----------------------------------------------------------------------
# Mobile app legacy resolution (was delivery/mobile_app.py)
# ----------------------------------------------------------------------


def _legacy_mobile_app_services_for_target(
    snapshot: RegistrySnapshot,
    entity_ids: list[str],
    device_ids: set[str],
    has_service: HasService,
) -> _LegacyMobileAppResolution:
    mobile_entry_ids, entity_device_ids = _mobile_app_entry_ids_for_entities(
        entity_ids, snapshot.entity_registry, snapshot.mobile_app_entry_ids
    )
    resolved_device_ids = device_ids | entity_device_ids
    device_entry_ids, names_by_entry_id = _mobile_app_entry_ids_and_names_for_devices(
        resolved_device_ids, snapshot.device_registry, snapshot.mobile_app_entry_ids
    )
    mobile_entry_ids.update(device_entry_ids)
    _add_mobile_app_entry_names(
        snapshot.mobile_app_entries, mobile_entry_ids, names_by_entry_id
    )

    return _LegacyMobileAppResolution(
        resolved_device_ids,
        _verified_legacy_mobile_app_services(names_by_entry_id, has_service),
    )


def _mobile_app_entry_ids_for_entities(
    entity_ids: list[str],
    entity_registry: Any,
    mobile_app_entry_ids: set[str],
) -> tuple[set[str], set[str]]:
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
    device_ids: set[str],
    device_registry: Any,
    mobile_app_entry_ids: set[str],
) -> tuple[set[str], dict[str, list[str]]]:
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
    return "mobile_app_" + name.lower().replace(" ", "_").replace("-", "_")


def _verified_legacy_mobile_app_services(
    names_by_entry_id: dict[str, list[str]],
    has_service: HasService,
) -> list[str]:
    services = []
    for names in names_by_entry_id.values():
        for name in names:
            service = _legacy_mobile_app_service_name(name)
            if service not in services and has_service("notify", service):
                services.append(service)
    return services


# ----------------------------------------------------------------------
# Route planning (was delivery/planning.py)
# ----------------------------------------------------------------------


def _notification_route(
    snapshot: RegistrySnapshot,
    rendered: _RenderedNotification,
    legacy_services: list[str],
    has_service: HasService,
) -> tuple[str, list[str]]:
    if legacy_services:
        return NotificationRoute.LEGACY_MOBILE_APP, [
            f"notify.{service}" for service in legacy_services
        ]

    if _is_explicit_legacy_action(rendered.action, has_service):
        return NotificationRoute.EXPLICIT_LEGACY_MOBILE_APP, [rendered.action]

    if _uses_generic_notify(rendered):
        return NotificationRoute.GENERIC_NOTIFY, ["notify.send_message"]

    if rendered.action:
        return NotificationRoute.EXPLICIT_ACTION, [rendered.action]

    raise ValueError("No valid notify service was found for the selected recipients.")


def _is_explicit_legacy_action(action: str, has_service: HasService) -> bool:
    if not action.startswith("notify.mobile_app_"):
        return False
    return has_service("notify", action.split(".", 1)[1])


def _uses_generic_notify(rendered: _RenderedNotification) -> bool:
    if rendered.action == "notify.send_message":
        return True
    if rendered.has_user_recipients:
        return True
    return any(
        values for values in rendered.target.values() if isinstance(values, (str, list))
    )


def _requested_target_counts(target: dict[str, Any]) -> dict[str, int]:
    return {
        key: len(target_values(target, key))
        for key in GENERIC_NOTIFY_TARGET_KEYS + ("user_id",)
        if target_values(target, key)
    }


def _validate_confirmation_delivery(
    alert_id: str,
    has_confirmation: bool,
    route_name: str,
    legacy: _LegacyMobileAppResolution,
) -> None:
    if has_confirmation and route_name not in (
        NotificationRoute.LEGACY_MOBILE_APP,
        NotificationRoute.EXPLICIT_LEGACY_MOBILE_APP,
    ):
        raise ValueError(
            "Confirmation buttons require a resolved Mobile App direct service; "
            f"resolved devices: {len(legacy.device_ids)}, services: "
            f"{len(legacy.services)}."
        )


def _service_data_for_notification(
    rendered: _RenderedNotification,
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

    service_data: dict[str, Any] = {"message": str(rendered.message)}
    if rendered.title:
        service_data["title"] = str(rendered.title)
    if extra_data:
        service_data["data"] = extra_data

    return remove_none(service_data)


def _log_plan(
    alert_id: str,
    route_name: str,
    actions_to_call: list[str],
    requested_counts: dict[str, int],
    legacy: _LegacyMobileAppResolution,
) -> None:
    _LOGGER.debug(
        "Notification delivery plan alert_id=%s requested=%s "
        "resolved_devices=%d candidate_legacy_services=%s",
        alert_id,
        requested_counts,
        len(legacy.device_ids),
        legacy.services,
    )
    _LOGGER.info(
        "Notification delivery alert_id=%s route=%s recipients=%d",
        alert_id,
        route_name,
        len(actions_to_call),
    )
