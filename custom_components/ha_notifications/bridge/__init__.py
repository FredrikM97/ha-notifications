"""The bridge package: frontend transport and panel registration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from ..const import DOMAIN

PANEL_URL = f"/{DOMAIN}/panel.js"
BRAND_URL = f"/{DOMAIN}/brand"
_PANEL_REGISTERED: set[int] = set()


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the packaged panel asset and sidebar panel once."""
    if id(hass) in _PANEL_REGISTERED:
        return

    panel_path = Path(__file__).parent.parent / "frontend" / "panel.js"
    if not panel_path.is_file():
        raise FileNotFoundError(f"Packaged frontend panel is missing: {panel_path}")

    brand_path = panel_path.parent.parent / "brand"
    if not (brand_path / "icon.png").is_file():
        raise FileNotFoundError(
            f"Packaged frontend icon is missing: {brand_path / 'icon.png'}"
        )

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(PANEL_URL, str(panel_path), cache_headers=False),
            StaticPathConfig(BRAND_URL, str(brand_path), cache_headers=False),
        ]
    )
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="ha-notifications-panel",
        sidebar_title="HA Notifications",
        sidebar_icon="mdi:bell-outline",
        frontend_url_path=DOMAIN,
        module_url=PANEL_URL,
        require_admin=True,
    )
    _PANEL_REGISTERED.add(id(hass))
