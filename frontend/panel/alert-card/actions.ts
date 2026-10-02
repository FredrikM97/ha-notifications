import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { button } from "../../components/button.js";
import type { ButtonVariant } from "../../components/button.js";
import type { Alert } from "../../types.js";

export interface AlertActionItem {
  id: string;
  label: string;
  icon?: string;
  variant?: ButtonVariant;
  href?: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

export interface AlertActionRequest {
  actionId: string;
  alert?: Alert;
}

export function alertActionsTemplate(
  actions: AlertActionItem[],
  alert: Alert,
  onAction: (actionId: string, alert: Alert) => void,
): TemplateResult {
  return html`${actions.map((action) =>
    action.href
      ? html`<a
          class=${`nc-button secondary ${action.className || ""}`.trim()}
          href=${action.href}
          title=${action.title ?? action.label}
          aria-label=${action.ariaLabel ?? action.label}
          >${action.icon
            ? html`<ha-icon icon=${action.icon} aria-hidden="true"></ha-icon>`
            : nothing}<span class="nc-button-label">${action.label}</span></a
        >`
      : button({
          label: action.label,
          variant: action.variant,
          icon: action.icon,
          title: action.title,
          ariaLabel: action.ariaLabel,
          onClick: () => onAction(action.id, alert),
        }),
  )}`;
}