import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panelBundlePath = join(
  process.cwd(),
  "build",
  "frontend",
  "panel.js",
);

describe("frontend build contract", () => {
  it("bundles the Home Assistant panel and card registrations", () => {
    expect(existsSync(panelBundlePath)).toBe(true);
    const bundle = readFileSync(panelBundlePath, "utf8");

    expect(bundle).toContain('customElements.define("ha-notifications-panel"');
    expect(bundle).toContain('customElements.define("ha-notifications-card"');
    expect(bundle).toContain('type: "ha-notifications-card"');
  });
});
