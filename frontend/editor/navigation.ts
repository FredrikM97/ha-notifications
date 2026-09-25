import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import type { Alert } from "../types.js";
import {
  editorSections,
  type EditorSection,
  type OptionalSetting,
  type OptionalSettings,
  type SectionStatus,
} from "./types.js";
import { enabledLabel, isSectionVisible } from "./helpers.js";

export interface EditorNavigationOptions {
  alert: Alert;
  className: string;
  optionalSettings: OptionalSettings;
  activeIndex: number;
  mobileOpen: boolean;
  collapsedParents: Set<string>;
  onMobileMenuReady(element: HTMLElement): void;
  onSelect(index: number): void;
  onToggleChildren(parent: string): void;
}

function statusEnabled(alert: Alert, status: SectionStatus): boolean {
  if (status === "postSendActions") {
    return Boolean(alert.post_send_actions?.enabled);
  }
  if (status === "confirmation") {
    return Boolean(alert.confirmation?.enabled);
  }
  if (status === "postConfirmationActions") {
    return Boolean(
      alert.confirmation?.enabled && alert.confirmation.actions.enabled,
    );
  }
  if (status === "confirmationReminder") {
    return Boolean(
      alert.confirmation?.enabled && alert.confirmation.reminders.enabled,
    );
  }
  return Boolean(
    alert.confirmation?.enabled && alert.confirmation.notification.enabled,
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

export function renderEditorNavigation({
  alert,
  className,
  optionalSettings,
  activeIndex,
  mobileOpen,
  collapsedParents,
  onMobileMenuReady,
  onSelect,
  onToggleChildren,
}: EditorNavigationOptions) {
  const isMobile = className.includes("mobile");
  return html`<nav
    ${isMobile
      ? ref((element) => {
          if (element) onMobileMenuReady(element as HTMLElement);
        })
      : nothing}
    class=${`${className}${mobileOpen ? " mobile-open" : ""}`}
    aria-label="Alert sections"
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
        ?hidden=${!isSectionVisible(setting, optionalSettings) ||
        (parent === "Confirmation" && !optionalSettings.confirmation)}
      >
        <button
          class=${buttonClass(setting, parent, index, activeIndex)}
          aria-current=${index === activeIndex ? "step" : nothing}
          @click=${() => onSelect(index)}
        >
          ${statusTemplate(alert, status)}
          <span>${title}</span>
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
