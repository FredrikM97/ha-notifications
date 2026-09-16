import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const panelPath = join(dist, "panel.js");
assert.ok(existsSync(panelPath), "Missing bundled panel.js");
const runtimePanelPath = join(
  root,
  "custom_components",
  "ha_notifications",
  "dist",
  "panel.js",
);
assert.ok(existsSync(runtimePanelPath), "Missing runtime panel.js");

const panel = readFileSync(panelPath, "utf8");
assert.equal(readFileSync(runtimePanelPath, "utf8"), panel);
const editor = readFileSync(
  join(
    root,
    "frontend",
    "editor",
    "index.ts",
  ),
  "utf8",
);
const api = readFileSync(
  join(
    root,
    "frontend",
    "api.ts",
  ),
  "utf8",
);
const yamlView = readFileSync(
  join(
    root,
    "frontend",
    "yaml-view.ts",
  ),
  "utf8",
);
const editorHelpers = readFileSync(
  join(
    root,
    "frontend",
    "editor",
    "helpers.ts",
  ),
  "utf8",
);
assert.match(panel, /customElements\.define/);
assert.match(panel, /ha-notifications-card/);
assert.match(panel, /customElements\.define\(["']ha-notifications-card["']/);
assert.doesNotMatch(panel, /LegacyHaNotificationsCard/);
assert.match(panel, /window\.customCards|customCards/);
assert.match(panel, /getCardSize/);
assert.match(panel, /Administrator access required/);
assert.match(panel, /custom:ha-notifications-card/);
assert.match(panel, /HA Notifications/);
assert.doesNotMatch(panel, /from ["']lit["']/);
assert.match(panel, /config\/auth\/list/);
assert.match(panel, /get_states/);
assert.match(panel, /Users/);
assert.match(panel, /Post-send actions/);
assert.match(panel, /Post-confirmation actions/);
assert.doesNotMatch(panel, /Reminder interval/);
assert.doesNotMatch(panel, /value\.repeat/);
assert.match(panel, /hasRequiredCondition\s*=/);
assert.match(panel, /Search entity name or ID/);
assert.match(panel, /No visual conditions configured/);
assert.match(panel, /Validate condition/);
assert.match(panel, /Conditions YAML/);
assert.match(panel, /Validate actions/);
assert.match(panel, /validate_conditions/);
assert.match(panel, /switch\.garage_door/);
assert.match(panel, /YAML list of Home Assistant/);
assert.doesNotMatch(panel, /YAML lists like/);
assert.doesNotMatch(panel, /if \(!conditionTemplate\(value\)\.trim\(\)\)/);
assert.match(panel, /nc-history-badge/);
assert.match(panel, /nc-history-flow/);
assert.match(panel, /\.nc-history-filter[\s\S]*?position: sticky/);
assert.match(panel, /Details/);
assert.match(panel, /History for/);
assert.match(panel, /Show all/);
assert.match(panel, /nc-history-alert-link/);
assert.match(panel, /overflow-x: auto/);
assert.match(panel, /setInterval/);
assert.match(panel, /editorOpen/);
assert.match(api, /call<unknown>\(hass, "list"\)/);
assert.match(api, /call\(hass, "test",/);
assert.match(api, /Select an alert before testing it/);
assert.match(panel, /min-height: min\(420px, 62vh\)/);
assert.match(panel, /mdi:check-circle/);
assert.match(panel, /mdi:alert-circle/);
assert.match(panel, /must be a valid YAML list/);
assert.doesNotMatch(panel, /must be a valid JSON array/);
assert.match(panel, /ha-code-editor/);
assert.match(panel, /Notify recipients when confirmed/);
assert.doesNotMatch(panel, /Confirmed by \{\{ confirmed_by \}\}/);
assert.match(panel, /discard_test_payload/);
assert.match(panel, /Draft test notification sent\./);
assert.match(panel, /nc-switch-input::after/);
assert.doesNotMatch(
  panel,
  /post-confirmation actions[\s\S]{0,500}!confirmation\.enabled/,
);
assert.match(
  editorHelpers,
  /function defaultAlert\(\)[\s\S]*?confirmation:\s*\{\s*enabled: true,/,
);
assert.match(editor, /sectionLabel\(parent, title\)/);
assert.match(yamlView, /class="nc-code-editor nc-yaml-editor"/);
assert.match(
  editor,
  /confirmation: !options\.alert \|\| Boolean\(options\.alert\.confirmation\),[\s\S]*?postConfirmationActions:\s*\n?\s*!options\.alert \|\| Boolean\(options\.alert\.confirmation\),/,
);
