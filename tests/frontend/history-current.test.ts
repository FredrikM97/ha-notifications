// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  emptyHistoryFilters,
  filterHistoryEntries,
  groupHistoryEntries,
  historyDetailSummary,
  historyStartedBySummary,
} from "../../frontend/views/history.js";
import {
  cleanupTestDom,
  historyFixture,
  homeAssistantFixture,
  mountCustomElement,
  settleElement,
} from "./conftest.js";

const VIEW_SETTINGS_KEY = "ha_notifications.history_view";

afterEach(() => {
  cleanupTestDom();
  localStorage.removeItem(VIEW_SETTINGS_KEY);
});

function mountHistory(
  history = historyFixture,
  properties: Record<string, unknown> = {},
): HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> } {
  return mountCustomElement("ha-notifications-history-view", {
    hass: homeAssistantFixture(),
    history,
    alerts: [
      { id: "garage", name: "Garage door" },
      { id: "water", name: "Water leak" },
    ],
    alertName: null,
    ...properties,
  });
}

describe("history helpers", () => {
  it("filters by alert, event, severity, and detail text", () => {
    const filters = { ...emptyHistoryFilters(), search: "device" };
    expect(filterHistoryEntries(historyFixture, filters).map(({ config }) => config?.id)).toEqual(["water"]);
    expect(filterHistoryEntries(historyFixture, {
      ...emptyHistoryFilters(), alertId: "garage", type: "notification_sent", severity: "success",
    })).toEqual([historyFixture[0]]);
  });

  it("groups events by flow while keeping standalone events separate", () => {
    const second = {
      ...historyFixture[0],
      event: { ...historyFixture[0].event, event_id: "event_garage_2" },
    };
    expect(groupHistoryEntries([historyFixture[0], second, historyFixture[1]])).toEqual([
      { flowId: "flow_garage", entries: [historyFixture[0], second] },
      { entries: [historyFixture[1]] },
    ]);
  });

  it("keeps useful detail summaries and hides retry-only details", () => {
    expect(historyDetailSummary({ attempt: 2 })).toBe("");
    expect(historyDetailSummary({ error: "Device unavailable" })).toBe("Device unavailable");
    expect(historyDetailSummary({ source: "sensor" })).toBe("Source: sensor");
  });

  it("summarizes state and event trigger origins", () => {
    expect(historyStartedBySummary({ started_by: {
      platform: "state", entity_id: "input_boolean.alert_button", from_state: "off", to_state: "on",
    } })).toBe("input_boolean.alert_button (off -> on)");
    expect(historyStartedBySummary({ started_by: {
      platform: "homeassistant", event_type: "homeassistant_started",
    } })).toBe("homeassistant event homeassistant_started");
  });
});

describe("history view", () => {
  it("filters visible rows as the search input changes", async () => {
    const view = mountHistory();
    await settleElement(view);
    const search = view.shadowRoot.querySelector("ha-input") as HTMLElement & { value: string };

    search.value = "device";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settleElement(view);

    expect(view.shadowRoot.querySelectorAll(".nc-item")).toHaveLength(1);
    expect(view.shadowRoot.querySelector(".nc-item-title")?.textContent).toContain("Water leak");
  });

  it("shows trigger and confirmation reason summaries", async () => {
    const entry = {
      ...historyFixture[0],
      event: {
        ...historyFixture[0].event,
        details: {
          reason: "confirmation_notification",
          started_by: {
            platform: "state",
            entity_id: "input_boolean.alert_button",
            from_state: "off",
            to_state: "on",
          },
        },
      },
    };
    const view = mountHistory([entry]);
    await settleElement(view);

    const summary = view.shadowRoot.querySelector(".nc-item > .nc-muted")?.textContent;
    expect(summary).toContain("Started by input_boolean.alert_button (off -> on)");
    expect(summary).toContain("Reason: Confirmation notification");
  });

  it("emits alert selection from the current row link", async () => {
    const view = mountHistory();
    await settleElement(view);
    let selected: unknown;
    view.addEventListener("history-alert-selected", (event) => {
      selected = (event as CustomEvent).detail;
    });

    view.shadowRoot.querySelector<HTMLButtonElement>(".nc-link")!.click();

    expect(selected).toEqual({ alertId: "garage", alertName: "Garage door" });
  });

  it("preserves selector configuration identity across filter updates", async () => {
    localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify({ showFilters: true }));
    const view = mountHistory();
    await settleElement(view);
    const selectors = [...view.shadowRoot.querySelectorAll<HTMLElement & { selector: object }>("ha-selector")];
    const configs = selectors.map(({ selector }) => selector);

    const search = view.shadowRoot.querySelector("ha-input") as HTMLElement & { value: string };
    search.value = "garage";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settleElement(view);

    expect([...view.shadowRoot.querySelectorAll("ha-selector")]).toHaveLength(configs.length);
    selectors.forEach((selector, index) => expect(selector.selector).toBe(configs[index]));
  });

  it("groups flows when the saved view preference is enabled", async () => {
    localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify({ groupByFlow: true }));
    const second = {
      ...historyFixture[0],
      event: { ...historyFixture[0].event, event_id: "event_garage_2" },
    };
    const view = mountHistory([historyFixture[0], second]);
    await settleElement(view);

    expect(view.shadowRoot.querySelectorAll(".nc-flow")).toHaveLength(1);
    expect(view.shadowRoot.querySelectorAll(".nc-flow .nc-item")).toHaveLength(2);
    expect(view.shadowRoot.querySelector(".nc-flow > summary")?.textContent).toContain("Flow flow_garage");
  });

  it("shows an alert-scoped empty state and lets the panel return to all history", async () => {
    const view = mountHistory([], { alertName: "Garage door" });
    await settleElement(view);
    let showedAll = false;
    view.addEventListener("history-show-all", () => { showedAll = true; });

    expect(view.shadowRoot.textContent).toContain("Garage door");
    view.shadowRoot.querySelector("ha-button")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(showedAll).toBe(true);
  });
});