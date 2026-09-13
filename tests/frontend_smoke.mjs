import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(
  root,
  "custom_components",
  "notification_center",
  "dist",
);
const panelPath = join(dist, "panel.js");
assert.ok(existsSync(panelPath), "Missing bundled panel.js");

const panel = readFileSync(panelPath, "utf8");
assert.match(panel, /customElements\.define/);
assert.doesNotMatch(panel, /from ["']lit["']/);
assert.match(panel, /config\/auth\/list/);
assert.match(panel, /Users/);
assert.match(panel, /Post-send actions/);
assert.match(panel, /Post-confirmation actions/);
assert.match(panel, /must be a valid JSON array/);
assert.match(panel, /ha-code-editor/);
assert.match(panel, /Post-send actions/);
assert.match(panel, /Post-confirmation actions/);
assert.match(panel, /ha-code-editor/);
