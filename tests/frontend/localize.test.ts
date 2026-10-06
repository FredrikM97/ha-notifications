import { describe, expect, it, vi } from "vitest";
import { createLocalizer } from "../../frontend/localize.js";
import type { Hass } from "../../frontend/types.js";

describe("frontend localizer", () => {
  it("uses the Home Assistant translator once it is bound", () => {
    const localize = createLocalizer({
      localize: vi.fn((key: string) => {
        if (key === "component.ha_notifications.frontend.editor.basic.section") {
          return "Grundlegend";
        }
        return key;
      }),
    } as Hass);

    expect(localize("editor.basic.section")).toBe("Grundlegend");
  });

  it("falls back to the bundled catalog", () => {
    const localize = createLocalizer(undefined);

    expect(localize("editor.basic.section")).toBe("Basics");
    expect(localize("editor.triggers.section")).toBe("When");
    expect(localize("editor.triggers.overview")).toBe("Overview");
    expect(localize("editor.notification.section")).toBe("Notification");
    expect(localize("editor.notification.message")).toBe("Message");
    expect(localize("editor.recipients.section")).toBe("Recipients");
    expect(localize("editor.mobile.mobile")).toBe("Mobile options");
    expect(localize("editor.confirmation.section")).toBe("Confirmation");
    expect(localize("editor.confirmation.buttons")).toBe("Buttons");
    expect(localize("editor.missing", {}, "Fallback")).toBe("Fallback");
  });
});
