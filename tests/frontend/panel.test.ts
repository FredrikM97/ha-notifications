// @vitest-environment happy-dom

import { within } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Alert, Hass, Registries } from "../../frontend/types.js";
import {
  configFixture,
  configuredAlertFixture,
  alertCardRoots,
  cleanupTestDom,
  emptyRegistries,
  homeAssistantFixture,
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
const cancelRun = vi.fn();
const validateAlert = vi.fn();

vi.mock("../../frontend/api.js", () => ({
  deleteAlert,
  cancelRun,
  errorMessage: (error: unknown) => String(error),
  getAlerts,
  getAutomationStatus,
  getHistory,
  getConfig,
  loadRegistries,
  saveAlert,
  validateAlert,
}));

await import("../../frontend/panel.js");

const alert: Alert = configuredAlertFixture();

function setupApi(): void {
  getAlerts.mockResolvedValue([alert]);
  getAutomationStatus.mockResolvedValue({
    [alert.id]: {
      status: "managed",
      enabled: true,
      automation_id: `ha_notifications_${alert.id}`,
    },
  });
  getHistory.mockResolvedValue([]);
  loadRegistries.mockResolvedValue(emptyRegistries());
  getConfig.mockResolvedValue(configFixture);
  saveAlert.mockResolvedValue(alert);
  deleteAlert.mockResolvedValue({});
  cancelRun.mockResolvedValue({ cancelled: true });
  validateAlert.mockResolvedValue({});
}

function mountPanel(overrides: Partial<Hass> = {}): HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
} {
  setupApi();
  return mountCustomElement("ha-notifications-panel", {
    hass: homeAssistantFixture(overrides),
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
    alerts: alertCardRoots(root).map((cardRoot) => ({
      name: cardRoot.querySelector(".nc-alert-name")?.textContent?.trim(),
      statuses: [...cardRoot.querySelectorAll(".nc-alert-statuses span")].map(
        (status) => status.textContent?.replace(/\s+/g, " ").trim(),
      ),
      meta: cardRoot.querySelector(".nc-alert-meta")?.textContent?.replace(/\s+/g, " ").trim(),
      actions: [...cardRoot.querySelectorAll(".nc-alert-actions button")].map(
        (button) => button.getAttribute("aria-label"),
      ),
    })),
  };
}

function alertListRoot(root: ShadowRoot): ShadowRoot | null {
  return root.querySelector("ha-notifications-alert-list")?.shadowRoot || null;
}

async function settlePanel(panel: HTMLElement & { shadowRoot: ShadowRoot }): Promise<void> {
  await settleElement(panel);
  const alertList = panel.shadowRoot.querySelector("ha-notifications-alert-list");
  if (!alertList) return;
  await settleElement(alertList);
  await Promise.all(
    [...(alertList.shadowRoot?.querySelectorAll("ha-notifications-alert-card") || [])]
      .map((card) => settleElement(card)),
  );
}

afterEach(() => {
  cleanupTestDom();
  vi.clearAllMocks();
});

describe("panel view", () => {
  it("renders the alert dashboard and status card", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settlePanel(panel);

    expect(panel.shadowRoot.textContent).not.toContain("Attempt 2/3");
    const cardRoot = alertCardRoots(panel.shadowRoot)[0];
    expect(cardRoot.querySelectorAll(".nc-alert-actions .nc-button-label")).toHaveLength(5);
    expect(panel.shadowRoot.textContent).not.toContain("restart");
    expect(panel.shadowRoot.textContent).not.toContain("active:");
    expect(
      cardRoot.querySelector<HTMLAnchorElement>(".nc-open-automation")?.href,
    ).toContain(`/config/automation/edit/ha_notifications_${alert.id}`);
    expect(
      cardRoot.querySelector<HTMLAnchorElement>(".nc-open-automation")?.classList,
    ).toContain("nc-button");
    expect(
      cardRoot.querySelector<HTMLAnchorElement>(".nc-open-automation")?.textContent,
    ).toContain("Open automation");
    expect(
      cardRoot.querySelector(".nc-open-automation ha-icon")?.getAttribute("icon"),
    ).toBe("mdi:open-in-new");
    expect(panelContract(panel.shadowRoot.querySelector(".nc-page"))).toMatchSnapshot();
  });

  it("shows Idle when an automation is not running", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(getAutomationStatus).toHaveBeenCalledOnce());
    getAutomationStatus.mockResolvedValue({
      [alert.id]: {
        status: "managed",
        enabled: true,
        current: 0,
      },
    });
    await (panel as HTMLElement & { refresh(): Promise<void> }).refresh();
    await settlePanel(panel);

    const statuses = [...alertCardRoots(panel.shadowRoot!)[0].querySelectorAll(".nc-alert-statuses span")]
      .map((status) => status.textContent?.replace(/\\s+/g, " ").trim());
    expect(statuses).toContain("Idle");
  });

  it("refreshes data when Home Assistant provides a newer hass state", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);
    getAlerts.mockClear();
    getAutomationStatus.mockClear();
    getHistory.mockClear();

    (panel as HTMLElement & { hass: Hass }).hass = homeAssistantFixture({
      connection: (panel as HTMLElement & { hass: Hass }).hass.connection,
    });

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
        current: 0,
      },
    });
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settlePanel(panel);

    const cardRoot = alertCardRoots(panel.shadowRoot)[0];
    expect(cardRoot.textContent).toContain("Idle");
    expect(cardRoot.textContent).not.toContain("Automation missing");
  });

  it("shows unfinished alerts in the Active view", async () => {
    getAutomationStatus.mockResolvedValueOnce({
      [alert.id]: {
        status: "managed",
        enabled: true,
        mode: "parallel",
        current: 3,
        running: true,
        triggered: false,
      },
    });
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    await testUser().click(within(panel.shadowRoot).getByRole("button", { name: "Active" }));
    await settleElement(panel);

    const cardRoots = alertCardRoots(panel.shadowRoot);
    expect(cardRoots).toHaveLength(1);
    expect(cardRoots[0].textContent).toContain("Triggered");
    expect(cardRoots[0].querySelector(".nc-status.run-count")?.textContent).toContain(
      "3 active runs",
    );
    expect(cardRoots[0].textContent).not.toContain("Active");
    expect(cardRoots[0].querySelector(".nc-status.triggered")).not.toBeNull();
    expect(cardRoots[0].querySelector(".nc-status.running")).toBeNull();
    expect(
      cardRoots[0].querySelector(".nc-status.triggered ha-icon")?.getAttribute("icon"),
    ).toBe("mdi:progress-clock");
    expect(
      cardRoots[0].querySelector<HTMLButtonElement>(
        'button[aria-label="Cancel active runs"]',
      ),
    ).not.toBeNull();
    expect(
      cardRoots[0].querySelector<HTMLButtonElement>('button[aria-label="Disable"]'),
    ).not.toBeNull();
  });

  it("cancels a running alert and refreshes runtime status", async () => {
    getAutomationStatus
      .mockResolvedValueOnce({
        [alert.id]: {
          status: "managed",
          enabled: true,
          mode: "restart",
          current: 1,
          running: true,
        },
      })
      .mockResolvedValueOnce({
        [alert.id]: {
          status: "managed",
          enabled: true,
          mode: "restart",
          current: 0,
          running: false,
        },
      });
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settlePanel(panel);

    await testUser().click(
      alertCardRoots(panel.shadowRoot)[0].querySelector<HTMLButtonElement>(
        'button[aria-label="Cancel active runs"]',
      )!,
    );

    await vi.waitFor(() =>
      expect(cancelRun).toHaveBeenCalledWith(
        expect.objectContaining({ user: { is_admin: true } }),
        alert.id,
      ),
    );
    await vi.waitFor(() =>
      expect(
        panel.shadowRoot
          .querySelector("ha-notifications-toast-list")
          ?.shadowRoot?.textContent,
      ).toContain("Active runs cancelled."),
    );
    await vi.waitFor(() =>
      expect(
        alertCardRoots(panel.shadowRoot)[0].querySelector(
          'button[aria-label="Cancel active runs"]',
        ),
      ).toBeNull(),
    );
  });

  it("shows Idle after a trigger has finished, regardless of history", async () => {
    getAutomationStatus.mockResolvedValueOnce({
      [alert.id]: {
        status: "managed",
        enabled: true,
        mode: "restart",
        current: 0,
        triggered: true,
      },
    });
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settlePanel(panel);

    const cardRoot = alertCardRoots(panel.shadowRoot)[0];
    expect(cardRoot.textContent).toContain("Idle");
    expect(cardRoot.textContent).not.toContain("Triggered");
    expect(cardRoot.querySelector(".nc-status.running")).toBeNull();
    expect(cardRoot.querySelector(".nc-status.idle")).not.toBeNull();

    await testUser().click(within(panel.shadowRoot).getByRole("button", { name: "Active" }));
    await settleElement(panel);
    expect(alertCardRoots(panel.shadowRoot)).toHaveLength(0);
  });

  it("returns to Idle after an inactive condition evaluation", async () => {
    getAutomationStatus.mockResolvedValueOnce({
      [alert.id]: {
        status: "managed",
        enabled: true,
        mode: "restart",
        current: 0,
        triggered: false,
      },
    });
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settlePanel(panel);

    const cardRoot = alertCardRoots(panel.shadowRoot)[0];
    expect(cardRoot.textContent).toContain("Idle");
    expect(cardRoot.textContent).not.toContain("Triggered");
    expect(cardRoot.querySelector(".nc-status.inactive")).toBeNull();
    expect(cardRoot.querySelector(".nc-status.idle")).not.toBeNull();
  });

  it("excludes idle alerts even when a notification is outstanding", async () => {
    getAutomationStatus.mockResolvedValueOnce({
      [alert.id]: {
        status: "managed",
        enabled: true,
        mode: "parallel",
        current: 0,
        running: true,
        notification_active: true,
      },
    });
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    await testUser().click(within(panel.shadowRoot).getByRole("button", { name: "Active" }));
    await settleElement(panel);

    expect(alertCardRoots(panel.shadowRoot)).toHaveLength(0);
    expect(alertListRoot(panel.shadowRoot)?.querySelector(".nc-empty")).not.toBeNull();
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
        triggers: [{ trigger: "time_pattern", minutes: "/5" }],
      },
    ]);
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settleElement(panel);

    expect(alertCardRoots(panel.shadowRoot)[0].querySelector(".nc-alert-meta")).toBeNull();
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
    await settlePanel(panel);

    expect({
      title: alertListRoot(panel.shadowRoot)?.querySelector(".nc-empty h2")?.textContent,
      message: alertListRoot(panel.shadowRoot)?.querySelector(".nc-empty p")?.textContent?.replace(/\s+/g, " ").trim(),
      action: alertListRoot(panel.shadowRoot)?.querySelector(".nc-empty button")?.textContent?.trim(),
    }).toMatchSnapshot();
  });

  it("opens the editor from the alert-list create action", async () => {
    getAlerts.mockResolvedValueOnce([]);
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settlePanel(panel);

    await testUser().click(
      alertListRoot(panel.shadowRoot)?.querySelector<HTMLButtonElement>(
        ".nc-empty button",
      )!,
    );

    await vi.waitFor(() => expect(loadRegistries).toHaveBeenCalledOnce());
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
    expect(historyView.shadowRoot?.querySelector(".nc-empty")).not.toBeNull();

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
    await settlePanel(panel);
    await testUser().click(
      alertCardRoots(panel.shadowRoot)[0].querySelector<HTMLButtonElement>(
        'button[aria-label="Disable"]',
      )!,
    );

    expect(saveAlert).toHaveBeenCalledWith(
      expect.objectContaining({ user: { is_admin: true } }),
      { ...alert, enabled: false },
    );
  });

  it("opens the editor from an alert-card edit action", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settlePanel(panel);

    await testUser().click(
      alertCardRoots(panel.shadowRoot)[0].querySelector<HTMLButtonElement>(
        'button[aria-label="Edit alert"]',
      )!,
    );

    await vi.waitFor(() =>
      expect(
        panel.shadowRoot.querySelector("ha-notifications-alert-editor"),
      ).not.toBeNull(),
    );
    expect(loadRegistries).toHaveBeenCalledOnce();
  });

  it("opens an empty local history view", async () => {
    const panel = mountPanel();
    await vi.waitFor(() => expect(getAlerts).toHaveBeenCalledOnce());
    await settlePanel(panel);
    const queries = within(panel.shadowRoot);
    const user = testUser();

    await user.click(
      alertCardRoots(panel.shadowRoot)[0].querySelector<HTMLButtonElement>(
        'button[aria-label="View history"]',
      )!,
    );
    await settleElement(panel);
    expect(
      panel.shadowRoot
        .querySelector("ha-notifications-history-view")
        ?.shadowRoot?.querySelector(".nc-empty"),
    ).not.toBeNull();
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
