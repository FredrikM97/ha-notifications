// @vitest-environment happy-dom

import { within } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Alert, Hass, Registries } from "../../frontend/types.js";
import {
  alertRuntimeFixture,
  configFixture,
  configuredAlertFixture,
  previewSessionResultFixture,
  emptyRegistries,
  mountCustomElement,
  settleElement,
  testUser,
} from "./conftest.js";

const getAlerts = vi.fn();
const getAlertRuntime = vi.fn();
const getHistory = vi.fn();
const loadRegistries = vi.fn();
const getConfig = vi.fn();
const saveAlert = vi.fn();
const deleteAlert = vi.fn();
const previewAlertPayload = vi.fn();
const validateConditions = vi.fn();

vi.mock("../../frontend/api.js", () => ({
  deleteAlert,
  errorMessage: (error: unknown) => String(error),
  getAlerts,
  getAlertRuntime,
  getConfig,
  getHistory,
  loadRegistries,
  saveAlert,
  previewAlertPayload,
  validateConditions,
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
  getAlertRuntime.mockResolvedValue(alertRuntimeFixture);
  getHistory.mockResolvedValue([]);
  loadRegistries.mockResolvedValue(emptyRegistries());
  getConfig.mockResolvedValue(configFixture);
  saveAlert.mockResolvedValue(alert);
  deleteAlert.mockResolvedValue({});
  previewAlertPayload.mockResolvedValue(previewSessionResultFixture);
  validateConditions.mockResolvedValue({});
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
    expect(panel.shadowRoot.querySelectorAll(".nc-alert-actions .nc-button-label")).toHaveLength(0);
    expect(panelContract(panel.shadowRoot.querySelector(".nc-page"))).toMatchSnapshot();
  });

  it("keeps an exit to Home Assistant reachable from the dashboard", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    const backLink =
      panel.shadowRoot.querySelector<HTMLAnchorElement>('a[href="/"]');
    expect(backLink?.getAttribute("aria-label")).toBe("Back to Home Assistant");
  });

  it("shows the last notification time in the overview when available", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);
    getAlerts.mockResolvedValueOnce([
      {
        ...alert,
      },
    ]);
    getAlertRuntime.mockResolvedValueOnce({
      door: {
        ...alertRuntimeFixture.door,
        state: {
          ...alertRuntimeFixture.door.state,
          last_notified: "2026-09-23T12:57:37.627672+00:00",
        },
      },
    });
    await panel.refresh();
    await settleElement(panel);

    expect(panel.shadowRoot.querySelector(".nc-alert-meta")?.textContent).toContain(
      "Last notified:",
    );
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

  it("shows active alerts before their live runtime in Debug", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    await testUser().click(
      within(panel.shadowRoot).getByRole("button", { name: "Debug" }),
    );
    await settleElement(panel);

    const debugAlert = panel.shadowRoot.querySelector(".nc-debug-alert");
    expect(debugAlert?.querySelector("summary")?.textContent).toContain(
      "Front door",
    );
    expect(debugAlert?.querySelectorAll(".nc-debug-section")).toHaveLength(2);
    expect(debugAlert?.textContent).not.toContain('"config"');
    expect(debugAlert?.textContent).toContain('"flow_id": "flow_door"');
  });

  it("omits inactive alerts and runtime from Debug", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    getAlerts.mockResolvedValueOnce([
      alert,
      { ...alert, id: "inactive", name: "Inactive alert" },
    ]);
    getAlertRuntime.mockResolvedValueOnce({
      ...alertRuntimeFixture,
      inactive: {
        ...alertRuntimeFixture.door,
        config: { id: "inactive", name: "Inactive alert" },
        state: { active: false },
      },
    });
    await panel.refresh();
    await settleElement(panel);

    await testUser().click(
      within(panel.shadowRoot).getByRole("button", { name: "Debug" }),
    );
    await settleElement(panel);

    expect(panel.shadowRoot.querySelectorAll(".nc-debug-alert")).toHaveLength(1);
    expect(panel.shadowRoot.textContent).not.toContain("Inactive alert");
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
      { ...alert, runtime: alertRuntimeFixture.door, enabled: false },
    );
  });

  it("tests an alert and opens its filtered history", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);
    const queries = within(panel.shadowRoot);
    const user = testUser();

    await user.click(queries.getByRole("button", { name: "Test alert" }));
    await vi.waitFor(() => expect(previewAlertPayload).toHaveBeenCalledOnce());

    await user.click(queries.getByRole("button", { name: "View history" }));
    await vi.waitFor(() =>
      expect(getHistory).toHaveBeenCalledWith(
        expect.objectContaining({ user: { is_admin: true } }),
        "door",
        150,
      ),
    );
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
