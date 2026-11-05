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

    const keys = [
      "editor.basic.label", "editor.notification.label", "editor.notification.message.label",
      "editor.recipients.label", "editor.mobile.label", "editor.confirmation.label",
      "editor.confirmation.buttons.label", "panel.create_first", "editor.triggers.helper",
      "editor.triggers.items.helper", "editor.conditions.items.helper", "editor.conditions.interval.helper",
      "editor.postSendActions.helper", "editor.postConfirmationActions.helper", "history.no_activity.helper",
    ];
    expect(Object.fromEntries(keys.map(key => [key, localize(key)]))).toMatchSnapshot();
    expect(localize("editor.missing", {}, "Fallback")).toBe("Fallback");
  });
});
