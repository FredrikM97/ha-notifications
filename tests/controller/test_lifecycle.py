"""Tests for feature lifecycle ordering and rollback."""

from __future__ import annotations

import unittest
from dataclasses import dataclass

from custom_components.ha_notifications.controller.lifecycle import FeatureLifecycle


class RuntimeStorage:
    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass


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


class FeatureLifecycleTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _lifecycle(features: tuple[FakeFeature, ...]) -> FeatureLifecycle:
        lifecycle = object.__new__(FeatureLifecycle)
        lifecycle._features = features
        lifecycle._started = []
        lifecycle._routes = {}
        lifecycle._websocket_routes = ()
        lifecycle._reload_configuration = lambda: None
        lifecycle._validate_dependencies()
        return lifecycle

    async def test_dependencies_control_setup_and_reverse_unload(self) -> None:
        log: list[str] = []
        first = FakeFeature("first", log=log)
        second = FakeFeature("second", ("first",), log)
        lifecycle = self._lifecycle((second, first))

        await lifecycle.setup()
        await lifecycle.unload()

        self.assertEqual(
            log,
            ["setup:first", "setup:second", "unload:second", "unload:first"],
        )

    async def test_partial_setup_rolls_back_started_features(self) -> None:
        log: list[str] = []
        first = FakeFeature("first", log=log)
        second = FakeFeature("second", ("first",), log, fail_setup=True)
        lifecycle = self._lifecycle((first, second))

        with self.assertRaisesRegex(RuntimeError, "second"):
            await lifecycle.setup()

        self.assertEqual(log, ["setup:first", "setup:second", "unload:first"])

    async def test_setup_is_idempotent_until_unload(self) -> None:
        log: list[str] = []
        feature = FakeFeature("feature", log=log)
        lifecycle = self._lifecycle((feature,))

        await lifecycle.setup()
        await lifecycle.setup()

        self.assertEqual(log, ["setup:feature"])

    def test_missing_and_cyclic_dependencies_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing"):
            self._lifecycle((FakeFeature("feature", ("missing",), []),))

        with self.assertRaisesRegex(ValueError, "cycle"):
            self._lifecycle(
                (
                    FakeFeature("first", ("second",), []),
                    FakeFeature("second", ("first",), []),
                )
            )


async def test_lifecycle_order_contract_snapshot(snapshot):
    log: list[str] = []
    first = FakeFeature("first", log=log)
    second = FakeFeature("second", ("first",), log)
    lifecycle = FeatureLifecycleTests._lifecycle((second, first))

    await lifecycle.setup()
    await lifecycle.unload()

    assert log == snapshot

if __name__ == "__main__":
    unittest.main()