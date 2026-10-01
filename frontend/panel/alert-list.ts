import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { buttonStyles } from "../components/button.js";
import { sharedStyles } from "../components/shared-styles.js";
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
    gap: 12px;
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

  static styles = [buttonStyles, sharedStyles, alertListStyles];

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
      ? this.alerts.filter((alert) => this.automationStatus[alert.id]?.current)
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

    return html`<div class="nc-card nc-empty">
      <h2>${localize(this.hass, title)}</h2>
      ${this.activeOnly ? nothing : html`<p>${localize(this.hass, "panel.create_first")}</p>`}
      ${this.activeOnly || !this.emptyAction
        ? nothing
        : html`<button class="nc-button" @click=${() => this.dispatchAction(this.emptyAction!.id)}>
            ${this.emptyAction.label}
          </button>`}
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