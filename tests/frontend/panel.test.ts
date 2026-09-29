// @vitest-environment happy-dom

import { within } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Alert, Hass, Registries } from "../../frontend/types.js";
import {
  configFixture,
  configuredAlertFixture,
  emptyRegistries,
  mountCustomElement,
  settleElement,
  testUser,
} from "./conftest.js";

const getAlerts = vi.fn();
const getAutomationStatus = vi.fn();
const getHistory = vi.fn();
const loadRegistries = vi.fn();
const getConfig = vi.fn();
const saveAlert = vi.fn();
const deleteAlert = vi.fn();
const validateAlert = vi.fn();
const triggerAlert = vi.fn();

vi.mock("../../frontend/api.js", () => ({
  deleteAlert,
  errorMessage: (error: unknown) => String(error),
  getAlerts,
  getAutomationStatus,
  getHistory,
  getConfig,
  loadRegistries,
  saveAlert,
  validateAlert,
  triggerAlert,
}));

await import("../../frontend/panel.js");

const hass = {
  user: { is_admin: true },
  locale: { language: "en", date_format: "YMD", time_format: "24" },
  connection: { sendMessagePromise: vi.fn() },
} as unknown as Hass;

const alert: Alert = configuredAlertFixture();

function setupApi(): void {
  getAlerts.mockResolvedValue([alert]);
  getAutomationStatus.mockResolvedValue({
    [alert.id]: { status: "managed", enabled: true },
  });
  getHistory.mockResolvedValue([]);
  loadRegistries.mockResolvedValue(emptyRegistries());
  getConfig.mockResolvedValue(configFixture);
  saveAlert.mockResolvedValue(alert);
  deleteAlert.mockResolvedValue({});
  validateAlert.mockResolvedValue({});
  triggerAlert.mockResolvedValue({ triggered: true, alert_id: alert.id });
}

function mountPanel(overrides: Partial<Hass> = {}): HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
} {
  setupApi();
  return mountCustomElement("ha-notifications-panel", {
    hass: { ...hass, ...overrides },
  }) as HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };
}

function panelContract(root: Element | null) {
  if (!root) {
    return null;
  }

  return {
    tabs: [...root.querySelectorAll(".nc-tab")].map((tab) => ({
      label: tab.textContent?.replace(/\s+/g, " ").trim(),
      active: tab.classList.contains("active"),
    })),
    alerts: [...root.querySelectorAll(".nc-alert")].map((card) => ({
      name: card.querySelector(".nc-alert-name")?.textContent?.trim(),
      statuses: [...card.querySelectorAll(".nc-alert-statuses span")].map(
        (status) => status.textContent?.replace(/\s+/g, " ").trim(),
      ),
      meta: card.querySelector(".nc-alert-meta")?.textContent?.replace(/\s+/g, " ").trim(),
      actions: [...card.querySelectorAll(".nc-alert-actions button")].map(
        (button) => button.getAttribute("aria-label"),
      ),
    })),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("panel view", () => {
  it("renders the alert dashboard and status card", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    expect(panel.shadowRoot.textContent).not.toContain("Attempt 2/3");
    expect(panel.shadowRoot.querySelectorAll(".nc-alert-actions .nc-button-label")).toHaveLength(5);
    expect(panel.shadowRoot.textContent).not.toContain("restart");
    expect(panel.shadowRoot.textContent).not.toContain("active:");
    expect(panelContract(panel.shadowRoot.querySelector(".nc-page"))).toMatchSnapshot();
  });

  it("refreshes data when Home Assistant provides a newer hass state", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);
    getAlerts.mockClear();
    getAutomationStatus.mockClear();
    getHistory.mockClear();

    (panel as HTMLElement & { hass: Hass }).hass = {
      ...hass,
      connection: hass.connection,
    };

    await vi.waitFor(() => {
      expect(getAlerts).toHaveBeenCalledOnce();
      expect(getAutomationStatus).toHaveBeenCalledOnce();
      expect(getHistory).toHaveBeenCalledOnce();
    });
  });

  it("shows runtime state instead of an automation missing warning", async () => {
    getAutomationStatus.mockResolvedValueOnce({
      [alert.id]: {
        status: "missing",
        enabled: false,
        mode: "single",
        active_runs: 0,
        active_runs_uncertain: false,
        last_triggered: null,
      },
    });
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    expect(panel.shadowRoot.textContent).toContain("Idle");
    expect(panel.shadowRoot.textContent).not.toContain("Automation missing");
  });

  it("shows unfinished alerts in the Active view", async () => {
    getAutomationStatus.mockResolvedValueOnce({
      [alert.id]: {
        status: "managed",
        enabled: true,
        mode: "parallel",
        active_runs: 1,
        active_runs_uncertain: false,
        last_triggered: "2026-09-29T12:00:00+00:00",
      },
    });
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    await testUser().click(within(panel.shadowRoot).getByRole("button", { name: "Active" }));
    await settleElement(panel);

    expect(panel.shadowRoot.querySelectorAll(".nc-alert")).toHaveLength(1);
    expect(panel.shadowRoot.textContent).toContain("Active");
  });

  it("keeps an exit to Home Assistant reachable from the dashboard", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    const backLink =
      panel.shadowRoot.querySelector<HTMLAnchorElement>('a[href="/"]');
    expect(backLink?.getAttribute("aria-label")).toBe("Back to Home Assistant");
  });

  it("does not show the evaluation interval in the overview", async () => {
    getAlerts.mockResolvedValueOnce([
      {
        ...alert,
        monitor: { ...alert.monitor, interval: "00:05:00" },
      },
    ]);
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    expect(panel.shadowRoot.querySelector(".nc-alert-meta")).toBeNull();
  });

  it("runs the configured automation from the alert test action", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    await testUser().click(
      within(panel.shadowRoot).getByRole("button", { name: "Test alert" }),
    );

    expect(triggerAlert).toHaveBeenCalledWith(hass, alert.id);
  });

  it("uses Home Assistant navigation when exiting the panel", async () => {
    const navigate = vi.fn();
    const panel = mountPanel({ navigate });
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    await testUser().click(
      panel.shadowRoot.querySelector<HTMLAnchorElement>('a[href="/"]')!,
    );

    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("renders the access guard for non-admin users", async () => {
    const panel = mountPanel({ user: { is_admin: false } });
    await settleElement(panel);

    expect({
      title: panel.shadowRoot.querySelector(".nc-empty h2")?.textContent,
      message: panel.shadowRoot.querySelector(".nc-empty p")?.textContent?.replace(/\s+/g, " ").trim(),
    }).toMatchSnapshot();
    expect(getAlerts).not.toHaveBeenCalled();
  });

  it("renders the empty dashboard state", async () => {
    getAlerts.mockResolvedValueOnce([]);
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    expect({
      title: panel.shadowRoot.querySelector(".nc-empty h2")?.textContent,
      message: panel.shadowRoot.querySelector(".nc-empty p")?.textContent?.replace(/\s+/g, " ").trim(),
      action: panel.shadowRoot.querySelector(".nc-empty button")?.textContent?.trim(),
    }).toMatchSnapshot();
  });

  it("switches between History and YAML views", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);
    const queries = within(panel.shadowRoot);
    const user = testUser();

    await user.click(queries.getByRole("button", { name: "History" }));
    await settleElement(panel);
    const historyView = panel.shadowRoot.querySelector("ha-notifications-history-view")!;
    await settleElement(historyView);
    expect(historyView.querySelector(".nc-empty")).not.toBeNull();

    await user.click(queries.getByRole("button", { name: "YAML" }));
    await settleElement(panel);
    await vi.waitFor(() => expect(getConfig).toHaveBeenCalledOnce());
    expect(panel.shadowRoot.querySelector("ha-notifications-yaml-view")).not.toBeNull();
  });

  it("caches registry loading for editor entry points", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());

    const first = await (panel as typeof panel & { getRegistries(): Promise<Registries> }).getRegistries();
    const second = await (panel as typeof panel & { getRegistries(): Promise<Registries> }).getRegistries();

    expect(first).toBe(second);
    expect(loadRegistries).toHaveBeenCalledOnce();
  });

  it("toggles an alert through the save action", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);
    await testUser().click(
      within(panel.shadowRoot).getByRole("button", { name: "Disable" }),
    );

    expect(saveAlert).toHaveBeenCalledWith(
      expect.objectContaining({ user: { is_admin: true } }),
      { ...alert, enabled: false },
    );
  });

  it("opens an empty local history view", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);
    const queries = within(panel.shadowRoot);
    const user = testUser();

    await user.click(queries.getByRole("button", { name: "View history" }));
    await settleElement(panel);
    expect(panel.shadowRoot.querySelector(".nc-empty")).not.toBeNull();
  });

  it("registers the Lovelace card contract", () => {
    const card = document.createElement("ha-notifications-card") as HTMLElement & {
      getCardSize(): number;
    };
    const constructor = customElements.get("ha-notifications-card") as typeof HTMLElement & {
      getStubConfig(): { type: string };
    };

    expect(card.getCardSize()).toBe(12);
    expect(constructor.getStubConfig()).toEqual({
      type: "custom:ha-notifications-card",
    });
  });
});
