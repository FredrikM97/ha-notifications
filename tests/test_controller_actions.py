"""Unit tests for controller/actions.py - pure follow-up action rendering."""

from __future__ import annotations

import importlib
import unittest

from test_support import PACKAGE_NAME, ensure_package

ensure_package()
actions = importlib.import_module(f"{PACKAGE_NAME}.controller.actions")


async def render(source, variables):
    if source == "{{ service }}":
        return variables["service"]
    return source


class BuildServiceCallsTests(unittest.IsolatedAsyncioTestCase):
    async def test_renders_valid_action_into_command(self):
        results = await actions.build_service_calls(
            [
                {
                    "action": "light.turn_on",
                    "target": {"entity_id": "light.x"},
                    "data": {"brightness": 100},
                }
            ],
            {},
            render,
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].index, 1)
        self.assertIsNone(results[0].error)
        self.assertEqual(results[0].command.domain, "light")
        self.assertEqual(results[0].command.service, "turn_on")
        self.assertEqual(results[0].command.data, {"brightness": 100})
        self.assertEqual(results[0].command.target, {"entity_id": "light.x"})

    async def test_invalid_action_string_is_isolated_as_an_error(self):
        results = await actions.build_service_calls(
            [{"action": "not-a-valid-service"}], {}, render
        )
        self.assertEqual(len(results), 1)
        self.assertIsNone(results[0].command)
        self.assertIsNotNone(results[0].error)

    async def test_one_bad_action_does_not_stop_the_others(self):
        results = await actions.build_service_calls(
            [
                {"action": "not-a-valid-service"},
                {"action": "light.turn_off", "target": {}, "data": {}},
            ],
            {},
            render,
        )
        self.assertEqual(len(results), 2)
        self.assertIsNotNone(results[0].error)
        self.assertIsNone(results[1].error)
        self.assertEqual(results[1].command.service, "turn_off")

    async def test_preserves_original_index_across_results(self):
        results = await actions.build_service_calls(
            [
                {"action": "light.turn_on", "target": {}, "data": {}},
                {"action": "light.turn_off", "target": {}, "data": {}},
                {"action": "light.toggle", "target": {}, "data": {}},
            ],
            {},
            render,
        )
        self.assertEqual([r.index for r in results], [1, 2, 3])

    async def test_renders_templated_action_string(self):
        results = await actions.build_service_calls(
            [{"action": "{{ service }}", "target": {}, "data": {}}],
            {"service": "light.turn_on"},
            render,
        )
        self.assertEqual(results[0].command.domain, "light")
        self.assertEqual(results[0].command.service, "turn_on")

    async def test_none_data_values_are_removed(self):
        results = await actions.build_service_calls(
            [
                {
                    "action": "light.turn_on",
                    "target": {},
                    "data": {"color": None, "brightness": 10},
                }
            ],
            {},
            render,
        )
        self.assertEqual(results[0].command.data, {"brightness": 10})


if __name__ == "__main__":
    unittest.main()
