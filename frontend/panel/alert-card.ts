import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { buttonStyles } from "../components/button.js";
import { alertActionsTemplate } from "./alert-card/actions.js";
import type { AlertActionItem } from "./alert-card/actions.js";
import { alertStatusTemplate } from "./alert-card/status.js";
import type {
  Alert,
  AutomationRuntimeStatus,
  Hass,
} from "../types.js";

export const alertCardStyles = css`
  :host {
    display: block;
    min-width: 0;
    container-type: inline-size;
  }

  .nc-alert {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
  }

  .nc-alert-icon {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border-radius: 12px;
    background: var(--secondary-background-color);
    font-size: 21px;
  }

  .nc-alert-icon ha-icon {
    --mdc-icon-size: 24px;
  }

  .nc-alert-main {
    min-width: 0;
  }

  .nc-alert-name {
    font-size: 17px;
    font-weight: 700;
  }

  .nc-alert-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .nc-alert-meta {
    margin-top: 5px;
    color: var(--secondary-text-color);
    font-size: 13px;
  }

  .nc-alert-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }

  .nc-alert-actions .nc-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 7px 9px;
  }

  .nc-alert-actions ha-icon {
    --mdc-icon-size: 16px;
  }

  .nc-alert-statuses {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .nc-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
  }

  .nc-status ha-icon {
    --mdc-icon-size: 14px;
  }

  .nc-status.active {
    background: rgba(244, 67, 54, 0.14);
    color: var(--error-color);
  }

  .nc-status.idle {
    background: var(--secondary-background-color);
    color: var(--secondary-text-color);
  }

  .nc-status.triggered {
    background: rgba(76, 175, 80, 0.14);
    color: var(--success-color, #4caf50);
  }

  .nc-status.running {
    background: rgba(3, 169, 244, 0.14);
    color: var(--info-color, #039be5);
  }

  .nc-status.run-count {
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }

  .nc-alert-actions .nc-open-automation {
    text-decoration: none;
  }

  @container (min-width: 701px) and (max-width: 1100px) {
    .nc-alert {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .nc-alert-actions .nc-button {
      flex: 0 0 auto;
      justify-content: center;
    }

    .nc-alert-actions .nc-button-label {
      display: none;
    }
  }

  @container (max-width: 700px) {
    .nc-alert {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .nc-alert-actions {
      grid-column: 1 / -1;
      width: 100%;
    }

    .nc-alert-actions .nc-button {
      flex: 0 0 auto;
      justify-content: center;
      padding: 8px 4px;
    }

    .nc-alert-actions .nc-button-label {
      display: none;
    }
  }

  @media (min-width: 801px) and (max-width: 980px) {
    .nc-alert {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .nc-alert-actions .nc-button {
      flex: 1 1 0;
      min-width: 0;
      justify-content: center;
    }

    .nc-alert-actions .nc-button-label {
      display: none;
    }
  }

  @media (min-width: 701px) and (max-width: 800px) {
    .nc-alert {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .nc-alert-actions .nc-button {
      flex: 0 0 auto;
      justify-content: center;
    }

    .nc-alert-actions .nc-button-label {
      display: none;
    }
  }

  @media (max-width: 700px) {
    .nc-alert {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .nc-alert-actions {
      grid-column: 1 / -1;
      width: 100%;
    }

    .nc-alert-actions .nc-button {
      flex: 1 1 0;
      min-width: 0;
      justify-content: center;
      padding: 8px 4px;
    }

    .nc-alert-actions .nc-button-label {
      display: none;
    }
  }
`;

export class AlertCard extends LitElement {
  static properties = {
    alert: { attribute: false },
    actions: { attribute: false },
    hass: { attribute: false },
    automationStatus: { attribute: false },
  };

  static styles = [buttonStyles, alertCardStyles];

  declare alert: Alert | undefined;
  declare actions: AlertActionItem[];
  declare hass: Hass | null;
  declare automationStatus: AutomationRuntimeStatus | undefined;

  constructor() {
    super();
    this.hass = null;
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this.alert) {
      return nothing;
    }

    const { alert, hass, automationStatus } = this;

    return html`<div class="nc-alert">
      <div class="nc-alert-icon">
        <ha-icon icon=${alert.icon || "mdi:bell-outline"}></ha-icon>
      </div>
      <div class="nc-alert-main">
        <div class="nc-alert-heading">
          <div class="nc-alert-name">${alert.name}</div>
          ${alertStatusTemplate(hass, automationStatus)}
        </div>
      </div>
      <div class="nc-alert-actions">${alertActionsTemplate(
        this.actions || [],
        alert,
        this.dispatchAction,
      )}</div>
    </div>`;
  }

  private dispatchAction = (actionId: string, alert: Alert): void => {
    if (!this.alert) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent("alert-action", {
        detail: { actionId, alert },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

if (!customElements.get("ha-notifications-alert-card")) {
  customElements.define("ha-notifications-alert-card", AlertCard);
}
