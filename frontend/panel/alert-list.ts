import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { button, buttonStyles } from "../components/button.js";
import { localize } from "../localize.js";
import type { AlertActionItem, AlertActionRequest } from "./alert-card/actions.js";
import "./alert-card.js";
import type {
  Alert,
  AutomationRuntimeStatus,
  Hass,
} from "../types.js";

export const alertListStyles = css`
  :host {
    display: block;
    min-width: 0;
  }

  .nc-alerts {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .nc-empty {
    padding: 55px 20px;
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
    color: var(--secondary-text-color);
    text-align: center;
  }

  .nc-empty h2 {
    color: var(--primary-text-color);
  }
`;

class AlertList extends LitElement {
  static properties = {
    alerts: { attribute: false },
    actionItems: { attribute: false },
    automationStatus: { attribute: false },
    emptyAction: { attribute: false },
    hass: { attribute: false },
    activeOnly: { type: Boolean },
  };

  static styles = [buttonStyles, alertListStyles];

  declare alerts: Alert[];
  declare actionItems: (
    alert: Alert,
    status: AutomationRuntimeStatus | undefined,
  ) => AlertActionItem[];
  declare automationStatus: Record<string, AutomationRuntimeStatus>;
  declare emptyAction: AlertActionItem | undefined;
  declare hass: Hass | null;
  declare activeOnly: boolean;

  protected render(): TemplateResult {
    const alerts = this.activeOnly
      ? this.alerts.filter((alert) => {
          const status = this.automationStatus[alert.id];
          return status?.current > 0;
        })
      : this.alerts;

    if (!alerts.length) {
      return this.emptyState();
    }

    return html`<div class="nc-alerts">
      ${alerts.map(
        (alert) => html`<ha-notifications-alert-card
          .alert=${alert}
          .actions=${this.actionItems?.(alert, this.automationStatus[alert.id]) || []}
          .hass=${this.hass}
          .automationStatus=${this.automationStatus[alert.id]}
        ></ha-notifications-alert-card>`,
      )}
    </div>`;
  }

  private emptyState(): TemplateResult {
    const title = this.activeOnly
      ? "panel.no_active_alerts"
      : "panel.no_alerts";
    const emptyAction = this.emptyAction;

    return html`<div class="nc-empty">
      <h2>${localize(this.hass, title)}</h2>
      ${this.activeOnly ? nothing : html`<p>${localize(this.hass, "panel.create_first")}</p>`}
      ${this.activeOnly || !emptyAction
        ? nothing
        : button({
            label: emptyAction.label,
            onClick: () => this.dispatchAction(emptyAction.id),
          })}
    </div>`;
  }

  private dispatchAction(actionId: string, alert?: Alert): void {
    this.dispatchEvent(
      new CustomEvent<AlertActionRequest>("alert-action", {
        detail: { actionId, alert },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("ha-notifications-alert-list")) {
  customElements.define("ha-notifications-alert-list", AlertList);
}