import { vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render } from "lit";
import type { TemplateResult } from "lit";
import type { Alert, Hass, RuntimeAlertHistoryEntry } from "../../frontend/types.js";
import { editableAlert as toEditableAlert, type EditableAlert } from "../../frontend/editor/alert-model.js";
import alertDefaults from "../contracts/alert_defaults.json";
import alertFixtureData from "./fixtures/alerts.json";
import fixtureData from "./fixtures/history.json";

export const historyFixture = fixtureData.history as RuntimeAlertHistoryEntry[];
export const configFixture = alertFixtureData.config as Record<string, unknown>;
export function createHassClient() {
  const sendMessagePromise = vi.fn().mockResolvedValue({});
  const connection = { sendMessagePromise } as unknown as Hass["connection"];
  const callWS = vi.fn(<Response>(message: Record<string, unknown>): Promise<Response> =>
    connection.sendMessagePromise<Response>(message));
  return {
    hass: { connection, callWS } as Hass,
    sendMessagePromise,
    callWS,
  };
}

export function homeAssistantFixture(overrides: Partial<Hass> = {}): Hass {
  const connection = overrides.connection ?? createHassClient().hass.connection;
  return {
    user: { is_admin: true },
    locale: { language: "en", date_format: "YMD", time_format: "24" },
    connection,
    callWS: <Response>(message: Record<string, unknown>): Promise<Response> =>
      connection.sendMessagePromise<Response>(message),
    ...overrides,
  } as Hass;
}

export function alertFixture(overrides: Partial<Alert> = {}): Alert {
  return { id: "door", name: "Door", ...overrides } as Alert;
}

export function configuredAlertFixture(overrides: Partial<Alert> = {}): Alert {
  return {
    ...(structuredClone(alertFixtureData.alert) as Alert),
    ...overrides,
  };
}

export function editorAlertFixture(overrides: Partial<Alert> = {}): Alert {
  return {
    ...(structuredClone(alertFixtureData.editorAlert) as Alert),
    ...overrides,
  };
}

export function draftAlertFixture(overrides: Partial<Alert> = {}): EditableAlert {
  const alert = structuredClone(alertDefaults) as EditableAlert;
  return {
    ...alert,
    ...overrides,
    notification: {
      ...alert.notification,
      ...overrides.notification,
    },
  };
}

export function editableAlert(source: Alert | null | undefined): EditableAlert {
  return toEditableAlert(source, draftAlertFixture());
}

export function mountCustomElement<T extends HTMLElement>(
  tagName: string,
  properties: Record<string, unknown> = {},
): T {
  const element = document.createElement(tagName) as T;
  Object.assign(element, properties);
  document.body.append(element);
  return element;
}

export function cleanupTestDom(): void {
  document.body.replaceChildren();
}

export function renderTemplate(template: TemplateResult): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(template, container);
  return container;
}

export async function settleElement(element: HTMLElement): Promise<void> {
  const updateComplete = (element as HTMLElement & {
    updateComplete?: Promise<unknown>;
  }).updateComplete;
  if (updateComplete) {
    await updateComplete;
  }
  await Promise.resolve();
}

export function editorRoot(): ShadowRoot {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  const querySelector = root.querySelector.bind(root);
  const querySelectorAll = root.querySelectorAll.bind(root);
  const deepQuerySelectorAll = (
    container: ParentNode,
    selectors: string,
  ): Element[] => {
    const matches = [...container.querySelectorAll(selectors)];
    for (const element of container.querySelectorAll("*")) {
      const component = element as HTMLElement & {
        performUpdate?: () => void;
        shadowRoot?: ShadowRoot | null;
      };
      if (!component.shadowRoot) continue;
      component.performUpdate?.();
      matches.push(...deepQuerySelectorAll(component.shadowRoot, selectors));
    }
    return matches;
  };
  Object.defineProperties(root, {
    querySelector: {
      value: (selectors: string) => {
        const editorContent = querySelector(
          "ha-notifications-alert-editor",
        )?.shadowRoot;
        return (editorContent && deepQuerySelectorAll(editorContent, selectors)[0]) ||
          querySelector(selectors);
      },
    },
    querySelectorAll: {
      value: (selectors: string) => {
        const editorContent = querySelector(
          "ha-notifications-alert-editor",
        )?.shadowRoot;
        if (!editorContent) return querySelectorAll(selectors);
        return deepQuerySelectorAll(editorContent, selectors);
      },
    },
  });
  document.body.append(host);
  return root;
}

export function testUser() {
  return userEvent.setup();
}
