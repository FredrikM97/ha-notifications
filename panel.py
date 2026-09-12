"""Notification Center Home Assistant panel."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN


FRONTEND_DIR = Path(__file__).parent / "frontend"

STATIC_URL = f"/{DOMAIN}_static"
PANEL_URL = f"{STATIC_URL}/panel.js"

FRONTEND_VERSION = "0.3.2"

_STATIC_REGISTERED = f"{DOMAIN}_frontend_static_registered"


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Register the Notification Center frontend."""

    panel_file = FRONTEND_DIR / "panel.js"

    if not panel_file.is_file():
        raise RuntimeError(
            f"Notification Center frontend is missing: {panel_file}"
        )

    # Register the directory containing panel.js and its imported modules.
    #
    # panel.js can therefore use:
    #
    #   import "./api.js";
    #   import "./editor.js";
    #   import "./history.js";
    #   import "./styles.js";
    #
    # and the browser will resolve those relative to panel.js.
    if not hass.data.get(_STATIC_REGISTERED):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    STATIC_URL,
                    str(FRONTEND_DIR),
                    False,
                )
            ]
        )

        hass.data[_STATIC_REGISTERED] = True

    # Register the actual Home Assistant panel.
    #
    # IMPORTANT:
    # module_url is intentional.
    #
    # js_url would load panel.js as a classic script and would cause:
    #
    #   Cannot use import statement outside a module
    #
    # module_url loads it as an ES module.
    if not frontend.async_panel_exists(hass, DOMAIN):
        await panel_custom.async_register_panel(
            hass=hass,
            frontend_url_path=DOMAIN,
            webcomponent_name="notification-center-panel",
            sidebar_title="Notification Center",
            sidebar_icon="mdi:bell-cog",
            module_url=f"{PANEL_URL}?v={FRONTEND_VERSION}",
            require_admin=True,
        )


def async_unregister_frontend(hass: HomeAssistant) -> None:
    """Remove the Notification Center panel."""

    frontend.async_remove_panel(
        hass,
        DOMAIN,
        warn_if_unknown=False,
    )