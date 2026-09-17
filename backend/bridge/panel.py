"""Pure frontend panel registration data - no Home Assistant import.

`controller/core.py` performs the actual registration calls via
the controller, using the plan this module builds. This is the explicit
"loading the frontend" exception: no application data, no backend
dependency - just static registration facts.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..const import (
    DOMAIN,
    FRONTEND_BUILD_DIR,
    FRONTEND_STATIC_URL,
    PANEL_ICON,
    PANEL_MODULE,
    PANEL_TITLE,
    VERSION,
)

FRONTEND_DIR = Path(__file__).parent.parent / FRONTEND_BUILD_DIR


@dataclass(frozen=True)
class PanelRegistrationPlan:
    """Everything needed to register the frontend panel."""

    static_url: str
    static_directory: str
    module_url: str
    frontend_url_path: str
    webcomponent_name: str
    sidebar_title: str | None
    sidebar_icon: str | None


def registration_plan(*, show_in_sidebar: bool) -> PanelRegistrationPlan:
    """Build the frontend registration plan.

    Raises ``RuntimeError`` if the compiled frontend bundle is missing.
    """

    panel_file = FRONTEND_DIR / "panel.js"
    if not panel_file.is_file():
        raise RuntimeError(f"HA Notifications frontend is missing: {panel_file}")

    return PanelRegistrationPlan(
        static_url=FRONTEND_STATIC_URL,
        static_directory=str(FRONTEND_DIR),
        module_url=f"{PANEL_MODULE}?v={VERSION}",
        frontend_url_path=DOMAIN,
        webcomponent_name="ha-notifications-panel",
        sidebar_title=PANEL_TITLE if show_in_sidebar else None,
        sidebar_icon=PANEL_ICON if show_in_sidebar else None,
    )
