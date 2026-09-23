import { vi } from "vitest";
import { within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { render } from "lit";
import type { TemplateResult } from "lit";
import type {
  Alert,
  Hass,
  Registries,
  RuntimeAlertState,
} from "../../frontend/types.js";
import type { AlertFormValues } from "../../frontend/alert-payload.js";
import { defaultAlert } from "../../frontend/editor/helpers.js";
import alertFixtureData from "./fixtures/alerts.json";
import alertFormValuesData from "./fixtures/alert-form-values.json";
import fixtureData from "./fixtures/history.json";
import registriesFixtureData from "./fixtures/registries.json";

export const historyFixture = fixtureData.history as RuntimeAlertState[];
export const emptyHistoryFilters = fixtureData.emptyFilters;
export const alertRuntimeFixture = alertFixtureData.runtime as Record<
  string,
  RuntimeAlertState
>;
export const configFixture = alertFixtureData.config as Record<string, unknown>;
export const previewSessionResultFixture = alertFixtureData.draftTestResult as {
  session_id: string;
};

export function createHassClient() {
  const sendMessagePromise = vi.fn().mockResolvedValue({});
  return {
    hass: { connection: { sendMessagePromise } } as Hass,
    sendMessagePromise,
  };
}

export function alertFixture(): Alert {
  return { id: "door", name: "Door" } as Alert;
}

export function configuredAlertFixture(): Alert {
  return structuredClone(alertFixtureData.alert) as Alert;
}

export function editorAlertFixture(): Alert {
  return structuredClone(alertFixtureData.editorAlert) as Alert;
}

export function populatedRegistries(): Registries {
  return structuredClone(registriesFixtureData) as Registries;
}

export function alertFormValues(
  overrides: Partial<AlertFormValues> = {},
): AlertFormValues {
  return {
    ...(alertFormValuesData as AlertFormValues),
    ...overrides,
  };
}

export function emptyRegistries(): Registries {
  return {
    entities: [],
    devices: [],
    areas: [],
    labels: [],
    floors: [],
    users: [],
  };
}

export function installHaTestElements(): void {
  if (!customElements.get("ha-code-editor")) {
    class HaCodeEditor extends HTMLElement {
      value = "";
      updateComplete = Promise.resolve();
    }
    customElements.define("ha-code-editor", HaCodeEditor);
  }
}

export function stableMarkup(element: Element | null): string | undefined {
  return element?.outerHTML.replace(/<!--.*?-->/g, "");
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
  root.innerHTML = `
    <div class="nc-page">
      <div class="nc-alerts"></div>
      <div class="nc-tabs"></div>
      <div class="nc-actions"></div>
    </div>`;
  document.body.append(host);
  return root;
}

export function domQueries(container: Element | DocumentFragment) {
  return within(container);
}

export function testUser() {
  return userEvent.setup();
}

export function editorQueries(root: ShadowRoot) {
  return domQueries(root);
}

export function editorOptions(
  root: ShadowRoot,
  alert: Alert = defaultAlert(),
  registries = emptyRegistries(),
) {
  return {
    root,
    hass: createHassClient().hass,
    alert,
    registries,
    onSave: vi.fn().mockResolvedValue(alert),
    onTest: vi.fn().mockResolvedValue({ session_id: "session" }),
    onValidateCondition: vi.fn().mockResolvedValue({}),
    onSaved: vi.fn().mockResolvedValue(undefined),
    onClosed: vi.fn(),
  };
}
