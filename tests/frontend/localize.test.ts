import { describe, expect, it, vi } from "vitest";
import { createLocalizer, localizeEditorTitle } from "../../frontend/localize.js";
import type { Hass } from "../../frontend/types.js";

describe("editor localizer", () => {
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
    expect(localizeEditorTitle(localize, "Basic")).toBe("Grundlegend");
  });

  it("falls back to the bundled catalog", () => {
    const localize = createLocalizer(undefined);

    expect(localize("editor.basic.section")).toBe("Basic");
    expect(localize("editor.missing", {}, "Fallback")).toBe("Fallback");
  });
});
