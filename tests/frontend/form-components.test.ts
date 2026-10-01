// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { html, render } from "lit";
import "../../frontend/components/duration-input.js";
import { durationInputValue } from "../../frontend/components/duration-input.js";
import { renderFormField } from "../../frontend/components/form-field.js";
import "../../frontend/components/setting-toggle.js";

const hosts: HTMLElement[] = [];

function renderIntoHost(template: ReturnType<typeof html>): HTMLElement {
  const host = document.createElement("div");
  hosts.push(host);
  document.body.append(host);
  render(template, host);
  return host;
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe("shared form components", () => {
  it("renders a named label slot and default content slot", async () => {
    const host = renderIntoHost(
      renderFormField("Alert name", html`<input aria-label="Alert name" />`, true),
    );
    const field = host.querySelector<HTMLElement & { updateComplete: Promise<void> }>(
      "ha-notifications-form-field",
    );
    await field?.updateComplete;

    expect(field?.classList.contains("full")).toBe(true);
    expect(field?.querySelector('[slot="label"]')?.textContent).toBe("Alert name");
    expect(field?.shadowRoot?.querySelector('slot[name="label"]')).not.toBeNull();
    expect(field?.querySelector("input")?.getAttribute("aria-label")).toBe(
      "Alert name",
    );
  });

  it("normalizes native duration input and emits a composed value event", async () => {
    const host = renderIntoHost(html`<ha-notifications-duration-input
      .value=${"01:02:03"}
      label="Delay"
    ></ha-notifications-duration-input>`);
    const duration = host.querySelector<HTMLElement & {
      updateComplete: Promise<void>;
    }>("ha-notifications-duration-input");
    await duration?.updateComplete;

    const emitted = new Promise<CustomEvent<{ value: string }>>((resolve) => {
      host.addEventListener("nc-duration-change", (event) => {
        resolve(event as CustomEvent<{ value: string }>);
      }, { once: true });
    });
    const input = duration?.shadowRoot?.querySelector("ha-input") as
      | (HTMLElement & { value: string })
      | null;
    if (!input) throw new Error("Duration input is missing.");
    input.value = "2:3:4";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const event = await emitted;
    expect(event.detail).toEqual({ value: "2:03:04" });
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("normalizes Home Assistant selector values through the same event", async () => {
    const host = renderIntoHost(html`<ha-notifications-duration-input
      .hass=${{}}
      .value=${"01:00:00"}
      label="Delay"
    ></ha-notifications-duration-input>`);
    const duration = host.querySelector<HTMLElement & {
      updateComplete: Promise<void>;
    }>("ha-notifications-duration-input");
    await duration?.updateComplete;

    const emitted = new Promise<CustomEvent<{ value: string }>>((resolve) => {
      host.addEventListener("nc-duration-change", (event) => {
        resolve(event as CustomEvent<{ value: string }>);
      }, { once: true });
    });
    duration?.shadowRoot?.querySelector("ha-selector")?.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: { days: 2, hours: 3, minutes: 4, seconds: 5 } },
        bubbles: true,
      }),
    );

    expect((await emitted).detail.value).toBe("51:04:05");
  });

  it("emits setting identity and enabled state without editor coupling", async () => {
    const host = renderIntoHost(html`<ha-notifications-setting-toggle
      setting="confirmation"
      label="Confirmation"
      enable-text="Enable"
      disable-text="Disable"
    ></ha-notifications-setting-toggle>`);
    const toggle = host.querySelector<HTMLElement & {
      updateComplete: Promise<void>;
    }>("ha-notifications-setting-toggle");
    await toggle?.updateComplete;

    const emitted = new Promise<CustomEvent<{ setting: string; enabled: boolean }>>(
      (resolve) => {
        host.addEventListener("nc-setting-change", (event) => {
          resolve(event as CustomEvent<{ setting: string; enabled: boolean }>);
        }, { once: true });
      },
    );
    const control = toggle?.shadowRoot?.querySelector("ha-switch") as
      | (HTMLElement & { checked: boolean })
      | null;
    if (!control) throw new Error("Setting toggle control is missing.");
    control.checked = true;
    control.dispatchEvent(new Event("change", { bubbles: true }));

    const event = await emitted;
    expect(event.detail).toEqual({ setting: "confirmation", enabled: true });
    expect(event.composed).toBe(true);
  });

  it("normalizes Home Assistant duration values including days", () => {
    expect(durationInputValue({ days: 2, hours: 3, minutes: 4, seconds: 5 }, "0:00:00"))
      .toBe("51:04:05");
  });
});
