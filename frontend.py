"""Frontend registration for Notification Center."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import (
    StaticPathConfig,
)
from homeassistant.core import HomeAssistant

from .const import (
    DOMAIN,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL_PATH,
)


async def async_register_frontend(
    hass: HomeAssistant,
) -> None:
    """Register Notification Center frontend."""
    frontend_dir = Path(__file__).parent / "frontend"

    state = hass.data.setdefault(
        DOMAIN,
        {},
    )

    if not state.get(
        "static_frontend_registered"
    ):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    STATIC_URL_PATH,
                    str(frontend_dir),
                    cache_headers=False,
                )
            ]
        )

        state[
            "static_frontend_registered"
        ] = True

    # Remove an old broken registration if present.
    if PANEL_URL_PATH in hass.data.get(
        "frontend_panels",
        {},
    ):
        async_remove_panel(
            hass,
            PANEL_URL_PATH,
        )

    async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,
        config={
            "_panel_custom": {
                "name": "notification-center-panel",
                "embed_iframe": False,
                "trust_external": False,
                "module_url": (
                    f"{STATIC_URL_PATH}/panel.js"
                ),
            }
        },
        require_admin=True,
        update=True,
    )


def async_unregister_frontend(
    hass: HomeAssistant,
) -> None:
    """Unregister Notification Center panel."""
    if PANEL_URL_PATH in hass.data.get(
        "frontend_panels",
        {},
    ):
        async_remove_panel(
            hass,
            PANEL_URL_PATH,
        )