import { css, type LitElement } from "lit";

type Selector = Record<string, unknown>;

/** Selector kinds rendered by HA's native automation editors; every use shares this list. */
export const NATIVE_EDITOR_KINDS = ["trigger", "condition", "action"] as const;

export type NativeEditorKind = typeof NATIVE_EDITOR_KINDS[number];

// HA styles condition and action editors with this inset but omits it for triggers;
// applying HA's own rule to every native editor keeps all three identical.
const INSET = css`.card-content.card { padding: var(--ha-space-4, 16px); }`.styleSheet;

export function nativeEditorKind(selector: Selector): NativeEditorKind | undefined {
  return NATIVE_EDITOR_KINDS.find(kind => kind in selector);
}

/** Follow the native selector's fixed shadow path and adopt the shared inset once per editor. */
export async function insetNativeEditors(form: HTMLElement): Promise<void> {
  const kind = form.dataset.nativeEditor;
  if (!INSET || !kind) return;
  let hosts: Element[] = [form];
  for (const tag of ["ha-selector", `ha-selector-${kind}`, `ha-automation-${kind}`, `ha-automation-${kind}-row`, `ha-automation-${kind}-editor`]) {
    await Promise.all(hosts.map(host => (host as Partial<LitElement>).updateComplete));
    hosts = hosts.flatMap(host => [...(host.shadowRoot?.querySelectorAll(tag) ?? [])]);
  }
  await Promise.all(hosts.map(host => (host as Partial<LitElement>).updateComplete));
  for (const editor of hosts) {
    const root = editor.shadowRoot;
    if (root && !root.adoptedStyleSheets.includes(INSET)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, INSET];
  }
}
