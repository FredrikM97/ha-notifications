"""Tests for feature lifecycle ordering and rollback."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from custom_components.ha_notifications.controller.lifecycle import FeatureLifecycle


@dataclass
class FakeFeature:
    name: str
    dependencies: tuple[str, ...] = ()
    log: list[str] | None = None
    fail_setup: bool = False

    async def setup(self, _lifecycle: FeatureLifecycle) -> None:
        assert self.log is not None
        self.log.append(f"setup:{self.name}")
        if self.fail_setup:
            raise RuntimeError(self.name)

    async def unload(self) -> None:
        assert self.log is not None
        self.log.append(f"unload:{self.name}")


def make_lifecycle(features: tuple[FakeFeature, ...]) -> FeatureLifecycle:
    lifecycle = object.__new__(FeatureLifecycle)
    lifecycle._features = features
    lifecycle._started = []
    lifecycle._routes = {}
    lifecycle._websocket_routes = ()
    lifecycle._reload_configuration = lambda: None
    lifecycle._validate_dependencies()
    return lifecycle


@pytest.fixture
def lifecycle_log() -> list[str]:
    return []


@pytest.fixture
def feature_factory(lifecycle_log):
    def build_feature(
        name: str,
        dependencies: tuple[str, ...] = (),
        fail_setup: bool = False,
    ) -> FakeFeature:
        return FakeFeature(name, dependencies, lifecycle_log, fail_setup)

    return build_feature


@pytest.fixture
def lifecycle_factory():
    return make_lifecycle


@pytest.fixture
def lifecycle(feature_factory, lifecycle_factory):
    first = feature_factory("first")
    second = feature_factory("second", ("first",))
    return lifecycle_factory((second, first))


async def test_dependencies_control_setup_and_reverse_unload(
    lifecycle, lifecycle_log
):

    await lifecycle.setup()
    await lifecycle.unload()

    assert lifecycle_log == [
        "setup:first",
        "setup:second",
        "unload:second",
        "unload:first",
    ]

async def test_partial_setup_rolls_back_started_features(
    lifecycle_factory, feature_factory, lifecycle_log
):
    first = feature_factory("first")
    second = feature_factory("second", ("first",), fail_setup=True)
    lifecycle = lifecycle_factory((first, second))

    with pytest.raises(RuntimeError, match="second"):
        await lifecycle.setup()

    assert lifecycle_log == ["setup:first", "setup:second", "unload:first"]

async def test_setup_is_idempotent_until_unload(
    lifecycle_factory, feature_factory, lifecycle_log
):
    lifecycle = lifecycle_factory((feature_factory("feature"),))

    await lifecycle.setup()
    await lifecycle.setup()

    assert lifecycle_log == ["setup:feature"]

def test_missing_and_cyclic_dependencies_are_rejected(
    lifecycle_factory, feature_factory
):
    with pytest.raises(ValueError, match="missing"):
        lifecycle_factory((feature_factory("feature", ("missing",)),))

    with pytest.raises(ValueError, match="cycle"):
        lifecycle_factory(
            (
                feature_factory("first", ("second",)),
                feature_factory("second", ("first",)),
            )
        )


async def test_lifecycle_order_contract_snapshot(snapshot, lifecycle, lifecycle_log):

    await lifecycle.setup()
    await lifecycle.unload()

    assert lifecycle_log == snapshot
