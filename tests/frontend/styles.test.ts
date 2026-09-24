import { describe, expect, it } from "vitest";
import { styles } from "../../frontend/styles.js";

describe("frontend styles", () => {
  it("keeps the YAML code editor bound to the viewport", () => {
    const rule = styles.match(
      /ha-code-editor\.nc-yaml-editor \{[\s\S]*?\n\}/,
    )?.[0];

    expect(rule).toBeDefined();
    expect(rule).toMatch(/height: min\(650px, calc\(100dvh - \d+px\)\);/);
    expect(rule).toMatch(
      /--nc-code-editor-height: min\(650px, calc\(100dvh - \d+px\)\);/,
    );
    expect(rule).not.toMatch(/(?:height|--nc-code-editor-height): 100%;/);
  });
});
