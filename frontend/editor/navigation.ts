import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { buttonComponent as button } from "../components/button.js";
import type { Alert } from "../types.js";
import type { Localize } from "../localize.js";
import {
  editorSections,
  type EditorSection,
  type OptionalSetting,
  type SectionStatus,
} from "./types.js";
import { confirmationNotificationEnabled } from "./confirmation.js";
import { localizeEditorTitle } from "../localize.js";

export function enabledLabel(enabled: boolean): string {
  return enabled ? "Enabled" : "Disabled";
}

export const editorNavigationStyles = css`
  :host([mode="desktop"]) {
    grid-area: sidebar;
    display: block;
    min-width: 0;
  }

  :host([mode="mobile"]) {
    display: block;
  }

  .nc-section-header {
    position: sticky;
    top: 0;
    z-index: 15;
    align-self: start;
    display: grid;
    gap: 2px;
    padding: 4px 0 4px 14px;
    border-left: 1px solid var(--divider-color);
    background: transparent;
  }

  .nc-mobile-section-menu {
    display: none;
  }

  .nc-section-nav-row {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .nc-section-header .nc-section-nav-button {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    gap: 7px;
    border: 0;
    border-radius: 9px;
    padding: 10px 12px;
    background: transparent;
    color: var(--secondary-text-color);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  .nc-section-header .nc-section-nav-button > span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nc-section-header .nc-section-nav-button:hover {
    background: var(--primary-background-color);
    color: var(--primary-text-color);
  }

  .nc-section-header .nc-section-nav-button.active {
    border-left: 3px solid var(--primary-color);
    padding-left: 9px;
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
    box-shadow: none;
  }

  .nc-section-header .nc-section-nav-button.nc-section-nav-child {
    width: calc(100% - 12px);
    margin-left: 12px;
    font-size: 12px;
  }

  .nc-section-collapse-button {
    display: inline-grid;
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    padding: 0;
    background: transparent;
    color: var(--secondary-text-color);
    cursor: pointer;
  }

  .nc-section-collapse-button:hover {
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }

  .nc-section-collapse-button ha-icon {
    --mdc-icon-size: 18px;
  }

  .nc-section-header .nc-section-status {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    background: var(--error-color);
  }

  .nc-section-header .nc-section-status.active {
    background: var(--success-color, #4caf50);
  }

  .nc-section-status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(244, 67, 54, 0.12);
    color: var(--error-color);
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
  }

  .nc-section-status.active {
    background: rgba(76, 175, 80, 0.14);
    color: var(--success-color, #4caf50);
  }

  @container (max-width: 700px) {
    :host([mode="desktop"]) {
      display: none;
    }

    .nc-section-header:not(.nc-mobile-section-menu) {
      display: none;
    }

    .nc-mobile-section-menu {
      display: none;
      position: absolute;
      top: calc(100% - 8px);
      right: 16px;
      z-index: 110;
      width: min(300px, calc(100% - 32px));
      gap: 2px;
      padding: 8px;
      border: 1px solid var(--divider-color);
      border-radius: 10px;
      background: var(--card-background-color);
      box-shadow: var(--ha-box-shadow);
    }

    .nc-mobile-section-menu.mobile-open {
      display: grid;
    }
  }

  @media (max-width: 700px) {
    :host([mode="desktop"]) {
      display: none;
    }

    .nc-section-header:not(.nc-mobile-section-menu) {
      display: none;
    }

    .nc-mobile-section-menu {
      display: none;
      position: absolute;
      top: calc(100% - 8px);
      right: 16px;
      z-index: 110;
      width: min(300px, calc(100% - 32px));
      gap: 2px;
      padding: 8px;
      border: 1px solid var(--divider-color);
      border-radius: 10px;
      background: var(--card-background-color);
      box-shadow: var(--ha-box-shadow);
    }

    .nc-mobile-section-menu.mobile-open {
      display: grid;
    }
  }
`;

const NAVIGATION_TAG = "ha-notifications-editor-navigation";

class EditorNavigationView extends LitElement {
  static properties = {
    mode: { type: String, reflect: true },
    content: { attribute: false },
  };

  static styles = editorNavigationStyles;

  declare mode: "desktop" | "mobile";
  declare content: TemplateResult | typeof nothing;

  constructor() {
    super();
    this.mode = "desktop";
    this.content = nothing;
  }

  protected render(): TemplateResult | typeof nothing {
    return this.content;
  }
}

if (!customElements.get(NAVIGATION_TAG)) {
  customElements.define(NAVIGATION_TAG, EditorNavigationView);
}

type NavigationRenderOptions = {
  localize: Localize;
  alert: Alert;
  className: string;
  activeIndex: number;
  mobileOpen: boolean;
  collapsedParents: Set<string>;
  onMobileMenuReady(element: HTMLElement): void;
  onSelect(index: number): void;
  onToggleChildren(parent: string): void;
};

function statusEnabled(alert: Alert, status: SectionStatus): boolean {
  if (status === "postSendActions") {
    return Boolean(alert.post_send_actions?.enabled);
  }
  if (status === "confirmation") {
    return Boolean(alert.confirmation?.enabled);
  }
  if (status === "postConfirmationActions") {
    return Boolean(
      alert.confirmation?.enabled && alert.confirmation.actions.length > 0,
    );
  }
  if (status === "confirmationReminder") {
    return Boolean(
      alert.confirmation?.enabled && alert.confirmation.reminders.enabled,
    );
  }
  return Boolean(
    alert.confirmation?.enabled &&
      confirmationNotificationEnabled(alert.confirmation.notification),
  );
}

function statusTemplate(alert: Alert, status: SectionStatus | undefined) {
  if (!status) {
    return nothing;
  }

  const enabled = statusEnabled(alert, status);
  return html`<span
    class=${`nc-section-status${enabled ? " active" : ""}`}
    data-status=${status}
    aria-label=${enabledLabel(enabled)}
    >${enabled ? "✓" : "×"}</span
  >`;
}

function buttonClass(
  setting: OptionalSetting | undefined,
  parent: string | undefined,
  index: number,
  activeIndex: number,
): string {
  const classes = ["nc-section-nav-button"];
  if (setting) {
    classes.push("nc-optional-setting");
  }
  if (parent) {
    classes.push("nc-section-nav-child");
  }
  if (index === activeIndex) {
    classes.push("active");
  }
  return classes.join(" ");
}

function collapseButton(
  hasChildren: boolean,
  title: string,
  collapsedParents: Set<string>,
  onToggleChildren: (parent: string) => void,
) {
  if (!hasChildren) {
    return nothing;
  }

  const collapsed = collapsedParents.has(title);
  const action = collapsed ? "Expand" : "Collapse";
  const icon = collapsed ? "mdi:chevron-right" : "mdi:chevron-down";
  const label = `${action} ${title} subpanels`;
  return html`<button
    class="nc-section-collapse-button"
    type="button"
    aria-label=${label}
    title=${label}
    aria-expanded=${String(!collapsed)}
    data-collapse-parent=${title}
    @click=${() => onToggleChildren(title)}
  >
    <ha-icon icon=${icon}></ha-icon>
  </button>`;
}

function renderNavigation({
  localize,
  alert,
  className,
  activeIndex,
  mobileOpen,
  collapsedParents,
  onMobileMenuReady,
  onSelect,
  onToggleChildren,
}: NavigationRenderOptions) {
  const isMobile = className.includes("mobile");
  return html`<nav
    ${isMobile
      ? ref((element) => {
          if (element) onMobileMenuReady(element as HTMLElement);
        })
      : nothing}
    class=${`${className}${mobileOpen ? " mobile-open" : ""}`}
    aria-label=${localize("editor.common.alert_sections")}
  >
    ${editorSections.map((section: EditorSection, index) => {
      const { title, setting, parent, status } = section;
      const hasChildren = editorSections.some(
        (candidate) => candidate.parent === title,
      );
      return html`<div
        class="nc-section-nav-row"
        data-setting=${setting || nothing}
        data-parent=${parent || nothing}
        ?hidden=${parent !== undefined && collapsedParents.has(parent)}
      >
        <button
          class=${buttonClass(setting, parent, index, activeIndex)}
          aria-current=${index === activeIndex ? "step" : nothing}
          @click=${() => onSelect(index)}
        >
          ${statusTemplate(alert, status)}
          <span>${localizeEditorTitle(localize, title)}</span>
        </button>
        ${collapseButton(
          hasChildren,
          title,
          collapsedParents,
          onToggleChildren,
        )}
      </div>`;
    })}
  </nav>`;
}

export class EditorNavigationController {
  private readonly collapsedParents = new Set<string>();
  private mobileOpen = false;
  private mobileMenu?: HTMLElement;
  private manageButton?: HTMLElement;

  constructor(
    private readonly onSelect: (index: number) => void,
    private readonly onChange: () => void,
  ) {
    document.addEventListener("pointerdown", this.handleOutsidePointer);
  }

  render(
    localize: Localize,
    alert: Alert,
    activeIndex: number,
    className = "nc-section-header",
  ) {
    const mobile = className.includes("mobile");
    const content = renderNavigation({
      localize,
      alert,
      className,
      activeIndex,
      mobileOpen: this.mobileOpen,
      collapsedParents: this.collapsedParents,
      onMobileMenuReady: (element) => {
        this.mobileMenu = element;
      },
      onSelect: this.select,
      onToggleChildren: this.toggleChildren,
    });
    return html`<ha-notifications-editor-navigation
      mode=${mobile ? "mobile" : "desktop"}
      .content=${content}
    ></ha-notifications-editor-navigation>`;
  }

  renderManageButton(localize: Localize) {
    const label = this.mobileOpen
      ? localize("editor.common.close_sections")
      : localize("editor.common.manage_sections");
    return button({
      label,
      variant: "secondary",
      icon: "mdi:menu",
      iconOnly: true,
      className: "nc-section-manage-button",
      ariaExpanded: String(this.mobileOpen),
      dataRole: "section-manage",
      onClick: this.toggleMobile,
      onReady: (element) => {
        this.manageButton = element;
      },
    });
  }

  dispose(): void {
    document.removeEventListener("pointerdown", this.handleOutsidePointer);
  }

  private select = (index: number): void => {
    this.mobileOpen = false;
    this.onSelect(index);
  };

  private toggleChildren = (parent: string): void => {
    if (this.collapsedParents.has(parent)) {
      this.collapsedParents.delete(parent);
    } else {
      this.collapsedParents.add(parent);
    }
    this.onChange();
  };

  private toggleMobile = (): void => {
    this.mobileOpen = !this.mobileOpen;
    this.onChange();
  };

  private closeMobile = (): void => {
    if (!this.mobileOpen) return;
    this.mobileOpen = false;
    this.onChange();
  };

  private handleOutsidePointer = (event: PointerEvent): void => {
    if (!this.mobileOpen) return;
    const path = event.composedPath();
    if (this.mobileMenu && path.includes(this.mobileMenu)) return;
    if (this.manageButton && path.includes(this.manageButton)) return;
    this.closeMobile();
  };
}
