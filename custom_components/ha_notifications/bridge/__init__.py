"""The bridge package: frontend transport and panel registration."""

from __future__ import annotations

import hashlib
from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from ..const import DOMAIN

FRONTEND_URL = f"/{DOMAIN}/frontend"
PANEL_URL = f"{FRONTEND_URL}/panel.js"
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
            StaticPathConfig(FRONTEND_URL, str(panel_path.parent), cache_headers=False),
            StaticPathConfig(BRAND_URL, str(brand_path), cache_headers=False),
        ]
    )
    # HA's service worker caches by exact URL; the hash makes updates load immediately.
    version = await hass.async_add_executor_job(_file_hash, panel_path)
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="ha-notifications-panel",
        sidebar_title="HA Notifications",
        sidebar_icon="mdi:bell-outline",
        frontend_url_path=DOMAIN,
        module_url=f"{PANEL_URL}?v={version}",
        require_admin=True,
    )
    _PANEL_REGISTERED.add(id(hass))


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]
