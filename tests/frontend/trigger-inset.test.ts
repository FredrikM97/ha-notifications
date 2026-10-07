// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { openEditor } from "../../frontend/editor/index.js";
import {
  cleanupTestDom,
  draftAlertFixture,
  editorRoot,
  homeAssistantFixture,
  mountCustomElement,
  settleElement,
} from "./conftest.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanupTestDom();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(): Promise<LitElement> {
  const root = editorRoot();
  openEditor({
    root,
    hass: homeAssistantFixture({
      connection: { sendMessagePromise: vi.fn().mockResolvedValue({ platforms: [], unknown: true }) } as never,
    }),
    alert: draftAlertFixture(),
    defaults: draftAlertFixture(),
    users: [],
    onSave: vi.fn(),
    onValidateAlert: vi.fn(),
  });
  const editor = root.querySelector<LitElement>("ha-notifications-alert-editor")!;
  await settleElement(editor);
  return editor;
}

function triggerEditor(): HTMLElement {
  const trigger = document.createElement("ha-automation-trigger-editor");
  const root = trigger.attachShadow({ mode: "open" });
  root.innerHTML = '<div class="card-content card"></div><div class="card-content card yaml"></div><div class="card-content sidebar"></div>';
  return trigger;
}

function insetStyles(trigger: HTMLElement): HTMLStyleElement[] {
  return [...trigger.shadowRoot!.querySelectorAll<HTMLStyleElement>("style[data-nc-trigger-inset]")];
}

describe("native trigger inset", () => {
  it("insets only trigger cards within this editor and keeps one rule across rerenders", async () => {
    const editor = await mount();
    const selector = mountCustomElement("ha-selector-trigger");
    const root = selector.attachShadow({ mode: "open" });
    const triggers = [triggerEditor(), triggerEditor()];
    root.append(...triggers);
    editor.shadowRoot!.querySelector("ha-form")!.append(selector);
    const outside = triggerEditor();
    document.body.append(outside);
    await vi.advanceTimersByTimeAsync(100);

    for (const trigger of triggers) {
      expect(insetStyles(trigger)).toHaveLength(1);
      expect(insetStyles(trigger)[0].textContent).toBe(
        ".card-content.card:not(.yaml) { padding: var(--ha-space-4, 16px); }",
      );
      const cards = [...trigger.shadowRoot!.querySelectorAll(".card-content")];
      expect(cards.map(card => card.matches(".card-content.card:not(.yaml)"))).toEqual([true, false, false]);
    }
    expect(insetStyles(outside)).toHaveLength(0);
    editor.requestUpdate();
    await settleElement(editor);
    await vi.advanceTimersByTimeAsync(100);
    for (const trigger of triggers) expect(insetStyles(trigger)).toHaveLength(1);
  });

  it("discovers late nested shadow roots and subsequently inserted trigger instances", async () => {
    const editor = await mount();
    const selector = document.createElement("ha-selector-trigger");
    editor.shadowRoot!.querySelector("ha-form")!.append(selector);
    await vi.advanceTimersByTimeAsync(100);
    const wrapper = document.createElement("div");
    selector.attachShadow({ mode: "open" }).append(wrapper);
    await vi.advanceTimersByTimeAsync(100);
    const trigger = document.createElement("ha-automation-trigger-editor");
    wrapper.attachShadow({ mode: "open" }).append(trigger);
    await vi.advanceTimersByTimeAsync(100);
    trigger.attachShadow({ mode: "open" }).innerHTML = '<div class="card-content card"></div>';
    await vi.advanceTimersByTimeAsync(100);
    expect(insetStyles(trigger)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2200);
    const inserted = triggerEditor();
    wrapper.shadowRoot!.append(inserted);
    await vi.advanceTimersByTimeAsync(0);
    expect(insetStyles(inserted)).toHaveLength(1);
    expect(insetStyles(trigger)).toHaveLength(1);
  });

  it.each(["trigger", "condition", "action"])("never sizes native %s code editors or styles non-trigger editors", async kind => {
    const editor = await mount();
    const selector = document.createElement(`ha-selector-${kind}`);
    const root = selector.attachShadow({ mode: "open" });
    const native = document.createElement(`ha-automation-${kind}-editor`);
    const nativeRoot = native.attachShadow({ mode: "open" });
    const existing = document.createElement("style");
    existing.textContent = ".card-content.card { padding: 16px; }";
    const code = document.createElement("ha-code-editor");
    const dom = document.createElement("div");
    const scrollDOM = document.createElement("div");
    const contentDOM = document.createElement("div");
    const gutter = document.createElement("div");
    gutter.className = "cm-gutters";
    dom.append(scrollDOM, contentDOM, gutter);
    for (const element of [dom, scrollDOM, contentDOM, gutter]) element.style.minHeight = "23px";
    const readView = vi.fn(() => ({ dom, scrollDOM, contentDOM }));
    Object.defineProperty(code, "codemirror", { get: readView });
    code.attachShadow({ mode: "open" }).append(dom);
    nativeRoot.append(existing, code);
    root.append(native);
    editor.shadowRoot!.querySelector("ha-form")!.append(selector);
    const before = nativeRoot.innerHTML;
    await vi.advanceTimersByTimeAsync(100);
    editor.requestUpdate();
    await settleElement(editor);
    await vi.advanceTimersByTimeAsync(100);

    expect(readView).not.toHaveBeenCalled();
    for (const element of [dom, scrollDOM, contentDOM, gutter]) expect(element.style.minHeight).toBe("23px");
    expect(existing.textContent).toBe(".card-content.card { padding: 16px; }");
    expect(code.shadowRoot!.querySelector("style")).toBeNull();
    expect(root.querySelector("style")).toBeNull();
    if (kind === "trigger") expect(insetStyles(native)).toHaveLength(1);
    else expect(nativeRoot.innerHTML).toBe(before);
  });
});