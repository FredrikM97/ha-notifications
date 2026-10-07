// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Alert, AlertsConfig, Hass } from "../../frontend/types.js";
import type { OpenEditorOptions } from "../../frontend/editor/index.js";
import {
  configuredAlertFixture,
  cleanupTestDom,
  createHassClient,
  editorAlertFixture,
  homeAssistantFixture,
  mountCustomElement,
  settleElement,
  testUser,
} from "./conftest.js";

const editor = vi.hoisted(() => ({ openEditor: vi.fn() }));

vi.mock("../../frontend/editor/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../frontend/editor/index.js")>();
  editor.openEditor.mockImplementation(original.openEditor);
  return { ...original, openEditor: editor.openEditor };
});

await import("../../frontend/panel.js");

const alert: Alert = configuredAlertFixture();
const client = createHassClient();
const sendMessagePromise = client.sendMessagePromise;

type Panel = HTMLElement & {
  hass: Hass;
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  refresh(silent?: boolean): Promise<void>;
};

type Message = { type: string; config?: AlertsConfig; alert_id?: string };

function messages(endpoint: string): Message[] {
  const type = endpoint.includes("/") ? endpoint : `ha_notifications/${endpoint}`;
  return sendMessagePromise.mock.calls
    .map(([message]) => message as Message)
    .filter(message => message.type === type);
}

afterEach(() => {
  cleanupTestDom();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mountPanel(overrides: Partial<Hass> = {}, responses: Record<string, unknown> = {}): Panel {
  const defaults: Record<string, unknown> = {
    "ha_notifications/get_config": { version: 1, alerts: [alert] },
    "ha_notifications/automation_status": {
      [alert.id]: {
        status: "managed",
        enabled: true,
        automation_id: `ha_notifications_${alert.id}`,
        current: 0,
      },
    },
    "ha_notifications/get_history": [],
    "config/auth/list": [],
    "ha_notifications/cancel_run": { cancelled: true },
    "ha_notifications/test_alert": { started: true },
    "ha_notifications/validate_config": { valid: true },
  };
  sendMessagePromise.mockImplementation(async (message: Message) => {
    if (Object.prototype.hasOwnProperty.call(responses, message.type)) return responses[message.type];
    if (message.type === "ha_notifications/save_config") {
      responses["ha_notifications/get_config"] = message.config;
      return { saved: true, config: message.config };
    }
    if (Object.prototype.hasOwnProperty.call(defaults, message.type)) return defaults[message.type];
    throw new Error(`Unexpected transport request: ${message.type}`);
  });
  return mountCustomElement("ha-notifications-panel", {
    hass: homeAssistantFixture({ connection: client.hass.connection, ...overrides }),
  }) as Panel;
}

async function ready(panel: HTMLElement & { shadowRoot: ShadowRoot }): Promise<void> {
  await vi.waitFor(() => {
    expect(messages("get_config")).toHaveLength(1);
    expect(panel.shadowRoot.querySelector(".nc-alert-name")?.textContent).toBe(alert.name);
  });
  await settleElement(panel);
}

function menuAction(panel: Panel, label: string): void {
  const menu = panel.shadowRoot.querySelector("ha-icon-overflow-menu") as HTMLElement & {
    items: { label: string; action(): void }[];
  };
  menu.items.find(item => item.label === label)!.action();
}

async function openPanelEditor(panel: Panel, create = false): Promise<OpenEditorOptions> {
  const target = panel.shadowRoot.querySelector<HTMLElement>(
    create ? '[slot="actionItems"] ha-icon-button' : ".nc-alert",
  )!;
  await testUser().click(target);
  await vi.waitFor(() => expect(editor.openEditor).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(
    panel.shadowRoot.querySelector("ha-notifications-alert-editor"),
  ).not.toBeNull());
  return editor.openEditor.mock.lastCall![0] as OpenEditorOptions;
}

function selectTab(panel: HTMLElement, name: string): void {
  panel.shadowRoot!.querySelector("ha-tab-group")!.dispatchEvent(
    new CustomEvent("wa-tab-show", { detail: { name } }),
  );
}

describe("panel view", () => {
  it.each([false, true])("confirms Test alert before transport with accepted=%s", async accepted => {
    const confirm = vi.fn().mockReturnValue(accepted);
    vi.stubGlobal("confirm", confirm);
    const panel = mountPanel();
    await ready(panel);
    const notification = vi.fn();
    panel.addEventListener("hass-notification", notification);
    const menu = panel.shadowRoot.querySelector("ha-icon-overflow-menu") as HTMLElement & {
      items: { label: string; action(): void }[];
    };

    menu.items.find(item => item.label === "Test alert")!.action();

    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      `Test alert "${alert.name}"? This sends REAL notifications and runs configured actions, ignoring conditions. Actual trigger data is unavailable.`,
    );
    if (accepted) {
      await vi.waitFor(() => expect(messages("test_alert")).toEqual([
        { type: "ha_notifications/test_alert", alert_id: alert.id },
      ]));
      await vi.waitFor(() => expect(notification).toHaveBeenCalledOnce());
      expect((notification.mock.calls[0][0] as CustomEvent).detail).toEqual({ message: "Alert test started." });
      await vi.waitFor(() => expect(messages("get_config")).toHaveLength(2));
    } else {
      expect(messages("test_alert")).toHaveLength(0);
      expect(notification).not.toHaveBeenCalled();
      expect(messages("get_config")).toHaveLength(1);
    }
    expect(messages("save_config")).toHaveLength(0);
    expect(messages("config/auth/list")).toHaveLength(0);
  });

  it("reports Test alert errors without a started notification", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const panel = mountPanel();
    await ready(panel);
    sendMessagePromise.mockRejectedValueOnce(new Error("Automation not found"));
    const notification = vi.fn();
    panel.addEventListener("hass-notification", notification);
    const menu = panel.shadowRoot.querySelector("ha-icon-overflow-menu") as HTMLElement & {
      items: { label: string; action(): void }[];
    };

    menu.items.find(item => item.label === "Test alert")!.action();

    await vi.waitFor(() => expect(notification).toHaveBeenCalledOnce());
    expect((notification.mock.calls[0][0] as CustomEvent).detail).toEqual({
      message: "ha_notifications/test_alert: Automation not found",
    });
    expect(messages("get_config")).toHaveLength(1);
  });

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
    const panel = mountPanel({}, {
      "ha_notifications/automation_status": {
        [alert.id]: { status: "managed", enabled: true, current: 2 },
      },
    });
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

    await vi.waitFor(() => expect(messages("save_config")).toEqual([{
      type: "ha_notifications/save_config",
      config: { version: 1, alerts: [{ ...alert, enabled: false }] },
    }]));
    await vi.waitFor(() => expect(
      panel.shadowRoot.querySelector(".nc-alert")?.classList.contains("disabled"),
    ).toBe(true));
  });

  it("loads users and opens the editor from an alert row", async () => {
    const panel = mountPanel();
    await ready(panel);

    const options = await openPanelEditor(panel);

    expect(messages("config/auth/list")).toEqual([{ type: "config/auth/list" }]);
    expect(options.alert).toEqual(alert);
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
    await vi.waitFor(() => expect(messages("get_config")).toHaveLength(2));
  });

  it("does not load dashboard data for non-admin users", async () => {
    const panel = mountPanel({ user: { is_admin: false } });
    await settleElement(panel);

    expect(panel.shadowRoot.querySelector(".nc-empty")?.textContent).toContain("administrator");
    expect(sendMessagePromise).not.toHaveBeenCalled();
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

describe("panel configuration workflows", () => {
  it.each(["new", "existing"] as const)("saves a %s alert while preserving other configuration entries", async kind => {
    const other = configuredAlertFixture({ id: "window", name: "Window" });
    const config = { version: 7, alerts: [alert, other], metadata: { source: "dashboard" } };
    const panel = mountPanel({}, { "ha_notifications/get_config": config });
    await ready(panel);
    const options = await openPanelEditor(panel, kind === "new");
    const draft = configuredAlertFixture({
      id: kind === "new" ? "garage" : alert.id,
      name: "Updated alert",
    });
    const expected = {
      ...config,
      alerts: kind === "new" ? [alert, other, draft] : [draft, other],
    };

    await expect(options.onSave(draft)).resolves.toEqual(draft);

    expect(messages("save_config")).toEqual([{
      type: "ha_notifications/save_config", config: expected,
    }]);
    expect(config.alerts).toEqual([alert, other]);
  });

  it.each(["save", "validate"] as const)("canonicalizes durations and strips runtime without changing native values on %s", async operation => {
    const other = configuredAlertFixture({ id: "window", name: "Window" });
    const config = { version: 1, alerts: [alert, other] };
    const panel = mountPanel({}, { "ha_notifications/get_config": config });
    await ready(panel);
    const options = await openPanelEditor(panel);
    const draft = editorAlertFixture({ id: alert.id, runtime: { current: 2 } });
    draft.confirmation!.reminders.interval = { minutes: 30 };
    draft.confirmation!.reminders.timeout = "00:15:00";
    draft.notification.options = { tag: "{{ trigger.entity_id }}", data: { ttl: 0 } };
    const original = structuredClone(draft);
    const { runtime: _runtime, ...canonical } = structuredClone(draft);
    canonical.confirmation!.reminders.interval = 1800;
    canonical.confirmation!.reminders.timeout = 900;

    if (operation === "save") {
      await expect(options.onSave(draft)).resolves.toEqual(canonical);
    } else {
      await expect(options.onValidateAlert(draft)).resolves.toEqual({ valid: true });
    }

    const endpoint = operation === "save" ? "save_config" : "validate_config";
    expect(messages(endpoint)).toEqual([{
      type: `ha_notifications/${endpoint}`,
      config: { ...config, alerts: [canonical, other] },
    }]);
    expect(messages(operation === "save" ? "validate_config" : "save_config")).toHaveLength(0);
    expect(draft).toEqual(original);
    expect(messages(endpoint)[0].config!.alerts[0]).not.toHaveProperty("runtime");
  });

  it.each(["", undefined, 42])("rejects an invalid alert id %s before transport", async id => {
    const panel = mountPanel();
    await ready(panel);
    const options = await openPanelEditor(panel, true);
    const draft = editorAlertFixture({ id: id as string });
    sendMessagePromise.mockClear();

    await expect(options.onSave(draft)).rejects.toThrow(
      "ha_notifications/save_config: alert.id is required.",
    );

    expect(sendMessagePromise).not.toHaveBeenCalled();
  });

  it("reports a missing saved alert without announcing success", async () => {
    const panel = mountPanel({}, {
      "ha_notifications/save_config": { saved: true, config: { version: 1, alerts: [] } },
    });
    await ready(panel);
    const options = await openPanelEditor(panel);
    const notification = vi.fn();
    panel.addEventListener("hass-notification", notification);

    await expect(options.onSave(alert)).rejects.toThrow(
      `ha_notifications/save_config: saved alert ${alert.id} was not returned.`,
    );

    expect(messages("save_config")).toHaveLength(1);
    expect(notification).not.toHaveBeenCalled();
  });

  it("reports missing deletion without saving configuration", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const responses: Record<string, unknown> = {};
    const panel = mountPanel({}, responses);
    await ready(panel);
    responses["ha_notifications/get_config"] = { version: 1, alerts: [] };
    const notification = vi.fn();
    panel.addEventListener("hass-notification", notification);

    menuAction(panel, "Delete alert");

    await vi.waitFor(() => expect(notification).toHaveBeenCalledOnce());
    expect((notification.mock.calls[0][0] as CustomEvent).detail).toEqual({
      message: `ha_notifications/save_config: alert ${alert.id} was not found.`,
    });
    expect(messages("get_config")).toHaveLength(2);
    expect(messages("save_config")).toHaveLength(0);
    expect(panel.shadowRoot.querySelector(".nc-alert-name")?.textContent).toBe(alert.name);
  });

  it("deletes an alert while preserving other configuration entries", async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirm);
    const other = configuredAlertFixture({ id: "window", name: "Window" });
    const config = { version: 7, alerts: [alert, other], metadata: { source: "dashboard" } };
    const responses: Record<string, unknown> = { "ha_notifications/get_config": config };
    const panel = mountPanel({}, responses);
    await ready(panel);
    const notification = vi.fn();
    panel.addEventListener("hass-notification", notification);

    menuAction(panel, "Delete alert");

    expect(confirm).toHaveBeenCalledExactlyOnceWith(`Delete "${alert.name}"?`);
    await vi.waitFor(() => expect(messages("save_config")).toEqual([{
      type: "ha_notifications/save_config", config: { ...config, alerts: [other] },
    }]));
    await vi.waitFor(() => expect(notification).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(
      [...panel.shadowRoot.querySelectorAll(".nc-alert-name")].map(row => row.textContent),
    ).toEqual([other.name]));
    expect(config.alerts).toEqual([alert, other]);
    expect(messages("delete")).toHaveLength(0);
  });

  it.each([{}, null, [], { alerts: {} }].map(malformed => [malformed]))("keeps dashboard rows when refreshed configuration is malformed: %j", async malformed => {
    const responses: Record<string, unknown> = {};
    const panel = mountPanel({}, responses);
    await ready(panel);
    responses["ha_notifications/get_config"] = malformed;
    const notification = vi.fn();
    panel.addEventListener("hass-notification", notification);

    await panel.refresh();
    await settleElement(panel);

    expect(panel.shadowRoot.querySelectorAll(".nc-alert")).toHaveLength(1);
    expect(panel.shadowRoot.querySelector(".nc-alert-name")?.textContent).toBe(alert.name);
    expect(notification).toHaveBeenCalledOnce();
    expect((notification.mock.calls[0][0] as CustomEvent).detail).toEqual({
      message: "ha_notifications/get_config: expected canonical configuration with an alerts array.",
    });
  });

  it("passes only active human users to the editor recipient selectors", async () => {
    const panel = mountPanel({}, {
      "config/auth/list": [
        { id: "admin", name: "Admin" },
        { id: "inactive", name: "Inactive", is_active: false },
        { id: "system", name: "System", system_generated: true },
        { id: "operator", name: "Operator", is_active: true },
      ],
    });
    await ready(panel);

    const options = await openPanelEditor(panel);

    expect(options.users).toEqual([
      { value: "admin", label: "Admin" },
      { value: "operator", label: "Operator" },
    ]);
    expect(messages("config/auth/list")).toEqual([{ type: "config/auth/list" }]);
  });
});