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
const editor = readFileSync(
  join(
    root,
    "custom_components",
    "notification_center",
    "frontend",
    "editor.ts",
  ),
  "utf8",
);
assert.match(panel, /customElements\.define/);
assert.match(panel, /notification-center-card/);
assert.match(panel, /window\.customCards|customCards/);
assert.match(panel, /getCardSize/);
assert.match(panel, /Administrator access required/);
assert.match(panel, /custom:notification-center-card/);
assert.doesNotMatch(panel, /from ["']lit["']/);
assert.match(panel, /config\/auth\/list/);
assert.match(panel, /get_states/);
assert.match(panel, /Users/);
assert.match(panel, /Post-send actions/);
assert.match(panel, /Post-confirmation actions/);
assert.match(panel, /Reminder interval/);
assert.doesNotMatch(panel, /Repeat notification/);
assert.match(panel, /value\.notification\.repeat && value\.notification\.repeat\.enabled !== false/);
assert.match(panel, /function hasRequiredCondition/);
assert.match(panel, /Search entity name or ID/);
assert.match(panel, /No visual conditions configured/);
assert.match(panel, /Validate condition/);
assert.match(panel, /Conditions YAML/);
assert.match(panel, /Validate actions/);
assert.match(panel, /validate_conditions/);
assert.match(panel, /switch\.pixi_smart_drinking_fountain_water_pump_reset/);
assert.match(panel, /YAML list of Home Assistant/);
assert.doesNotMatch(panel, /YAML lists like/);
assert.doesNotMatch(panel, /if \(!conditionTemplate\(value\)\.trim\(\)\)/);
assert.match(panel, /nc-history-badge/);
assert.match(panel, /Details/);
assert.match(panel, /History for/);
assert.match(panel, /Show all/);
assert.match(panel, /nc-history-alert-link/);
assert.match(panel, /overflow-x: auto/);
assert.match(panel, /mdi:check-circle/);
assert.match(panel, /mdi:alert-circle/);
assert.match(panel, /must be a valid YAML list/);
assert.doesNotMatch(panel, /must be a valid JSON array/);
assert.match(panel, /ha-code-editor/);
assert.match(panel, /Notify recipients when confirmed/);
assert.match(panel, /Confirmed by \{\{ confirmed_by \}\}/);
assert.match(panel, /discard_test_payload/);
assert.match(panel, /Draft test notification sent\./);
assert.match(panel, /nc-switch-input::after/);
assert.doesNotMatch(
  panel,
  /post-confirmation actions[\s\S]{0,500}!confirmation\.enabled/,
);
assert.match(
  editor,
  /function defaultAlert\(\)[\s\S]*?confirmation:\s*\{\s*enabled: true,/,
);
assert.match(
  editor,
  /confirmation: !alert \|\| Boolean\(alert\.notification\.confirmation\),[\s\S]*?postConfirmationActions: !alert \|\| Boolean\(alert\.notification\.confirmation\),/,
);
