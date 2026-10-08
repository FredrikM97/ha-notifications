// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { openEditor } from "../../frontend/editor/index.js";
import {
  cleanupTestDom,
  draftAlertFixture,
  editorRoot,
  homeAssistantFixture,
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
      callWS: vi.fn().mockResolvedValue({ platforms: [], unknown: true }),
    }),
    alert: draftAlertFixture(),
    onSave: vi.fn(),
    onValidateAlert: vi.fn(),
  });
  const editor = root.querySelector<LitElement>("ha-notifications-alert-editor")!;
  await settleElement(editor);
  return editor;
}

function nativeEditor(kind: string): HTMLElement {
  const native = document.createElement(`ha-automation-${kind}-editor`);
  const root = native.attachShadow({ mode: "open" });
  root.innerHTML = '<div class="card-content card"></div><div class="card-content card yaml"></div><div class="card-content sidebar"></div>';
  return native;
}

describe("native trigger, condition, and action selector layout ownership", () => {
  it.each(["trigger", "condition", "action"])("leaves native %s shadow roots and outside instances unchanged across rerenders", async kind => {
    const editor = await mount();
    const selector = document.createElement(`ha-selector-${kind}`);
    const root = selector.attachShadow({ mode: "open" });
    const natives = [nativeEditor(kind), nativeEditor(kind)];
    root.append(...natives);
    editor.shadowRoot!.querySelector("ha-form")!.append(selector);
    const outside = nativeEditor(kind);
    document.body.append(outside);
    const roots = [root, ...natives.map(native => native.shadowRoot!), outside.shadowRoot!];
    const before = roots.map(root => root.innerHTML);
    await vi.advanceTimersByTimeAsync(100);

    expect(roots.map(root => root.innerHTML)).toEqual(before);
    editor.requestUpdate();
    await settleElement(editor);
    await vi.advanceTimersByTimeAsync(100);
    expect(roots.map(root => root.innerHTML)).toEqual(before);
  });

  it.each(["trigger", "condition", "action"])("leaves late nested %s roots and subsequently inserted instances under native ownership", async kind => {
    const editor = await mount();
    const selector = document.createElement(`ha-selector-${kind}`);
    editor.shadowRoot!.querySelector("ha-form")!.append(selector);
    await vi.advanceTimersByTimeAsync(100);
    const wrapper = document.createElement("div");
    selector.attachShadow({ mode: "open" }).append(wrapper);
    await vi.advanceTimersByTimeAsync(100);
    const native = document.createElement(`ha-automation-${kind}-editor`);
    wrapper.attachShadow({ mode: "open" }).append(native);
    await vi.advanceTimersByTimeAsync(100);
    native.attachShadow({ mode: "open" }).innerHTML = '<div class="card-content card"></div>';
    const before = native.shadowRoot!.innerHTML;
    await vi.advanceTimersByTimeAsync(100);
    expect(native.shadowRoot!.innerHTML).toBe(before);

    await vi.advanceTimersByTimeAsync(2200);
    const inserted = nativeEditor(kind);
    const insertedBefore = inserted.shadowRoot!.innerHTML;
    wrapper.shadowRoot!.append(inserted);
    await vi.advanceTimersByTimeAsync(0);
    expect(inserted.shadowRoot!.innerHTML).toBe(insertedBefore);
    expect(native.shadowRoot!.innerHTML).toBe(before);
    const roots = [selector.shadowRoot!, wrapper.shadowRoot!, native.shadowRoot!, inserted.shadowRoot!];
    const beforeRerender = roots.map(root => root.innerHTML);
    editor.requestUpdate();
    await settleElement(editor);
    await vi.advanceTimersByTimeAsync(100);
    expect(roots.map(root => root.innerHTML)).toEqual(beforeRerender);
  });

  it.each(["trigger", "condition", "action"])("never reads or writes native %s code editor internals", async kind => {
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
    const roots = [root, nativeRoot, code.shadowRoot!];
    const before = roots.map(root => root.innerHTML);
    await vi.advanceTimersByTimeAsync(100);
    editor.requestUpdate();
    await settleElement(editor);
    await vi.advanceTimersByTimeAsync(100);

    expect(readView).not.toHaveBeenCalled();
    for (const element of [dom, scrollDOM, contentDOM, gutter]) expect(element.style.minHeight).toBe("23px");
    expect(existing.textContent).toBe(".card-content.card { padding: 16px; }");
    expect(code.shadowRoot!.querySelector("style")).toBeNull();
    expect(root.querySelector("style")).toBeNull();
    expect(roots.map(root => root.innerHTML)).toEqual(before);
  });

  it("introduces no scanning observers, tree walkers, or retry timers on render or rerender", async () => {
    const observer = vi.spyOn(globalThis, "MutationObserver");
    const walker = vi.spyOn(document, "createTreeWalker");
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    const editor = await mount();
    const form = editor.shadowRoot!.querySelector("ha-form")!;
    for (const kind of ["trigger", "condition", "action"]) {
      const selector = document.createElement(`ha-selector-${kind}`);
      selector.attachShadow({ mode: "open" }).append(nativeEditor(kind));
      form.append(selector);
    }
    editor.requestUpdate();
    await settleElement(editor);
    vi.advanceTimersByTime(2500);
    await settleElement(editor);
    editor.remove();

    expect(observer).not.toHaveBeenCalled();
    expect(walker).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["triggers", "trigger"],
    ["conditions", "condition"],
    ["postSendActions", "action"],
  ])("gives the native %s editor the same shared content inset", async (section, kind) => {
    const editor = await mount();
    (editor as unknown as { selected: string }).selected = section;
    await settleElement(editor);
    const form = editor.shadowRoot!.querySelector(`ha-form[data-native-editor="${kind}"]`)!;
    let host: Element = form;
    for (const tag of ["ha-selector", `ha-selector-${kind}`, `ha-automation-${kind}`, `ha-automation-${kind}-row`]) {
      const child = document.createElement(tag);
      host.attachShadow({ mode: "open" }).append(child);
      host = child;
    }
    const native = nativeEditor(kind);
    host.attachShadow({ mode: "open" }).append(native);
    const before = native.shadowRoot!.innerHTML;

    for (let render = 0; render < 2; render++) {
      editor.requestUpdate();
      await settleElement(editor);
      await vi.advanceTimersByTimeAsync(0);
    }

    const sheets = native.shadowRoot!.adoptedStyleSheets;
    expect(sheets).toHaveLength(1);
    expect([...sheets[0].cssRules].map(rule => rule.cssText).join("")).toContain(".card-content.card");
    expect(native.shadowRoot!.innerHTML).toBe(before);
  });
});