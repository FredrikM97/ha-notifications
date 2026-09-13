import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(
  root,
  "custom_components",
  "notification_center",
  "frontend",
  "dist",
);
const modules = [
  "api.js",
  "condition-builder.js",
  "editor.js",
  "history.js",
  "panel.js",
  "recipient-picker.js",
  "styles.js",
  "yaml-view.js",
];

assert.equal(existsSync(join(dist, "dom.js")), false);

for (const module of modules) {
  assert.ok(
    existsSync(join(dist, module)),
    `Missing compiled module: ${module}`,
  );
}

for (const module of modules) {
  const source = readFileSync(join(dist, module), "utf8");
  assert.doesNotMatch(source, /from ["']\.\/[^"']+\.ts["']/);
}

const panel = readFileSync(join(dist, "panel.js"), "utf8");
assert.match(panel, /customElements\.define/);

const payload = await import(join(dist, "alert-payload.js"));
const result = payload.buildAlertPayload(
  {
    id: "demo",
    name: "Old name",
    enabled: true,
    conditions: [],
    monitor: { on_change: true, startup: true },
    notification: {
      action: "notify.old",
      target: {},
      title: "Old",
      message: "Old",
      confirmation: {
        enabled: false,
        button: "",
        completion_message: "",
        resend_interval: "00:30:00",
        max_attempts: 5,
        actions_enabled: false,
      },
    },
  },
  {
    name: "New name",
    description: "",
    condition: "{{ true }}",
    conditions: [{ type: "template", template: "{{ true }}" }],
    onChange: true,
    startup: true,
    target: { entity_id: ["notify.phone"] },
    title: "Title",
    message: "Message",
    confirmation: {
      enabled: false,
      button: "",
      completion_message: "",
      resend_interval: "00:30:00",
      max_attempts: 5,
      actions_enabled: false,
    },
  },
);
assert.equal(result.notification.action, "notify.send_message");
assert.equal(result.conditions[0].template, "{{ true }}");
