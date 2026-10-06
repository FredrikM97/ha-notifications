// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Alert, Hass } from "../../frontend/types.js";
import {
  configFixture,
  configuredAlertFixture,
  cleanupTestDom,
  homeAssistantFixture,
  mountCustomElement,
  settleElement,
} from "./conftest.js";

const api = vi.hoisted(() => ({
  getAlerts: vi.fn(),
  getAutomationStatus: vi.fn(),
  getHistory: vi.fn(),
  loadUsers: vi.fn(),
  getConfig: vi.fn(),
  saveAlert: vi.fn(),
  deleteAlert: vi.fn(),
  cancelRun: vi.fn(),
  validateAlert: vi.fn(),
}));

vi.mock("../../frontend/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../frontend/api.js")>()),
  ...api,
  errorMessage: (error: unknown) => String(error),
}));

await import("../../frontend/panel.js");

const alert: Alert = configuredAlertFixture();

afterEach(() => {
  cleanupTestDom();
  vi.clearAllMocks();
});

function setupApi(): void {
  api.getAlerts.mockResolvedValue([alert]);
  api.getAutomationStatus.mockResolvedValue({
    [alert.id]: {
      status: "managed",
      enabled: true,
      automation_id: `ha_notifications_${alert.id}`,
      current: 0,
    },
  });
  api.getHistory.mockResolvedValue([]);
  api.loadUsers.mockResolvedValue([]);
  api.getConfig.mockResolvedValue(configFixture);
  api.saveAlert.mockResolvedValue(alert);
  api.deleteAlert.mockResolvedValue({});
  api.cancelRun.mockResolvedValue({ cancelled: true });
  api.validateAlert.mockResolvedValue({});
}

function mountPanel(overrides: Partial<Hass> = {}): HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
} {
  setupApi();
  return mountCustomElement("ha-notifications-panel", {
    hass: homeAssistantFixture(overrides),
  }) as HTMLElement & {
    shadowRoot: ShadowRoot;
    updateComplete: Promise<unknown>;
  };
}

async function ready(panel: HTMLElement & { shadowRoot: ShadowRoot }): Promise<void> {
  await vi.waitFor(() => expect(api.getAlerts).toHaveBeenCalledOnce());
  await settleElement(panel);
}

function selectTab(panel: HTMLElement, name: string): void {
  panel.shadowRoot!.querySelector("ha-tab-group")!.dispatchEvent(
    new CustomEvent("wa-tab-show", { detail: { name } }),
  );
}

describe("panel view", () => {
  it("opens the native automation editor without hass.navigate", async () => {
    const original = window.location.href;
    const originalState = window.history.state;
    const locationChanged = vi.fn();
    window.addEventListener("location-changed", locationChanged);
    try {
      const panel = mountPanel();
      await ready(panel);
      const menu = panel.shadowRoot.querySelector("ha-icon-overflow-menu") as HTMLElement & {
        items: { label: string; action(): void }[];
      };
      menu.items.find(item => item.label === "Open automation")!.action();
      expect(window.location.pathname).toBe(`/config/automation/edit/ha_notifications_${alert.id}`);
      expect(locationChanged).toHaveBeenCalledOnce();
      expect((locationChanged.mock.calls[0][0] as CustomEvent).detail).toEqual({ replace: false });
    } finally {
      window.removeEventListener("location-changed", locationChanged);
      window.history.replaceState(originalState, "", original);
    }
  });

  it("renders alert rows and their runtime status", async () => {
    const panel = mountPanel();
    await ready(panel);

    expect(panel.shadowRoot.querySelector(".nc-alert-list")).not.toBeNull();
    expect(panel.shadowRoot.querySelector(".nc-alert-name")?.textContent).toBe(alert.name);
    expect(panel.shadowRoot.querySelector(".nc-alert-secondary")?.textContent).toContain("Idle");
  });

  it("filters the Active tab to alerts with running automation instances", async () => {
    api.getAutomationStatus.mockResolvedValueOnce({
      [alert.id]: { status: "managed", enabled: true, current: 2 },
    });
    const panel = mountPanel();
    await ready(panel);

    selectTab(panel, "active");
    await settleElement(panel);

    expect(panel.shadowRoot.querySelectorAll(".nc-alert")).toHaveLength(1);
    expect(panel.shadowRoot.querySelector(".nc-alert-secondary")?.textContent).toContain("2 active runs");
  });

  it("saves the enabled state when the row switch changes", async () => {
    const panel = mountPanel();
    await ready(panel);
    const toggle = panel.shadowRoot.querySelector("ha-switch")!;

    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(api.saveAlert).toHaveBeenCalledWith(
      expect.objectContaining({ user: { is_admin: true } }),
      { ...alert, enabled: false },
    ));
  });

  it("loads users and opens the editor from an alert row", async () => {
    const panel = mountPanel();
    await ready(panel);

    panel.shadowRoot.querySelector<HTMLElement>(".nc-alert")!.click();

    await vi.waitFor(() => expect(api.loadUsers).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(
      panel.shadowRoot.querySelector("ha-notifications-alert-editor"),
    ).not.toBeNull());
  });

  it("switches between History and YAML views", async () => {
    const panel = mountPanel();
    await ready(panel);

    selectTab(panel, "history");
    await settleElement(panel);
    expect(panel.shadowRoot.querySelector("ha-notifications-history-view")).not.toBeNull();

    selectTab(panel, "yaml");
    await settleElement(panel);
    expect(panel.shadowRoot.querySelector("ha-notifications-yaml-view")).not.toBeNull();
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalledOnce());
  });

  it("does not load dashboard data for non-admin users", async () => {
    const panel = mountPanel({ user: { is_admin: false } });
    await settleElement(panel);

    expect(panel.shadowRoot.querySelector(".nc-empty")?.textContent).toContain("administrator");
    expect(api.getAlerts).not.toHaveBeenCalled();
  });

  it("registers the Lovelace card contract", () => {
    const card = document.createElement("ha-notifications-card") as HTMLElement & {
      getCardSize(): number;
    };
    const constructor = customElements.get("ha-notifications-card") as typeof HTMLElement & {
      getStubConfig(): { type: string };
    };

    expect(card.getCardSize()).toBe(12);
    expect(constructor.getStubConfig()).toEqual({ type: "custom:ha-notifications-card" });
  });
});