import { describe, expect, it, vi } from "vitest";
import { createLocalizer, optionalTranslation } from "../../frontend/localize.js";
import type { Hass } from "../../frontend/types.js";

describe("frontend localizer", () => {
  it("resolves optional translations without exposing missing keys", () => {
    const localize = createLocalizer(undefined);
    expect(optionalTranslation(localize, "editor.basic.label")).toBe("Basics");
    expect(optionalTranslation(localize, "editor.missing")).toBeUndefined();
    expect(optionalTranslation(localize)).toBeUndefined();
    expect(optionalTranslation(() => "", "editor.basic.label")).toBeUndefined();
  });

  it("uses the Home Assistant translator once it is bound", () => {
    const localize = createLocalizer({
      localize: vi.fn((key: string) => {
        if (key === "component.ha_notifications.frontend.editor.basic.label") {
          return "Grundlegend";
        }
        return key;
      }),
    } as Hass);

    expect(localize("editor.basic.label")).toBe("Grundlegend");
  });

  it("falls back to the bundled catalog", () => {
    const localize = createLocalizer(undefined);

    expect(localize("editor.basic.label")).toBe("Basics");
    expect(localize("editor.when.label")).toBe("When");
    expect(localize("editor.when.automation_mode.helper")).toMatch(/^Parallel is usually/);
    expect(localize("editor.notification.label")).toBe("Notification");
    expect(localize("editor.notification.message.label")).toBe("Message");
    expect(localize("editor.recipients.label")).toBe("Recipients");
    expect(localize("editor.mobile.label")).toBe("Mobile options");
    expect(localize("editor.confirmation.label")).toBe("Confirmation");
    expect(localize("editor.confirmation.buttons.label")).toBe("Buttons");
    expect(localize("editor.missing", {}, "Fallback")).toBe("Fallback");
  });
});
