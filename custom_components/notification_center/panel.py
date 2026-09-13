"""Notification Center Home Assistant panel."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import (
    DOMAIN,
    FRONTEND_BUILD_DIR,
    FRONTEND_MODULE_REGISTERED_KEY,
    FRONTEND_REGISTERED_KEY,
    FRONTEND_STATIC_URL,
    PANEL_ICON,
    PANEL_MODULE,
    PANEL_TITLE,
    VERSION,
)

FRONTEND_DIR = Path(__file__).parent / FRONTEND_BUILD_DIR


async def async_register_frontend(
    hass: HomeAssistant,
    *,
    show_in_sidebar: bool,
) -> None:
    """Register the Notification Center frontend."""

    panel_file = FRONTEND_DIR / "panel.js"

    if not panel_file.is_file():
        raise RuntimeError(
            f"Notification Center frontend is missing: {panel_file}"
        )
    if not hass.data.get(FRONTEND_REGISTERED_KEY):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    FRONTEND_STATIC_URL,
                    str(FRONTEND_DIR),
                    False,
                )
            ]
        )

        hass.data[FRONTEND_REGISTERED_KEY] = True

    module_url = f"{PANEL_MODULE}?v={VERSION}"
    if not hass.data.get(FRONTEND_MODULE_REGISTERED_KEY):
        frontend.add_extra_js_url(hass, module_url)
        hass.data[FRONTEND_MODULE_REGISTERED_KEY] = True

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
            sidebar_title=PANEL_TITLE if show_in_sidebar else None,
            sidebar_icon=PANEL_ICON if show_in_sidebar else None,
            module_url=module_url,
            require_admin=True,
        )


def async_unregister_frontend(hass: HomeAssistant) -> None:
    """Remove the Notification Center panel."""

    frontend.async_remove_panel(
        hass,
        DOMAIN,
        warn_if_unknown=False,
    )