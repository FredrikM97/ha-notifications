"""Notification Center runtime engine."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime
import inspect
import logging
from typing import Any
import uuid

from homeassistant.const import (
    EVENT_HOMEASSISTANT_STARTED,
)
from homeassistant.core import (
    Context,
    Event,
    HomeAssistant,
    callback,
)
from homeassistant.helpers.event import (
    TrackTemplate,
    TrackTemplateResult,
    async_track_template_result,
    async_track_time_interval,
)
from homeassistant.helpers.template import (
    Template,
    TemplateError,
    result_as_boolean,
)
from homeassistant.util import dt as dt_util

from .const import (
    EVENT_NOTIFICATION_ACTION,
    MAX_HISTORY,
)
from .models import (
    compile_condition,
    normalize_config,
    parse_duration,
)
from .storage import NotificationStorage

_LOGGER = logging.getLogger(__name__)


async def _async_render_template(
    template: Template,
    *args: Any,
    **kwargs: Any,
) -> Any:
    """Render a template across Home Assistant template API variants."""

    result = template.async_render(
        *args,
        **kwargs,
    )
    if inspect.isawaitable(result):
        return await result
    return result


async def _render_value(
    hass: HomeAssistant,
    value: Any,
    variables: dict[str, Any],
) -> Any:
    """Recursively render templates."""

    if isinstance(value, str):
        if not any(
            marker in value
            for marker in (
                "{{",
                "{%",
                "{#",
            )
        ):
            return value

        template = Template(
            value,
            hass,
        )

        return await _async_render_template(
            template,
            variables,
            parse_result=True,
            strict=False,
        )

    if isinstance(value, list):
        return [
            await _render_value(
                hass,
                item,
                variables,
            )
            for item in value
        ]

    if isinstance(value, dict):
        return {
            key: await _render_value(
                hass,
                item,
                variables,
            )
            for key, item in value.items()
        }

    return value


def _remove_none(value: Any) -> Any:
    """Remove null values before sending service data to Home Assistant."""
    if isinstance(value, dict):
        return {
            key: _remove_none(item)
            for key, item in value.items()
            if item is not None
        }

    if isinstance(value, list):
        return [
            _remove_none(item)
            for item in value
            if item is not None
        ]

    return value


_GENERIC_NOTIFY_TARGET_KEYS = (
    "device_id",
    "area_id",
    "floor_id",
    "label_id",
    "entity_id",
)


def _target_values(
    target: dict[str, Any],
    key: str,
) -> list[str]:
    """Return non-empty target values as strings."""
    values = target.get(key, [])
    if not isinstance(values, list):
        values = [values]
    return [str(value) for value in values if value]


def _resolve_user_notification_target(
    hass: HomeAssistant,
    target: Any,
) -> tuple[dict[str, Any], bool]:
    """Resolve user IDs to mobile-app notify entities for generic notify."""
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

    try:
        from homeassistant.helpers import entity_registry as er

        entity_registry = er.async_get(hass)
        mobile_app_entries = hass.config_entries.async_entries("mobile_app")
    except (AttributeError, ImportError):
        mobile_app_entries = []
        entity_registry = None

    entry_user_ids = {
        entry.entry_id: str(entry.data.get("user_id"))
        for entry in mobile_app_entries
        if isinstance(getattr(entry, "data", None), dict)
        and entry.data.get("user_id")
    }
    entities_by_user = {user_id: [] for user_id in user_ids}

    if entity_registry is not None:
        for entity in entity_registry.entities.values():
            user_id = entry_user_ids.get(
                getattr(entity, "config_entry_id", None)
            )
            if (
                user_id in entities_by_user
                and entity.entity_id.startswith("notify.")
            ):
                entities_by_user[user_id].append(entity.entity_id)

    missing_user_ids = [
        user_id
        for user_id in user_ids
        if not entities_by_user[user_id]
    ]
    if missing_user_ids:
        raise ValueError(
            "Selected user has no notification-capable mobile_app device: "
            f"{', '.join(missing_user_ids)}"
        )

    entity_ids = _target_values(resolved_target, "entity_id")
    for user_id in user_ids:
        for entity_id in entities_by_user[user_id]:
            if entity_id not in entity_ids:
                entity_ids.append(entity_id)
    resolved_target["entity_id"] = entity_ids
    return resolved_target, True


def _notification_services_for_target(
    hass: HomeAssistant,
    target: Any,
) -> list[str]:
    """Resolve notify entities for device, area, and label targets."""
    if not isinstance(target, dict):
        return []

    try:
        from homeassistant.helpers import device_registry as dr
        from homeassistant.helpers import entity_registry as er
    except ImportError:
        return []

    device_registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)
    area_registry = None
    try:
        from homeassistant.helpers import area_registry as ar

        area_registry = ar.async_get(hass)
    except ImportError:
        pass

    device_ids = {
        str(value)
        for value in target.get("device_id", [])
    }
    area_ids = {
        str(value)
        for value in target.get("area_id", [])
    }
    floor_ids = {
        str(value)
        for value in target.get("floor_id", [])
    }
    label_ids = {
        str(value)
        for value in target.get("label_id", [])
    }

    if isinstance(
        target.get("device_id"),
        str,
    ):
        device_ids = {target["device_id"]}
    if isinstance(
        target.get("area_id"),
        str,
    ):
        area_ids = {target["area_id"]}
    if isinstance(
        target.get("floor_id"),
        str,
    ):
        floor_ids = {target["floor_id"]}
    if isinstance(
        target.get("label_id"),
        str,
    ):
        label_ids = {target["label_id"]}

    floor_area_ids = set()
    if area_registry is not None:
        floor_area_ids = {
            area.area_id
            for area in area_registry.areas.values()
            if area.floor_id in floor_ids
        }
        area_ids.update(floor_area_ids)

    for device in device_registry.devices.values():
        if (
            device.area_id in area_ids
            or label_ids.intersection(
                getattr(device, "labels", set())
            )
        ):
            device_ids.add(device.id)

    services = []

    for entity in entity_registry.entities.values():
        if not entity.entity_id.startswith("notify."):
            continue

        entity_labels = getattr(
            entity,
            "labels",
            set(),
        )

        matches = (
            entity.entity_id in target.get(
                "entity_id",
                [],
            )
            or entity.device_id in device_ids
            or entity.area_id in area_ids
            or label_ids.intersection(entity_labels)
        )

        if matches and entity.entity_id not in services:
            services.append(entity.entity_id)

    return services


class NotificationDispatcher:
    """Send notifications through Home Assistant."""

    def __init__(
        self,
        hass: HomeAssistant,
    ) -> None:
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
        """Send one notification."""

        notification = alert[
            "notification"
        ]

        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "attempt": attempt,
            "test": test,
            "now": dt_util.now(),
            "notification_id": (
                f"notification_center_"
                f"{alert['id']}"
            ),
            "confirmation_action_id": (
                confirmation_action_id
            ),
        }

        title = await _render_value(
            self.hass,
            notification.get(
                "title",
                "",
            ),
            variables,
        )

        message = await _render_value(
            self.hass,
            notification.get(
                "message",
                "",
            ),
            variables,
        )

        target = await _render_value(
            self.hass,
            notification.get(
                "target",
                {},
            ),
            variables,
        )

        target, has_user_recipients = (
            _resolve_user_notification_target(
                self.hass,
                target,
            )
        )

        extra_data = await _render_value(
            self.hass,
            notification.get(
                "data",
                {},
            ),
            variables,
        )

        if not isinstance(
            extra_data,
            dict,
        ):
            extra_data = {}

        extra_data = _remove_none(
            deepcopy(extra_data)
        )

        confirmation = notification.get(
            "confirmation",
            {},
        )

        action = str(
            notification.get("action") or ""
        )

        resolved_actions = _notification_services_for_target(
            self.hass,
            target,
        )

        has_target = isinstance(target, dict) and any(
            values
            for values in target.values()
            if isinstance(values, (str, list))
        )

        if action == "notify.send_message" or has_user_recipients or (
            not action and (resolved_actions or has_target)
        ):
            actions_to_call = [
                "notify.send_message"
            ]
        else:
            actions_to_call = [action]

        if not action and actions_to_call:
            action = actions_to_call[0]

        if not action:
            raise ValueError(
                "No valid notify service was found for the selected "
                "devices, areas, labels, or notification entities."
            )

        if (
            confirmation_action_id
            and confirmation.get(
                "enabled",
                False,
            )
        ):
            actions = list(
                extra_data.get(
                    "actions",
                    [],
                )
            )

            actions.append(
                {
                    "action": confirmation_action_id,
                    "title": confirmation.get(
                        "button",
                        "Done",
                    ),
                }
            )

            extra_data["actions"] = actions

        service_data = {
            "message": str(
                message
            ),
        }

        if title:
            service_data["title"] = str(
                title
            )

        if extra_data:
            service_data["data"] = (
                extra_data
            )

        service_data = _remove_none(
            service_data
        )

        if "." not in action:
            raise ValueError(
                f"Invalid notification action: {action}"
            )

        for action_to_call in actions_to_call:
            if "." not in action_to_call:
                raise ValueError(
                    f"Invalid notification action: {action_to_call}"
                )

            if confirmation_action_id:
                if action_to_call == "notify.send_message":
                    recipients = resolved_actions or [
                        str(entity_id)
                        for entity_id in target.get(
                            "entity_id",
                            [],
                        )
                        if str(entity_id).startswith("notify.")
                    ]
                    if not recipients and not has_target:
                        raise ValueError(
                            "Confirmation buttons require at least one "
                            "notification recipient."
                        )

            domain, service = action_to_call.split(
                ".",
                1,
            )

            try:
                await self.hass.services.async_call(
                    domain,
                    service,
                    service_data=service_data,
                    target=(
                        None
                        if action_to_call != "notify.send_message"
                        and action_to_call in resolved_actions
                        else target
                    ),
                    blocking=True,
                    context=context,
                )
            except Exception as err:
                detail = str(err)
                if (
                    action_to_call == "notify.send_message"
                    and extra_data
                ):
                    detail = (
                        f"{detail} The selected notification recipient "
                        "does not accept notification data such as "
                        "confirmation actions."
                    )

                raise RuntimeError(
                    f"Notification service {action_to_call} rejected "
                    f"the payload: {detail}"
                ) from err

    async def async_clear(
        self,
        alert: dict[str, Any],
        *,
        context: Context | None,
    ) -> None:
        """Clear a notification when supported."""

        notification = alert[
            "notification"
        ]

        action = str(
            notification.get("action") or ""
        )

        if not action.startswith(
            "notify."
        ):
            return

        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "now": dt_util.now(),
        }

        target = await _render_value(
            self.hass,
            notification.get(
                "target",
                {},
            ),
            variables,
        )

        data = {
            "message": "clear_notification",
            "data": {
                "tag": (
                    f"notification_center_"
                    f"{alert['id']}"
                )
            },
        }

        domain, service = action.split(
            ".",
            1,
        )

        await self.hass.services.async_call(
            domain,
            service,
            service_data=data,
            target=(
                target
                if target
                else None
            ),
            blocking=True,
            context=context,
        )


class NotificationCenter:
    """Notification Center runtime manager."""

    def __init__(
        self,
        hass: HomeAssistant,
    ) -> None:
        self.hass = hass

        self.storage = NotificationStorage(
            hass
        )

        self.dispatcher = NotificationDispatcher(
            hass
        )

        self.alerts: dict[
            str,
            dict[str, Any],
        ] = {}

        self.state: dict[str, Any] = {
            "alerts": {},
            "history": [],
        }

        self._templates: dict[
            str,
            Template,
        ] = {}

        self._template_unsubs: dict[
            str,
            Any,
        ] = {}

        self._interval_unsubs: dict[
            str,
            Any,
        ] = {}

        self._tasks: set[
            asyncio.Task[Any]
        ] = set()

        self._confirmation_unsub = None
        self._started_unsub = None

        self._started = False
        self._reload_lock = asyncio.Lock()

        self._pending_actions: dict[
            str,
            str,
        ] = {}

    # ---------------------------------------------------------
    # Setup / unload
    # ---------------------------------------------------------

    async def async_setup(self) -> None:
        """Set up the notification engine."""

        self.state = (
            await self.storage.async_load_state()
        )

        config = (
            await self.storage.async_load_config()
        )

        await self._apply_config(
            config
        )

        self._confirmation_unsub = (
            self.hass.bus.async_listen(
                EVENT_NOTIFICATION_ACTION,
                self._handle_notification_action,
            )
        )

        self._rebuild_pending_actions()

        if self.hass.is_running:
            self._started = True

            self._schedule(
                self._evaluate_all(
                    source="startup"
                )
            )

        else:
            self._started_unsub = (
                self.hass.bus.async_listen_once(
                    EVENT_HOMEASSISTANT_STARTED,
                    self._handle_home_assistant_started,
                )
            )

        _LOGGER.info(
            "Notification Center loaded %d alert(s)",
            len(self.alerts),
        )

    async def _handle_home_assistant_started(
        self,
        _event: Event,
    ) -> None:
        """Handle Home Assistant startup."""

        self._started = True

        await self._evaluate_all(
            source="startup"
        )

    async def async_unload(self) -> bool:
        """Unload the engine."""

        if self._started_unsub:
            self._started_unsub()

            self._started_unsub = None

        if self._confirmation_unsub:
            self._confirmation_unsub()

            self._confirmation_unsub = None

        self._remove_alert_listeners()

        for task in list(
            self._tasks
        ):
            if not task.done():
                task.cancel()

        if self._tasks:
            await asyncio.gather(
                *self._tasks,
                return_exceptions=True,
            )

        self._tasks.clear()

        await self.storage.async_save_state_now(
            self.state
        )

        return True

    # ---------------------------------------------------------
    # Configuration
    # ---------------------------------------------------------

    async def _apply_config(
        self,
        config: dict[str, Any],
    ) -> None:
        """Apply configuration."""

        normalized = normalize_config(
            config
        )

        self._remove_alert_listeners()

        self.alerts = {
            alert["id"]: alert
            for alert in normalized[
                "alerts"
            ]
        }

        for alert_id in list(
            self.state["alerts"]
        ):
            if alert_id not in self.alerts:
                del self.state[
                    "alerts"
                ][alert_id]

        for alert in self.alerts.values():
            self._ensure_runtime_state(
                alert
            )

            if alert.get(
                "enabled",
                True,
            ):
                self._setup_alert(alert)

    def _remove_alert_listeners(self) -> None:
        """Remove alert listeners."""

        for unsub in self._template_unsubs.values():
            try:
                unsub.async_remove()
            except Exception:
                _LOGGER.exception(
                    "Failed removing template listener"
                )

        self._template_unsubs.clear()

        for unsub in self._interval_unsubs.values():
            try:
                unsub()
            except Exception:
                _LOGGER.exception(
                    "Failed removing interval listener"
                )

        self._interval_unsubs.clear()

        self._templates.clear()

    async def async_reload(self) -> None:
        """Reload configuration from disk."""

        async with self._reload_lock:
            config = (
                await self.storage.async_load_config()
            )

            await self._apply_config(
                config
            )

            self._rebuild_pending_actions()

            if self._started:
                await self._evaluate_all(
                    source="startup"
                )

    # ---------------------------------------------------------
    # Alert setup
    # ---------------------------------------------------------

    def _setup_alert(
        self,
        alert: dict[str, Any],
    ) -> None:
        """Set up listeners for one alert."""

        alert_id = alert["id"]

        template = Template(
            compile_condition(alert),
            self.hass,
        )

        self._templates[
            alert_id
        ] = template

        monitor = alert[
            "monitor"
        ]

        if monitor.get(
            "on_change",
            True,
        ):
            @callback
            def template_callback(
                event: Event | None,
                updates: list[
                    TrackTemplateResult
                ],
            ) -> None:
                """Handle template changes."""

                for update in updates:
                    if update.template is not template:
                        continue

                    if isinstance(
                        update.result,
                        TemplateError,
                    ):
                        self._schedule(
                            self._record_event(
                                alert,
                                "condition_error",
                                "Template evaluation failed.",
                                {
                                    "error": str(
                                        update.result
                                    )
                                },
                            )
                        )
                        continue

                    active = result_as_boolean(
                        update.result
                    )

                    context = (
                        event.context
                        if event
                        else None
                    )

                    self._schedule(
                        self._process_condition(
                            alert,
                            active,
                            source="change",
                            context=context,
                        )
                    )

            self._template_unsubs[
                alert_id
            ] = async_track_template_result(
                self.hass,
                [
                    TrackTemplate(
                        template,
                        None,
                    )
                ],
                template_callback,
            )

        confirmation = alert[
            "notification"
        ].get(
            "confirmation",
            {},
        )

        interval = monitor.get(
            "interval"
        )

        if (
            not interval
            and confirmation.get(
                "enabled",
                False,
            )
        ):
            interval = confirmation.get(
                "resend_interval"
            )

        if interval:
            interval_delta = parse_duration(
                interval
            )

            @callback
            def periodic_callback(
                _now: datetime,
            ) -> None:
                """Run periodic evaluation."""

                self._schedule(
                    self._evaluate_alert(
                        alert,
                        source="interval",
                    )
                )

            self._interval_unsubs[
                alert_id
            ] = async_track_time_interval(
                self.hass,
                periodic_callback,
                interval_delta,
            )

    # ---------------------------------------------------------
    # Evaluation
    # ---------------------------------------------------------

    async def _evaluate_all(
        self,
        *,
        source: str,
    ) -> None:
        """Evaluate all alerts."""

        for alert in list(
            self.alerts.values()
        ):
            if not alert.get(
                "enabled",
                True,
            ):
                continue

            await self._evaluate_alert(
                alert,
                source=source,
            )

    async def _evaluate_alert(
        self,
        alert: dict[str, Any],
        *,
        source: str,
    ) -> None:
        """Evaluate one alert."""

        if not self._started:
            return

        template = self._templates.get(
            alert["id"]
        )

        if template is None:
            return

        try:
            result = await _async_render_template(
                template,
                parse_result=True,
                strict=False,
            )

            active = result_as_boolean(
                result
            )

        except TemplateError as err:
            await self._record_event(
                alert,
                "condition_error",
                "Template evaluation failed.",
                {
                    "error": str(err),
                    "source": source,
                },
            )
            return

        await self._process_condition(
            alert,
            active,
            source=source,
            context=None,
        )

    # ---------------------------------------------------------
    # Condition state machine
    # ---------------------------------------------------------

    def _ensure_runtime_state(
        self,
        alert: dict[str, Any],
    ) -> dict[str, Any]:
        """Return runtime state for an alert."""

        state = self.state[
            "alerts"
        ].setdefault(
            alert["id"],
            {
                "active": False,
                "acknowledged": False,
                "attempts": 0,
                "notification_id": None,
                "confirmation_action_id": None,
                "started_at": None,
                "last_evaluated": None,
                "last_notified": None,
                "confirmed_at": None,
                "confirmed_by": None,
                "last_error": None,
                "last_event": None,
            },
        )

        return state

    async def _process_condition(
        self,
        alert: dict[str, Any],
        active: bool,
        *,
        source: str,
        context: Context | None,
    ) -> None:
        """Process a condition result."""

        state = self._ensure_runtime_state(
            alert
        )

        now = dt_util.utcnow()

        state[
            "last_evaluated"
        ] = now.isoformat()

        if not active:
            if state.get(
                "active",
                False,
            ):
                had_pending_confirmation = bool(
                    state.get(
                        "confirmation_action_id"
                    )
                )

                state["active"] = False
                state["acknowledged"] = False
                state["attempts"] = 0
                state[
                    "confirmation_action_id"
                ] = None
                state["notification_id"] = None

                if had_pending_confirmation:
                    try:
                        await self.dispatcher.async_clear(
                            alert,
                            context=context,
                        )
                    except Exception:
                        _LOGGER.exception(
                            "Failed clearing notification "
                            "for %s",
                            alert["id"],
                        )

                await self._record_event(
                    alert,
                    "condition_inactive",
                    "Condition became false.",
                    {
                        "source": source,
                    },
                )

                self._save_state()

            return

        # New active episode.
        if not state.get(
            "active",
            False,
        ):
            state["active"] = True
            state["acknowledged"] = False
            state["attempts"] = 0
            state[
                "started_at"
            ] = now.isoformat()

            state[
                "notification_id"
            ] = (
                f"notification_center_"
                f"{alert['id']}_"
                f"{uuid.uuid4().hex[:10]}"
            )

            confirmation = alert[
                "notification"
            ].get(
                "confirmation",
                {},
            )

            if confirmation.get(
                "enabled",
                False,
            ):
                action_id = (
                    f"NC_CONFIRM_"
                    f"{alert['id']}_"
                    f"{uuid.uuid4().hex}"
                )

                state[
                    "confirmation_action_id"
                ] = action_id

                self._pending_actions[
                    action_id
                ] = alert["id"]

            await self._record_event(
                alert,
                "condition_active",
                "Condition became true.",
                {
                    "source": source,
                },
            )

            await self._send_notification(
                alert,
                context=context,
            )

            return

        # Already acknowledged.
        if state.get(
            "acknowledged",
            False,
        ):
            return

        # Startup/interval can cause a repeat.
        if source in (
            "startup",
            "interval",
        ):
            if self._notification_due(
                alert,
                state,
            ):
                await self._send_notification(
                    alert,
                    context=context,
                )

    def _notification_due(
        self,
        alert: dict[str, Any],
        state: dict[str, Any],
    ) -> bool:
        """Determine if a repeated notification is due."""

        notification = alert[
            "notification"
        ]
        repeat = notification.get(
            "repeat"
        )

        confirmation = notification.get(
            "confirmation",
            {},
        )

        confirmation_pending = bool(
            state.get(
                "confirmation_action_id"
            )
        )

        if confirmation_pending and confirmation.get(
            "enabled",
            False,
        ):
            repeat = {
                "interval": confirmation.get(
                    "resend_interval"
                ),
                "max_attempts": confirmation.get(
                    "max_attempts",
                    5,
                ),
            }

        if not repeat or not repeat.get("enabled", True):
            return False

        attempts = int(
            state.get(
                "attempts",
                0,
            )
        )

        max_attempts = int(
            repeat.get(
                "max_attempts",
                1,
            )
        )

        if attempts >= max_attempts:
            return False

        last_notified = state.get(
            "last_notified"
        )

        if not last_notified:
            return True

        parsed = dt_util.parse_datetime(
            str(last_notified)
        )

        if parsed is None:
            return True

        elapsed = (
            dt_util.utcnow()
            - parsed
        )

        interval = parse_duration(
            repeat["interval"]
        )

        return elapsed >= interval

    async def _send_notification(
        self,
        alert: dict[str, Any],
        *,
        context: Context | None,
    ) -> None:
        """Send a notification and update runtime state."""

        state = self._ensure_runtime_state(
            alert
        )

        attempt = (
            int(
                state.get(
                    "attempts",
                    0,
                )
            )
            + 1
        )

        action_id = state.get(
            "confirmation_action_id"
        )

        try:
            await self.dispatcher.async_send(
                alert,
                attempt=attempt,
                confirmation_action_id=action_id,
                context=context,
            )

        except Exception as err:
            state[
                "last_error"
            ] = str(err)

            await self._record_event(
                alert,
                "notification_failed",
                "Notification failed.",
                {
                    "attempt": attempt,
                    "error": str(err),
                },
            )

            _LOGGER.exception(
                "Notification failed for alert %s",
                alert["id"],
            )

            self._save_state()
            return

        now = dt_util.utcnow()

        state[
            "attempts"
        ] = attempt

        state[
            "last_notified"
        ] = now.isoformat()

        state[
            "last_error"
        ] = None

        await self._record_event(
            alert,
            "notification_sent",
            "Notification sent.",
            {
                "attempt": attempt,
            },
        )

        await self._run_notification_actions(
            alert,
            context,
            attempt,
        )

        self._save_state()

    # ---------------------------------------------------------
    # Confirmation handling
    # ---------------------------------------------------------

    def _rebuild_pending_actions(
        self,
    ) -> None:
        """Rebuild confirmation action index."""

        self._pending_actions.clear()

        for alert_id, state in (
            self.state[
                "alerts"
            ].items()
        ):
            action_id = state.get(
                "confirmation_action_id"
            )

            if action_id:
                self._pending_actions[
                    action_id
                ] = alert_id

    async def _handle_notification_action(
        self,
        event: Event,
    ) -> None:
        """Handle a mobile app confirmation."""

        action = (
            event.data.get(
                "action"
            )
            if isinstance(
                event.data,
                dict,
            )
            else None
        )

        if not action:
            return

        alert_id = self._pending_actions.get(
            action
        )

        if not alert_id:
            return

        alert = self.alerts.get(
            alert_id
        )

        if alert is None:
            return

        state = self._ensure_runtime_state(
            alert
        )

        if (
            state.get(
                "confirmation_action_id"
            )
            != action
        ):
            return

        confirmed_by = self._resolve_user(
            event.context.user_id
            if event.context
            else None
        )

        state[
            "acknowledged"
        ] = True

        state[
            "confirmation_action_id"
        ] = None

        state[
            "confirmed_at"
        ] = dt_util.utcnow().isoformat()

        state[
            "confirmed_by"
        ] = confirmed_by

        self._pending_actions.pop(
            action,
            None,
        )

        await self._record_event(
            alert,
            "confirmed",
            "Notification confirmed.",
            {
                "confirmed_by": confirmed_by,
            },
        )

        try:
            await self.dispatcher.async_clear(
                alert,
                context=event.context,
            )
        except Exception:
            _LOGGER.exception(
                "Failed to clear notification for %s",
                alert_id,
            )

        notification = alert[
            "notification"
        ]

        confirmation = notification.get(
            "confirmation",
            {},
        )

        completion_message = (
            confirmation.get(
                "completion_message"
            )
            or ""
        )

        confirmation_message = (
            confirmation.get("confirmation_message")
        )

        if confirmation.get("notify_on_confirmation", False):
            completion_message = (
                confirmation_message
                or completion_message
                or "{{ confirmed_by }} confirmed this notification."
            )

        if completion_message:
            completion_alert = deepcopy(
                alert
            )

            completion_alert[
                "notification"
            ] = deepcopy(
                notification
            )

            completion_alert[
                "notification"
            ][
                "message"
            ] = await _render_value(
                self.hass,
                completion_message,
                {
                    "alert_id": alert["id"],
                    "alert_name": alert["name"],
                    "alert_active": True,
                    "confirmed_by": confirmed_by,
                    "context": event.context,
                    "now": dt_util.now(),
                },
            )

            completion_alert[
                "notification"
            ][
                "confirmation"
            ] = {
                "enabled": False,
                "button": "",
                "completion_message": "",
                "actions": [],
            }

            try:
                await self.dispatcher.async_send(
                    completion_alert,
                    attempt=1,
                    confirmation_action_id=None,
                    context=event.context,
                )

                await self._record_event(
                    alert,
                    "completion_sent",
                    "Completion notification sent.",
                    {},
                )

            except Exception as err:
                await self._record_event(
                    alert,
                    "completion_failed",
                    "Completion notification failed.",
                    {
                        "error": str(err),
                    },
                )

        await self._run_confirmation_actions(
            alert,
            event.context,
            confirmed_by,
        )

        self._save_state()

    async def _run_notification_actions(
        self,
        alert: dict[str, Any],
        context: Context | None,
        attempt: int,
    ) -> None:
        """Run actions after a notification dispatch."""

        notification = alert["notification"]
        if not notification.get("actions_enabled", False):
            return

        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "attempt": attempt,
            "context": context,
            "now": dt_util.now(),
        }

        for index, action in enumerate(notification.get("actions", []), start=1):
            try:
                service = str(
                    await _render_value(
                        self.hass, action.get("action"), variables
                    )
                    or ""
                )
                if not service or "." not in service:
                    raise ValueError("Invalid post-send action.")

                target = await _render_value(
                    self.hass, action.get("target", {}), variables
                )
                data = _remove_none(
                    await _render_value(
                        self.hass, action.get("data", {}), variables
                    )
                )
                domain, service_name = service.split(".", 1)
                await self.hass.services.async_call(
                    domain,
                    service_name,
                    service_data=data if isinstance(data, dict) else {},
                    target=target if target else None,
                    blocking=True,
                    context=context,
                )
                await self._record_event(
                    alert,
                    "notification_action",
                    "Post-send action executed.",
                    {"attempt": attempt, "index": index, "action": service},
                )
            except Exception as err:
                _LOGGER.exception("Post-send action failed for %s", alert["id"])
                await self._record_event(
                    alert,
                    "notification_action_failed",
                    "Post-send action failed.",
                    {"attempt": attempt, "index": index, "error": str(err)},
                )

    def _resolve_user(
        self,
        user_id: str | None,
    ) -> str:
        """Resolve a Home Assistant user to a person."""

        if not user_id:
            return "Unknown user"

        for state in self.hass.states.async_all(
            "person"
        ):
            if (
                state.attributes.get(
                    "user_id"
                )
                == user_id
            ):
                return state.name

        return "Unknown user"

    async def _run_confirmation_actions(
        self,
        alert: dict[str, Any],
        context: Context | None,
        confirmed_by: str,
    ) -> None:
        """Run actions after confirmation."""

        confirmation = alert[
            "notification"
        ].get(
            "confirmation",
            {},
        )

        if not confirmation.get("actions_enabled", False):
            return

        actions = confirmation.get(
            "actions",
            [],
        )

        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "confirmed_by": confirmed_by,
            "now": dt_util.now(),
        }

        for index, action in enumerate(
            actions,
            start=1,
        ):
            try:
                service = await _render_value(
                    self.hass,
                    action.get(
                        "action"
                    ),
                    variables,
                )
                service = str(service or "")

                if not service or "." not in service:
                    raise ValueError(
                        "Invalid confirmation action."
                    )

                target = await _render_value(
                    self.hass,
                    action.get(
                        "target",
                        {},
                    ),
                    variables,
                )

                data = await _render_value(
                    self.hass,
                    action.get(
                        "data",
                        {},
                    ),
                    variables,
                )
                data = _remove_none(data)

                domain, service_name = (
                    service.split(
                        ".",
                        1,
                    )
                )

                await self.hass.services.async_call(
                    domain,
                    service_name,
                    service_data=(
                        data
                        if isinstance(
                            data,
                            dict,
                        )
                        else {}
                    ),
                    target=(
                        target
                        if target
                        else None
                    ),
                    blocking=True,
                    context=context,
                )

                await self._record_event(
                    alert,
                    "confirmation_action",
                    "Confirmation action executed.",
                    {
                        "index": index,
                        "action": service,
                    },
                )

            except Exception as err:
                _LOGGER.exception(
                    "Confirmation action failed "
                    "for %s",
                    alert["id"],
                )

                await self._record_event(
                    alert,
                    "confirmation_action_failed",
                    "Confirmation action failed.",
                    {
                        "index": index,
                        "error": str(err),
                    },
                )

    # ---------------------------------------------------------
    # Public operations
    # ---------------------------------------------------------

    async def async_test_alert(
        self,
        alert_id: str,
    ) -> None:
        """Send a test notification."""

        alert = self.alerts.get(
            alert_id
        )

        if alert is None:
            raise ValueError(
                f"Unknown alert: {alert_id}"
            )

        confirmation = alert[
            "notification"
        ].get(
            "confirmation",
            {},
        )

        confirmation_action_id = None

        if confirmation.get(
            "enabled",
            False,
        ):
            confirmation_action_id = (
                f"NC_TEST_CONFIRM_"
                f"{alert_id}_"
                f"{uuid.uuid4().hex}"
            )

            state = self._ensure_runtime_state(
                alert
            )
            state[
                "confirmation_action_id"
            ] = confirmation_action_id
            self._pending_actions[
                confirmation_action_id
            ] = alert_id

        await self.dispatcher.async_send(
            alert,
            attempt=1,
            confirmation_action_id=confirmation_action_id,
            context=None,
            test=True,
        )

        await self._record_event(
            alert,
            "test",
            "Test notification sent.",
            {},
        )

    async def async_test_alert_payload(
        self,
        alert: dict[str, Any],
    ) -> None:
        """Send a normalized editor draft without saving or changing runtime state."""

        normalized = normalize_config(
            {
                "version": 1,
                "alerts": [alert],
            }
        )["alerts"][0]

        await self.dispatcher.async_send(
            normalized,
            attempt=1,
            confirmation_action_id=None,
            context=None,
            test=True,
        )

    async def async_save_alert(
        self,
        alert: dict[str, Any],
    ) -> dict[str, Any]:
        """Create or update an alert."""

        config = await self.storage.async_load_config()

        alerts = list(
            config["alerts"]
        )

        normalized = normalize_config(
            {
                "version": 1,
                "alerts": [
                    alert
                ],
            }
        )["alerts"][0]

        existing = next(
            (
                item
                for item in alerts
                if item["id"]
                == normalized["id"]
            ),
            None,
        )

        now = dt_util.utcnow().isoformat()

        if existing:
            normalized[
                "created_at"
            ] = (
                existing.get(
                    "created_at"
                )
                or now
            )
        else:
            normalized[
                "created_at"
            ] = now

        normalized[
            "updated_at"
        ] = now

        if existing:
            alerts = [
                (
                    normalized
                    if item["id"]
                    == normalized["id"]
                    else item
                )
                for item in alerts
            ]
        else:
            alerts.append(
                normalized
            )

        await self.storage.async_save_config(
            {
                "version": 1,
                "alerts": alerts,
            }
        )

        await self.async_reload()

        return normalized

    async def async_delete_alert(
        self,
        alert_id: str,
    ) -> None:
        """Delete an alert."""

        alert = self.alerts.get(
            alert_id
        )

        if alert:
            try:
                await self.dispatcher.async_clear(
                    alert,
                    context=None,
                )
            except Exception:
                _LOGGER.exception(
                    "Failed clearing notification "
                    "before deleting %s",
                    alert_id,
                )

        config = await self.storage.async_load_config()

        config["alerts"] = [
            alert
            for alert in config["alerts"]
            if alert["id"]
            != alert_id
        ]

        await self.storage.async_save_config(
            config
        )

        self.state[
            "alerts"
        ].pop(
            alert_id,
            None,
        )

        self.state[
            "history"
        ] = [
            item
            for item in self.state[
                "history"
            ]
            if item.get(
                "alert_id"
            )
            != alert_id
        ]

        await self.async_reload()

        self.storage.async_delay_save_state(
            self.state
        )

    async def async_validate_yaml(
        self,
        text: str,
    ) -> dict[str, Any]:
        """Validate raw YAML without changing the saved config."""

        return await self.storage.async_validate_yaml_text(
            text
        )

    async def async_save_yaml(
        self,
        text: str,
    ) -> dict[str, Any]:
        """Replace configuration using raw YAML."""

        normalized = await self.storage.async_save_yaml_text(
            text
        )

        await self.async_reload()
        return normalized

    async def async_get_yaml(
        self,
    ) -> str:
        """Return YAML."""

        return await self.storage.async_load_yaml_text()

    async def async_list_alerts(
        self,
    ) -> list[dict[str, Any]]:
        """Return alerts with runtime information."""

        result = []

        for alert in self.alerts.values():
            state = self._ensure_runtime_state(
                alert
            )

            result.append(
                {
                    **deepcopy(alert),
                    "runtime": deepcopy(
                        state
                    ),
                }
            )

        return result

    async def async_history(
        self,
        alert_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Return trace history."""

        history = self.state[
            "history"
        ]

        if alert_id:
            history = [
                item
                for item in history
                if item.get(
                    "alert_id"
                )
                == alert_id
            ]

        return list(
            reversed(
                history[-max(
                    1,
                    min(
                        limit,
                        MAX_HISTORY,
                    ),
                ):]
            )
        )

    # ---------------------------------------------------------
    # History
    # ---------------------------------------------------------

    async def _record_event(
        self,
        alert: dict[str, Any],
        event_type: str,
        message: str,
        details: dict[str, Any],
    ) -> None:
        """Record an event."""

        now = dt_util.utcnow()

        event = {
            "id": uuid.uuid4().hex,
            "timestamp": now.isoformat(),
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "type": event_type,
            "message": message,
            "details": deepcopy(
                details
            ),
        }

        self.state[
            "history"
        ].append(
            event
        )

        self.state[
            "history"
        ] = self.state[
            "history"
        ][-MAX_HISTORY:]

        runtime = self._ensure_runtime_state(
            alert
        )

        runtime[
            "last_event"
        ] = event

        self.storage.async_delay_save_state(
            self.state
        )

    def _save_state(self) -> None:
        """Schedule persistent state save."""

        self.storage.async_delay_save_state(
            self.state
        )

    def _schedule(
        self,
        coroutine: Any,
    ) -> None:
        """Schedule an async task and track it."""

        task = self.hass.async_create_task(
            coroutine
        )

        self._tasks.add(
            task
        )

        task.add_done_callback(
            self._tasks.discard
        )