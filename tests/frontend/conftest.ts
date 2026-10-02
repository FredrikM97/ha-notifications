import { vi } from "vitest";
import { within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { render } from "lit";
import type { TemplateResult } from "lit";
import type {
  Alert,
  Hass,
  Registries,
  RuntimeAlertHistoryEntry,
} from "../../frontend/types.js";
import type { AlertFormValues } from "../../frontend/alert-payload.js";
import { defaultAlert } from "../../frontend/editor/alert-defaults.js";
import alertFixtureData from "./fixtures/alerts.json";
import alertFormValuesData from "./fixtures/alert-form-values.json";
import fixtureData from "./fixtures/history.json";
import registriesFixtureData from "./fixtures/registries.json";

export const historyFixture = fixtureData.history as RuntimeAlertHistoryEntry[];
export const emptyHistoryFilters = fixtureData.emptyFilters;
export const configFixture = alertFixtureData.config as Record<string, unknown>;
export function createHassClient() {
  const sendMessagePromise = vi.fn().mockResolvedValue({});
  return {
    hass: { connection: { sendMessagePromise } } as Hass,
    sendMessagePromise,
  };
}

export function homeAssistantFixture(overrides: Partial<Hass> = {}): Hass {
  return {
    user: { is_admin: true },
    locale: { language: "en", date_format: "YMD", time_format: "24" },
    connection: { sendMessagePromise: vi.fn() },
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

export function draftAlertFixture(overrides: Partial<Alert> = {}): Alert {
  const alert = defaultAlert();
  return {
    ...alert,
    ...overrides,
    notification: {
      ...alert.notification,
      ...overrides.notification,
    },
  };
}

export function populatedRegistries(overrides: Partial<Registries> = {}): Registries {
  return {
    ...(structuredClone(registriesFixtureData) as Registries),
    ...overrides,
  };
}

export function alertFormValues(
  overrides: Partial<AlertFormValues> = {},
): AlertFormValues {
  return {
    ...(alertFormValuesData as AlertFormValues),
    ...overrides,
  };
}

export function alertFormValuesWithRecipients(
  overrides: Partial<AlertFormValues> = {},
  entityIds = ["notify.mobile_app_phone"],
): AlertFormValues {
  const values = alertFormValues(overrides);
  return {
    ...values,
    notification: {
      ...values.notification,
      target: { entity_id: entityIds },
    },
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
      codemirror = { dom: document.createElement("div") };

      constructor() {
        super();
        const scroller = document.createElement("div");
        scroller.className = "cm-scroller";
        this.codemirror.dom.append(scroller);
      }
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

export function cleanupTestDom(): void {
  document.body.replaceChildren();
}

export function alertCardRoots(root: ParentNode): ShadowRoot[] {
  const cardRoots = [...root.querySelectorAll("ha-notifications-alert-card")]
    .map((card) => card.shadowRoot)
    .filter((shadowRoot): shadowRoot is ShadowRoot => shadowRoot !== null);
  const nestedRoots = [...root.querySelectorAll("*")]
    .map((element) => element.shadowRoot)
    .filter((shadowRoot): shadowRoot is ShadowRoot => shadowRoot !== null)
    .flatMap((shadowRoot) => alertCardRoots(shadowRoot));
  return [...cardRoots, ...nestedRoots];
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

export async function settleLitTree(root: ParentNode): Promise<void> {
  for (let pass = 0; pass < 5; pass += 1) {
    const updates: Promise<unknown>[] = [];
    const collect = (container: ParentNode): void => {
      for (const element of container.querySelectorAll("*")) {
        const component = element as HTMLElement & {
          updateComplete?: Promise<unknown>;
          shadowRoot?: ShadowRoot | null;
        };
        if (component.updateComplete) updates.push(component.updateComplete);
        if (component.shadowRoot) collect(component.shadowRoot);
      }
    };
    collect(root);
    if (updates.length === 0) return;
    await Promise.all(updates);
    await Promise.resolve();
  }
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

export async function settleEditorNavigation(root: ShadowRoot): Promise<void> {
  const navigations = root.querySelectorAll(
    "ha-notifications-editor-navigation",
  ) as NodeListOf<HTMLElement & { updateComplete?: Promise<unknown> }>;
  await Promise.all(
    [...navigations].map((navigation) => navigation.updateComplete),
  );
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
    onValidateAlert: vi.fn().mockResolvedValue({}),
    onSaved: vi.fn().mockResolvedValue(undefined),
    onClosed: vi.fn(),
  };
}
