"""The single module allowed to call Home Assistant framework APIs."""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    TrackTemplate as HATrackTemplate,
)
from homeassistant.helpers.event import (
    TrackTemplateResult,
    async_track_template_result,
    async_track_time_interval,
)
from homeassistant.helpers.storage import Store
from homeassistant.helpers.template import Template, TemplateError, result_as_boolean

Unsubscribe = Callable[[], None]


@dataclass(frozen=True)
class RegistrySnapshot:
    """Home Assistant registries/state needed to plan one delivery."""

    area_registry: Any
    device_registry: Any
    entity_registry: Any
    mobile_app_entries: list[Any]
    mobile_app_entry_ids: set[str]
    person_states: list[Any]


class HomeAssistantGateway:
    """Thin wrapper around every Home Assistant call this integration needs.

    No decision logic lives here - each method performs exactly one
    Home-Assistant-facing operation and nothing else.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    # ------------------------------------------------------------------
    # Services
    # ------------------------------------------------------------------

    async def call_service(
        self,
        domain: str,
        service: str,
        data: dict[str, Any] | None = None,
        target: dict[str, Any] | None = None,
        *,
        blocking: bool = True,
        context: Context | None = None,
    ) -> None:
        """Call a Home Assistant service."""

        await self._hass.services.async_call(
            domain,
            service,
            service_data=data or {},
            target=target,
            blocking=blocking,
            context=context,
        )

    def has_service(self, domain: str, service: str) -> bool:
        """Return whether a Home Assistant service is registered."""

        return self._hass.services.has_service(domain, service)

    def register_service(
        self,
        domain: str,
        service: str,
        handler: Callable[[Any], Awaitable[None]],
        schema: Any = None,
    ) -> None:
        """Register a Home Assistant service, if not already registered."""

        if self._hass.services.has_service(domain, service):
            return

        self._hass.services.async_register(domain, service, handler, schema=schema)

    # ------------------------------------------------------------------
    # States / registries
    # ------------------------------------------------------------------

    @property
    def is_running(self) -> bool:
        """Return whether Home Assistant has finished starting up."""

        return self._hass.is_running

    def get_states_all(self, domain: str) -> list[Any]:
        """Return every state for a domain (e.g. ``person``)."""

        return list(self._hass.states.async_all(domain))

    def entity_registry_snapshot(self) -> Any:
        """Return the entity registry."""

        return er.async_get(self._hass)

    def device_registry_snapshot(self) -> Any:
        """Return the device registry."""

        return dr.async_get(self._hass)

    def area_registry_snapshot(self) -> Any:
        """Return the area registry."""

        return ar.async_get(self._hass)

    def config_entries_for_domain(self, domain: str) -> list[ConfigEntry]:
        """Return config entries for a domain (e.g. ``mobile_app``)."""

        return list(self._hass.config_entries.async_entries(domain))

    def fetch_registry_snapshot(self) -> RegistrySnapshot:
        """Return every registry/state a notification delivery plan needs."""

        mobile_app_entries = self.config_entries_for_domain("mobile_app")
        return RegistrySnapshot(
            area_registry=self.area_registry_snapshot(),
            device_registry=self.device_registry_snapshot(),
            entity_registry=self.entity_registry_snapshot(),
            mobile_app_entries=mobile_app_entries,
            mobile_app_entry_ids={entry.entry_id for entry in mobile_app_entries},
            person_states=self.get_states_all("person"),
        )

    # ------------------------------------------------------------------
    # Event bus
    # ------------------------------------------------------------------

    def bus_listen(
        self,
        event_type: str,
        callback_fn: Callable[[Event], Any],
    ) -> Unsubscribe:
        """Listen for every occurrence of an event type."""

        return self._hass.bus.async_listen(event_type, callback_fn)

    def bus_listen_once(
        self,
        event_type: str,
        callback_fn: Callable[[Event], Any],
    ) -> Unsubscribe:
        """Listen for the next occurrence of an event type."""

        return self._hass.bus.async_listen_once(event_type, callback_fn)

    # ------------------------------------------------------------------
    # Templates
    # ------------------------------------------------------------------

    async def render_template(
        self,
        source: str,
        variables: dict[str, Any] | None = None,
        *,
        parse_result: bool = True,
        strict: bool = False,
    ) -> Any:
        """Render a Jinja template string."""

        template = Template(source, self._hass)
        result = template.async_render(
            variables, parse_result=parse_result, strict=strict
        )
        if inspect.isawaitable(result):
            return await result
        return result

    def compile_template(self, source: str) -> Template:
        """Compile (but do not render) a Jinja template string."""

        return Template(source, self._hass)

    async def render_compiled(
        self,
        template: Template,
        *,
        parse_result: bool = True,
        strict: bool = False,
    ) -> Any:
        """Render an already-compiled template."""

        result = template.async_render(parse_result=parse_result, strict=strict)
        if inspect.isawaitable(result):
            return await result
        return result

    async def evaluate_condition(self, source: str) -> tuple[bool | None, str | None]:
        """Render a condition template once, returning ``(active, error)``.

        Mirrors what `track_template`'s callback does for a tracked
        template, for the one-shot case (startup/interval evaluation
        outside of a live subscription).
        """

        template = Template(source, self._hass)
        try:
            result = template.async_render(parse_result=True, strict=False)
            if inspect.isawaitable(result):
                result = await result
        except TemplateError as err:
            return None, str(err)

        return result_as_boolean(result), None

    # ------------------------------------------------------------------
    def now_utc(self):
        """Return the current UTC time."""

        from homeassistant.util import dt as dt_util

        return dt_util.utcnow()

    def track_template(
        self,
        source: str,
        on_result: Callable[[bool | None, str | None, Event | None], None],
    ) -> Unsubscribe:
        """Track a Jinja condition template, reporting boolean results.

        ``on_result`` is called with ``(active, error, event)`` whenever the
        template's value changes: ``error`` is set (and ``active`` is
        ``None``) if the template failed to evaluate.
        """

        template = Template(source, self._hass)

        @callback
        def _template_callback(
            event: Event | None,
            updates: list[TrackTemplateResult],
        ) -> None:
            for update in updates:
                if update.template is not template:
                    continue

                if isinstance(update.result, TemplateError):
                    on_result(None, str(update.result), event)
                    continue

                on_result(result_as_boolean(update.result), None, event)

        unsub = async_track_template_result(
            self._hass,
            [HATrackTemplate(template, None)],
            _template_callback,
        )

        return unsub.async_remove

    def track_interval(
        self,
        interval: Any,
        on_interval: Callable[[Any], None],
    ) -> Unsubscribe:
        """Run a callback on a fixed time interval."""

        @callback
        def _interval_callback(now: Any) -> None:
            on_interval(now)

        return async_track_time_interval(self._hass, _interval_callback, interval)

    # ------------------------------------------------------------------
    # Persistence: runtime-state store
    # ------------------------------------------------------------------

    def make_store(self, version: int, key: str) -> Store:
        """Create a Home Assistant `Store` for a given version/key."""

        return Store(self._hass, version, key)

    # ------------------------------------------------------------------
    # Tasks
    # ------------------------------------------------------------------

    def create_task(self, coroutine: Awaitable[Any]) -> Any:
        """Schedule a coroutine as a tracked Home Assistant task."""

        return self._hass.async_create_task(coroutine)

    # ------------------------------------------------------------------
    # Frontend / panel / websocket registration
    # ------------------------------------------------------------------

    async def register_static_path(self, url: str, directory: str) -> None:
        """Register a static file path for the frontend build directory."""

        await self._hass.http.async_register_static_paths(
            [StaticPathConfig(url, directory, False)]
        )

    def register_extra_js(self, module_url: str) -> None:
        """Register an extra JS module to load with the frontend."""

        frontend.add_extra_js_url(self._hass, module_url)

    def panel_exists(self, frontend_url_path: str) -> bool:
        """Return whether a panel is already registered."""

        return frontend.async_panel_exists(self._hass, frontend_url_path)

    async def register_panel(
        self,
        *,
        frontend_url_path: str,
        webcomponent_name: str,
        module_url: str,
        sidebar_title: str | None,
        sidebar_icon: str | None,
        require_admin: bool = True,
    ) -> None:
        """Register a Home Assistant custom panel."""

        await panel_custom.async_register_panel(
            hass=self._hass,
            frontend_url_path=frontend_url_path,
            webcomponent_name=webcomponent_name,
            sidebar_title=sidebar_title,
            sidebar_icon=sidebar_icon,
            module_url=module_url,
            require_admin=require_admin,
        )

    def unregister_panel(self, frontend_url_path: str) -> None:
        """Remove a previously registered panel."""

        frontend.async_remove_panel(
            self._hass, frontend_url_path, warn_if_unknown=False
        )

    def register_websocket_command(self, handler: Callable[..., Any]) -> None:
        """Register one websocket command handler."""

        # Imported lazily: websocket_api is only ever needed here.
        from homeassistant.components import websocket_api

        websocket_api.async_register_command(self._hass, handler)
