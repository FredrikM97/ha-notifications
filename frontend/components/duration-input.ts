import { css, html, LitElement } from "lit";
import type { Hass } from "../types.js";

const DURATION_INPUT_TAG = "ha-notifications-duration-input";

export const durationInputStyles = css`
  :host {
    display: block;
    width: min(100%, 24rem);
    max-width: 100%;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }

  ha-input,
  ha-selector {
    display: block;
    width: 100%;
    min-width: 0;
  }
`;

export function durationInputValue(
  value: string | number | Record<string, number> | undefined,
  fallback: string,
): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const totalSeconds = Math.max(0, Math.floor(value));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }
  if (typeof value === "string") {
    const parts = value.split(":");
    if (parts.length === 2) return `${value}:00`;
    return value;
  }
  if (!value || typeof value !== "object") return fallback;

  const totalSeconds = Math.max(
    0,
    Math.floor(
      (Number(value.days) || 0) * 86400 +
        (Number(value.hours) || 0) * 3600 +
        (Number(value.minutes) || 0) * 60 +
        (Number(value.seconds) || 0),
    ),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

class DurationInput extends LitElement {
  static properties = {
    hass: { attribute: false },
    value: { type: String },
    label: { type: String },
    ariaLabel: { type: String, attribute: "aria-label" },
  };

  static styles = durationInputStyles;

  declare hass?: Hass;
  declare value: string;
  declare label: string;
  declare ariaLabel: string;

  constructor() {
    super();
    this.value = "00:00:00";
    this.label = "";
    this.ariaLabel = "";
  }

  protected render() {
    if (this.hass) {
      return html`<ha-selector
        .hass=${this.hass}
        .selector=${{ duration: { enable_day: true, enable_second: true } }}
        .value=${this.value}
        .label=${this.label || undefined}
        aria-label=${this.ariaLabel || this.label}
        @value-changed=${this.handleSelectorChange}
      ></ha-selector>`;
    }

    return html`<ha-input
      type="text"
      inputmode="numeric"
      placeholder="HH:MM:SS"
      aria-label=${this.ariaLabel || this.label}
      .value=${this.value}
      @input=${this.handleInput}
      @blur=${this.handleCommit}
      @change=${this.handleCommit}
    ></ha-input>`;
  }

  private handleSelectorChange = (event: CustomEvent<{ value?: unknown }>): void => {
    this.emitValue(
      durationInputValue(
        event.detail.value as string | number | Record<string, number> | undefined,
        this.value,
      ),
    );
  };

  private handleInput = (event: Event): void => {
    this.emitValue((event.currentTarget as HTMLInputElement).value);
  };

  private handleCommit = (event: Event): void => {
    const raw = (event.currentTarget as HTMLInputElement).value;
    const parts = raw.replace(/[^\d:]/g, "").split(":");
    const seconds = Number(parts.pop() || 0);
    const minutes = Number(parts.pop() || 0);
    const hours = Number(parts.join("") || 0);
    this.emitValue(
      `${hours}:${String(Math.min(minutes, 59)).padStart(2, "0")}:${String(
        Math.min(seconds, 59),
      ).padStart(2, "0")}`,
    );
  };

  private emitValue(value: string): void {
    this.dispatchEvent(
      new CustomEvent("nc-duration-change", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get(DURATION_INPUT_TAG)) {
  customElements.define(DURATION_INPUT_TAG, DurationInput);
}
