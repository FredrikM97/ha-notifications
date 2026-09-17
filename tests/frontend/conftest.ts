import { vi } from "vitest";
import { within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import type { Alert, Hass, HistoryEntry, Registries } from "../../frontend/types.js";
import type { AlertFormValues } from "../../frontend/alert-payload.js";
import { defaultAlert } from "../../frontend/editor/helpers.js";
import alertFormValuesData from "./fixtures/alert-form-values.json";
import fixtureData from "./fixtures/history.json";

export const historyFixture = fixtureData.history as HistoryEntry[];
export const emptyHistoryFilters = fixtureData.emptyFilters;

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
    onDiscardTest: vi.fn().mockResolvedValue({}),
  };
}
