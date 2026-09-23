"""Feature lifecycle and frontend route registration."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from importlib import import_module
from pkgutil import iter_modules
from typing import TYPE_CHECKING, Any, ClassVar, Protocol

from ..const import FeatureName
from ..domain.runtime import AlertRuntimeState

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from ..support.storage import Storage

RouteHandler = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class WebsocketArgument:
    """One required value accepted by an annotated websocket route."""

    name: str
    validator: Any
    required: bool = True
    default: Any = None


@dataclass(frozen=True)
class WebsocketRoute:
    """Transport-neutral metadata for a feature route exposed to the UI."""

    name: str
    command: str
    arguments: tuple[WebsocketArgument, ...] = ()
    error_code: str = "route_failed"
    error_message: str = "Unable to complete request."


def route(name: str) -> Callable[[RouteHandler], RouteHandler]:
    """Declare a feature-owned public route managed by the lifecycle."""

    def decorate(handler: RouteHandler) -> RouteHandler:
        setattr(handler, "ha_notifications_route", name)
        return handler

    return decorate


def websocket_route(
    name: str,
    *,
    command: str,
    arguments: tuple[WebsocketArgument, ...] = (),
    error_code: str = "route_failed",
    error_message: str = "Unable to complete request.",
) -> Callable[[RouteHandler], RouteHandler]:
    """Declare a UI route without coupling a feature to Home Assistant APIs."""

    specification = WebsocketRoute(
        name=name,
        command=command,
        arguments=arguments,
        error_code=error_code,
        error_message=error_message,
    )

    def decorate(handler: RouteHandler) -> RouteHandler:
        route(name)(handler)
        setattr(handler, "ha_notifications_websocket_route", specification)
        return handler

    return decorate


class Feature(Protocol):
    name: str
    dependencies: tuple[str, ...]

    async def setup(self, lifecycle: FeatureLifecycle) -> None: ...

    async def unload(self) -> None: ...



class FeatureBase:
    """Inherited contract for self-registering lifecycle features."""

    _registry: ClassVar[list[type[FeatureBase]]] = []
    abstract: ClassVar[bool] = True
    name: str
    dependencies: tuple[str, ...] = ()

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        if not cls.__dict__.get("abstract", False):
            FeatureBase._registry.append(cls)

    def __init__(self) -> None:
        self.lifecycle: FeatureLifecycle | None = None

    @classmethod
    def create(
        cls,
        hass: HomeAssistant,
        runtime: dict[str, AlertRuntimeState],
        storage: Storage,
    ) -> FeatureBase:
        """Construct a feature from the shared application context."""

        return cls(hass, runtime, storage, storage)

    async def setup(self, lifecycle: FeatureLifecycle) -> None:
        self.lifecycle = lifecycle
        await self.on_setup()

    async def on_setup(self) -> None:
        """Initialize this feature after its declared dependencies are ready."""

    def feature(self, name: FeatureName) -> Feature:
        if self.lifecycle is None:
            raise RuntimeError(f"Feature {self.name} has not been set up")
        return self.lifecycle.feature(name)

    async def unload(self) -> None:
        await self.on_unload()
        self.lifecycle = None

    async def on_unload(self) -> None:
        """Release resources owned by this feature."""


class FeatureLifecycle:
    """Validate, set up, route, and unwind controller-managed features."""

    def __init__(
        self,
        hass: HomeAssistant,
        runtime: dict[str, AlertRuntimeState],
        storage: Storage,
        reload_configuration: Callable[[], Awaitable[None]],
        *,
        feature_classes_loaded: bool = False,
    ) -> None:
        if not feature_classes_loaded:
            self._load_feature_classes()
        self._features = tuple(
            self._construct_feature(
                feature_class,
                hass,
                runtime,
                storage,
            )
            for feature_class in FeatureBase._registry
        )
        self._validate_dependencies()
        self._started: list[Feature] = []
        self._ready = asyncio.Event()
        self._routes = self._collect_routes()
        self._websocket_routes = self._collect_websocket_routes()
        self._reload_configuration = reload_configuration

    @classmethod
    async def async_create(
        cls,
        hass: HomeAssistant,
        runtime: dict[str, AlertRuntimeState],
        storage: Storage,
        reload_configuration: Callable[[], Awaitable[None]],
    ) -> FeatureLifecycle:
        """Discover and import feature modules outside Home Assistant's loop."""

        await hass.async_add_executor_job(cls._load_feature_classes)
        return cls(
            hass,
            runtime,
            storage,
            reload_configuration,
            feature_classes_loaded=True,
        )

    @staticmethod
    def _construct_feature(
        feature_class: type[FeatureBase],
        hass: HomeAssistant,
        runtime: dict[str, AlertRuntimeState],
        storage: Storage,
    ) -> FeatureBase:
        """Compose each feature with its declared construction contract."""

        return feature_class.create(hass, runtime, storage)

    async def reload(self) -> None:
        """Request the composition host to reload feature configuration."""

        await self._reload_configuration()

    async def wait_until_ready(self) -> None:
        """Wait until externally callable feature routes are set up."""

        ready = getattr(self, "_ready", None)
        if ready is not None:
            await ready.wait()

    @staticmethod
    def _load_feature_classes() -> None:
        """Import feature modules so their classes self-register."""

        from .. import features

        for module in iter_modules(features.__path__, f"{features.__name__}."):
            import_module(module.name)

    def feature(self, name: FeatureName) -> Feature:
        """Return a declared feature dependency by its stable feature name."""

        for feature in self._features:
            if feature.name == name:
                return feature
        raise ValueError(f"Unknown feature: {name}")

    def _collect_routes(self) -> dict[str, RouteHandler]:
        routes: dict[str, RouteHandler] = {}
        for feature in self._features:
            for feature_type in reversed(type(feature).__mro__):
                for attribute in vars(feature_type).values():
                    route_name = getattr(attribute, "ha_notifications_route", None)
                    if route_name is None:
                        continue
                    if route_name in routes:
                        raise ValueError(f"Duplicate feature route: {route_name}")
                    routes[route_name] = getattr(feature, attribute.__name__)
        return routes

    async def dispatch(self, name: str, *args: Any, **kwargs: Any) -> Any:
        """Run one feature-owned route by its stable public name."""

        try:
            handler = self._routes[name]
        except KeyError as err:
            raise ValueError(f"Unknown feature route: {name}") from err
        return await handler(*args, **kwargs)

    @property
    def websocket_routes(self) -> tuple[WebsocketRoute, ...]:
        """Return the feature routes the frontend may invoke."""

        return self._websocket_routes

    def _collect_websocket_routes(self) -> tuple[WebsocketRoute, ...]:
        routes: list[WebsocketRoute] = []
        commands: set[str] = set()
        for route_name, handler in self._routes.items():
            specification = getattr(
                handler, "ha_notifications_websocket_route", None
            )
            if specification is None:
                continue
            if specification.name != route_name:
                raise ValueError(f"Websocket route name mismatch: {route_name}")
            if specification.command in commands:
                raise ValueError(
                    f"Duplicate websocket command: {specification.command}"
                )
            commands.add(specification.command)
            routes.append(specification)
        return tuple(routes)

    def _validate_dependencies(self) -> None:
        by_name: dict[str, Feature] = {}
        for feature in self._features:
            if feature.name in by_name:
                raise ValueError(f"Duplicate feature name: {feature.name}")
            by_name[feature.name] = feature

        for feature in self._features:
            missing = [
                dependency
                for dependency in feature.dependencies
                if dependency not in by_name
            ]
            if missing:
                raise ValueError(
                    f"Feature {feature.name} has missing dependencies: {missing}"
                )

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(name: str) -> None:
            if name in visiting:
                raise ValueError(f"Feature dependency cycle includes {name}")
            if name in visited:
                return
            visiting.add(name)
            for dependency in by_name[name].dependencies:
                visit(dependency)
            visiting.remove(name)
            visited.add(name)

        for feature in self._features:
            visit(feature.name)

    async def setup(self) -> None:
        """Set up features in dependency order and roll back partial setup."""

        if self._started:
            return

        started: list[Feature] = []
        by_name = {feature.name: feature for feature in self._features}

        async def start(feature: Feature) -> None:
            if feature in started:
                return
            for dependency in feature.dependencies:
                await start(by_name[dependency])
            await feature.setup(self)
            started.append(feature)

        try:
            for feature in self._features:
                await start(feature)
        except Exception:
            for feature in reversed(started):
                await feature.unload()
            raise
        self._started = started
        ready = getattr(self, "_ready", None)
        if ready is None:
            self._ready = asyncio.Event()
        self._ready.set()

    async def unload(self) -> None:
        """Unload started features in reverse setup order."""

        ready = getattr(self, "_ready", None)
        if ready is not None:
            ready.clear()
        for feature in reversed(self._started):
            await feature.unload()
        self._started.clear()
