/**
 * Generic UI built on Home Assistant's own elements, so every view follows HA's
 * look and responsive behaviour instead of custom styling.
 */
import { css, html, nothing } from "lit";
import { mdiCheckCircle, mdiCloseCircle } from "@mdi/js";
import type { ReactiveController, ReactiveControllerHost, TemplateResult } from "lit";

/** Shared styles for the helpers below, using HA theme variables only. */
export const uiStyles = css`
  :host {
    display: block;
  }

  .nc-toolbar {
    display: flex;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    min-height: 56px;
    padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px) var(--ha-space-1, 4px) var(--ha-space-4, 16px);
    border-bottom: 1px solid var(--divider-color);
  }

  .nc-toolbar-start {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--secondary-text-color);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nc-toolbar-start ha-input {
    display: block;
    width: 100%;
  }

  .nc-toolbar-start strong {
    color: var(--primary-text-color);
  }

  /* Filters reflow from one row to one column as the card narrows. */
  .nc-filters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--ha-space-2, 8px);
    padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
    border-bottom: 1px solid var(--divider-color);
  }

  .nc-empty {
    text-align: center;
  }

  .nc-empty .card-content {
    padding: var(--ha-space-12, 48px) var(--ha-space-4, 16px);
    color: var(--secondary-text-color);
  }

  .nc-empty h2 {
    color: var(--primary-text-color);
  }

  .nc-nav {
    display: grid;
    align-content: start;
    gap: var(--ha-space-1, 4px);
  }

  .nc-nav-item + .nc-nav-item:not(.nc-child) {
    margin-block-start: var(--ha-space-2, 8px);
  }

  .nc-nav-item {
    display: flex;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    border: 0;
    border-radius: var(--ha-border-radius-md, 8px);
    padding: var(--ha-space-3, 12px);
    background: none;
    color: var(--secondary-text-color);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .nc-nav-item:hover,
  .nc-nav-item.active {
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }

  .nc-nav-item.active {
    box-shadow: inset 3px 0 var(--primary-color);
  }

  .nc-child {
    padding-inline-start: var(--ha-space-8, 32px);
  }

  .nc-dot {
    display: inline-flex;
    flex: 0 0 16px;
    width: 16px;
    height: 16px;
    color: var(--error-color);
  }

  .nc-dot.on {
    color: var(--success-color);
  }
`;

/** HA's breakpoint for collapsing toolbars and side navigation. */
export const NARROW_WIDTH = 870;

/** Tracks whether the host is narrower than HA's breakpoint (works for panels and cards). */
export class NarrowController implements ReactiveController {
  narrow = false;
  private observer = new ResizeObserver(([entry]) => {
    const narrow = entry.contentRect.width < NARROW_WIDTH;
    if (narrow === this.narrow) return;
    this.narrow = narrow;
    this.host.requestUpdate();
  });

  constructor(private host: ReactiveControllerHost & Element) {
    host.addController(this);
  }

  hostConnected(): void {
    this.observer.observe(this.host);
  }

  hostDisconnected(): void {
    this.observer.disconnect();
  }
}

export interface Action {
  label: string;
  path: string;
  action: () => void;
  warning?: boolean;
  disabled?: boolean;
  tooltip?: string;
}

/** Icon actions that collapse into HA's ⋮ menu on narrow screens. */
export function actions(items: Action[], narrow: boolean): TemplateResult {
  return html`<ha-icon-overflow-menu .items=${items.map(item => ({
    ...item, tooltip: item.tooltip ?? item.label,
  }))} .narrow=${narrow}></ha-icon-overflow-menu>`;
}

/**
 * The one card toolbar every view uses: leading content (search, title or text),
 * icon actions that collapse on narrow screens, and an optional main button.
 */
export function toolbar(
  start: TemplateResult | string,
  items: Action[],
  narrow: boolean,
  primary?: TemplateResult,
): TemplateResult {
  return html`<div class="nc-toolbar">
    <div class="nc-toolbar-start">${start}</div>
    ${items.length ? actions(items, narrow) : nothing}
    ${primary ?? nothing}
  </div>`;
}

export interface SelectOption {
  value: string;
  label: string;
}

const selectConfigs = new Map<string, { key: string; config: object }>();

/** Stable ha-selector config; a new object each render makes HA rebuild the control. */
export function selectConfig(id: string, options: SelectOption[]): object {
  const key = JSON.stringify(options);
  const cached = selectConfigs.get(id);
  if (cached?.key === key) return cached.config;
  const config = { select: { mode: "dropdown", options } };
  selectConfigs.set(id, { key, config });
  return config;
}

export function haButton(
  label: string,
  onClick: () => void,
  options: { variant?: "brand" | "neutral" | "danger"; appearance?: string; disabled?: boolean; slot?: string } = {},
): TemplateResult {
  return html`<ha-button
    variant=${options.variant ?? "brand"}
    appearance=${options.appearance ?? "accent"}
    slot=${options.slot ?? nothing}
    ?disabled=${options.disabled ?? false}
    @click=${onClick}
    >${label}</ha-button
  >`;
}

export function emptyState(
  title: string,
  description = "",
  action?: { label: string; run: () => void },
): TemplateResult {
  return html`<ha-card class="nc-empty">
    <div class="card-content">
      <h2>${title}</h2>
      ${description ? html`<p>${description}</p>` : nothing}
      ${action ? haButton(action.label, action.run) : nothing}
    </div>
  </ha-card>`;
}

/** Show HA's snackbar; works from anywhere inside the HA DOM. */
export function notify(from: Element, message: string): void {
  from.dispatchEvent(
    new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }),
  );
}

export interface NavItem {
  key: string;
  label: string;
  child?: boolean;
  /** Undefined hides the status dot. */
  status?: boolean;
}

/** One navigation model: a side list on wide screens, a dropdown on narrow ones. */
export function navMenu(
  items: NavItem[],
  active: string,
  onSelect: (key: string) => void,
  narrow: boolean,
  label: string,
  statusLabels = { on: "Enabled", off: "Disabled" },
): TemplateResult {
  const dot = (item: NavItem, slot?: string) => {
    if (item.status === undefined) return nothing;
    return html`<ha-svg-icon
          class="nc-dot ${item.status ? "on" : ""}"
          .path=${item.status ? mdiCheckCircle : mdiCloseCircle}
          slot=${slot ?? nothing}
          role="img"
          aria-label=${item.status ? statusLabels.on : statusLabels.off}
        ></ha-svg-icon>`;
  };
  if (narrow) {
    const current = items.find((item) => item.key === active);
    return html`<ha-dropdown
      class="nc-nav-dropdown"
      @wa-select=${(event: CustomEvent<{ item: { value: string } }>) => onSelect(event.detail.item.value)}
    >
      <ha-button slot="trigger" appearance="filled" variant="neutral" with-caret>
        ${current ? dot(current, "start") : nothing}
        ${current?.label ?? label}
      </ha-button>
      ${items.map(
        (item) => html`<ha-dropdown-item
          value=${item.key}
          class=${item.child ? "nc-child" : ""}
          ?selected=${item.key === active}
          >${dot(item, "icon")}${item.label}</ha-dropdown-item
        >`,
      )}
    </ha-dropdown>`;
  }
  return html`<nav class="nc-nav" aria-label=${label}>
    ${items.map(
      (item) => html`<button
        class="nc-nav-item ${item.child ? "nc-child" : ""} ${item.key === active ? "active" : ""}"
        aria-current=${item.key === active ? "page" : nothing}
        @click=${() => onSelect(item.key)}
      >
        ${dot(item)}<span>${item.label}</span>
      </button>`,
    )}
  </nav>`;
}
