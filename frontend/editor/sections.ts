import type { NotificationOptionControl, NotificationOptionControls, NotificationTarget } from "../types.js";
import { fromDuration, toDuration, type EditableAlert } from "./alert-model.js";

type Data = Record<string, unknown>;
type Selector = Record<string, unknown>;
type OptionGroup = keyof NotificationOptionControls;

export interface EditorField {
  /** Form key; translations resolve as `editor.<section>.<name>.label` and `.helper`. */
  name: string;
  /** Dotted path into the alert draft. */
  path: string;
  selector: Selector;
  required?: boolean;
  disabled?: boolean;
  read?(value: unknown): unknown;
  write?(value: unknown): unknown;
}

export interface EditorSection {
  /** Translation namespace: `editor.<key>.label` and optional `editor.<key>.helper`. */
  key: string;
  parent?: string;
  /** Rendered inside the parent section instead of as its own navigation item. */
  embedded?: boolean;
  /** Path of the boolean that enables this section. */
  toggle?: string;
  /** Native notification option group with per-field delivery switches. */
  options?: OptionGroup;
  validate?: boolean;
  fields(alert: EditableAlert): EditorField[];
}

const OPTIONS_PATH = "notification.options.";

function isRecord(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function getPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), root);
}

function setPath(root: object, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  let target = root as Data;
  for (const key of keys) target = (target[key] ??= {}) as Data;
  target[last] = value;
}

/** Remove a native option and any containers it leaves empty, keeping `notification.options`. */
function unsetOption(alert: EditableAlert, path: string): void {
  const keys = path.slice(OPTIONS_PATH.length).split(".");
  const parents: Data[] = [alert.notification.options];
  for (const key of keys.slice(0, -1)) {
    const next = parents[parents.length - 1][key];
    if (!isRecord(next)) return;
    parents.push(next);
  }
  delete parents[parents.length - 1][keys[keys.length - 1]];
  for (let index = parents.length - 1; index > 0 && !Object.keys(parents[index]).length; index--) {
    delete parents[index - 1][keys[index - 1]];
  }
}

function isList(selector: Selector): boolean {
  return ["trigger", "condition", "action"].some(type => type in selector)
    || Boolean((selector.object as { multiple?: boolean } | undefined)?.multiple);
}

export function readField(alert: EditableAlert, field: EditorField): unknown {
  const value = getPath(alert, field.path);
  if (field.read) return field.read(value);
  if ("duration" in field.selector) return toDuration(value);
  if ("boolean" in field.selector) return value === true;
  return value;
}

export function writeField(alert: EditableAlert, section: EditorSection, field: EditorField, value: unknown): void {
  if (field.disabled) return;
  let stored = value;
  if (field.write) stored = field.write(value);
  else if ("duration" in field.selector) stored = fromDuration(value);
  else if (isList(field.selector)) stored = value ?? [];
  if (section.options) {
    // Pin the switches before the first value so typing never enables the group or field.
    optionControl(alert, section);
    if (!hasValue(stored)) return unsetOption(alert, field.path);
  }
  setPath(alert, field.path, stored);
}

export function hasOptionValues(alert: EditableAlert, section: EditorSection): boolean {
  return section.fields(alert).some(field => hasValue(getPath(alert, field.path)));
}

export function isSectionEnabled(alert: EditableAlert, section: EditorSection): boolean | undefined {
  if (!section.toggle) return undefined;
  const enabled = getPath(alert, section.toggle);
  if (typeof enabled === "boolean") return enabled;
  return Boolean(section.options) && hasOptionValues(alert, section);
}

export function setSectionEnabled(alert: EditableAlert, section: EditorSection, enabled: boolean): void {
  if (section.options) optionControl(alert, section);
  setPath(alert, section.toggle!, enabled);
}

/** Own switch combined with every ancestor switch; undefined when the section has none. */
export function sectionStatus(alert: EditableAlert, section: EditorSection): boolean | undefined {
  const enabled = isSectionEnabled(alert, section);
  if (enabled === undefined || !section.parent) return enabled;
  return enabled && sectionStatus(alert, findSection(section.parent)) !== false;
}

function controlPath(field: EditorField): string {
  return field.path.slice(OPTIONS_PATH.length);
}

export function isFieldEnabled(alert: EditableAlert, section: EditorSection, field: EditorField): boolean {
  return alert.notification.option_controls?.[section.options!]?.fields[controlPath(field)]
    ?? hasValue(getPath(alert, field.path));
}

export function setFieldEnabled(alert: EditableAlert, section: EditorSection, field: EditorField, enabled: boolean): void {
  optionControl(alert, section).fields[controlPath(field)] = enabled;
}

/** Create the group's control, snapshotting inferred flags so a disabled group lists the paths it withholds. */
function optionControl(alert: EditableAlert, section: EditorSection): NotificationOptionControl {
  const controls = (alert.notification.option_controls ??= {});
  const control = (controls[section.options!] ??= { enabled: isSectionEnabled(alert, section) ?? true, fields: {} });
  for (const field of section.fields(alert)) control.fields[controlPath(field)] ??= isFieldEnabled(alert, section, field);
  return control;
}

export function findSection(key: string): EditorSection {
  return editorSections.find(section => section.key === key)!;
}

export function rootSection(section: EditorSection): EditorSection {
  return section.parent ? rootSection(findSection(section.parent)) : section;
}

export function embeddedSections(section: EditorSection): EditorSection[] {
  return editorSections.filter(child => child.parent === section.key && child.embedded);
}

function option(name: string, selector: Selector, path = name): EditorField {
  return { name, path: `${OPTIONS_PATH}${path}`, selector };
}

function pushOption(name: string, selector: Selector): EditorField {
  return option(name, selector, `push.${name}`);
}

const text = { text: {} };
// Editor-only: rendered as a native color picker storing a hex string, never passed to ha-form.
const color = { color_hex: {} };
const toggle = { boolean: {} };
const duration = { duration: { enable_day: true } };
const dropdown = (...options: string[]) => ({ select: { mode: "dropdown", options } });

export const editorSections: EditorSection[] = [
  {
    key: "basic",
    fields: () => [
      { name: "name", path: "name", selector: text, required: true },
      { name: "description", path: "description", selector: { text: { multiline: true } } },
      { name: "icon", path: "icon", selector: { icon: {} } },
    ],
  },
  {
    key: "when",
    fields({ monitor: { conditions } }) {
      // Conditional alerts always run in parallel; the backend enforces it.
      const conditional = conditions.enabled && conditions.items.length > 0;
      return [{
        name: "automation_mode",
        path: "monitor.automation_mode",
        selector: dropdown("parallel", "single", "restart", "queued"),
        disabled: conditional,
        read: value => (conditional ? "parallel" : value),
      }];
    },
  },
  {
    key: "triggers",
    parent: "when",
    toggle: "monitor.triggers.enabled",
    validate: true,
    fields: () => [{ name: "items", path: "monitor.triggers.items", selector: { trigger: {} } }],
  },
  {
    key: "conditions",
    parent: "when",
    toggle: "monitor.conditions.enabled",
    validate: true,
    fields({ monitor: { conditions } }) {
      const fields: EditorField[] = [
        { name: "startup", path: "monitor.conditions.startup", selector: toggle },
        { name: "interval_enabled", path: "monitor.conditions.interval.enabled", selector: toggle },
      ];
      if (conditions.interval.enabled) fields.push({ name: "interval", path: "monitor.conditions.interval.value", selector: duration });
      fields.push({ name: "items", path: "monitor.conditions.items", selector: { condition: {} } });
      return fields;
    },
  },
  {
    key: "inactive",
    parent: "when",
    toggle: "monitor.inactive.enabled",
    fields: () => [
      { name: "clear_notification", path: "monitor.inactive.clear_notification", selector: toggle },
      { name: "items", path: "monitor.inactive.items", selector: { trigger: {} } },
    ],
  },
  {
    key: "recipients",
    fields: ({ notification }) => [{
      name: "target",
      path: "notification.target",
      selector: { target: { entity: { domain: "notify" } } },
      // `user_id` is integration-specific and has no native target picker; keep it out of the form.
      read(value) {
        const { user_id: _users, ...target } = (value ?? {}) as NotificationTarget;
        return target;
      },
      write(value) {
        const users = notification.target?.user_id;
        return users?.length ? { ...(value as NotificationTarget), user_id: users } : value ?? {};
      },
    }],
  },
  {
    key: "notification",
    fields: () => [
      { name: "title", path: "notification.title", selector: text },
      { name: "message", path: "notification.message", selector: { template: {} } },
      { name: "use_default_tag", path: "notification.use_default_tag", selector: toggle },
    ],
  },
  {
    key: "postSendActions",
    parent: "notification",
    toggle: "post_send_actions.enabled",
    fields: () => [{ name: "actions", path: "post_send_actions.actions", selector: { action: {} } }],
  },
  {
    key: "mobile",
    parent: "notification",
    embedded: true,
    options: "mobile",
    fields: () => [
      option("group", text),
      option("color", color),
      option("notification_icon", { icon: {} }),
      option("icon_url", text),
    ],
  },
  {
    key: "android",
    parent: "notification",
    toggle: "notification.option_controls.android.enabled",
    options: "android",
    fields: () => [
      option("channel", text),
      option("importance", dropdown("min", "low", "default", "high", "max")),
      option("sticky", toggle),
      option("persistent", toggle),
      option("alert_once", toggle),
      option("clickAction", text),
      option("timeout", { number: { min: 0, mode: "box", unit_of_measurement: "s" } }),
      option("visibility", dropdown("public", "private", "secret")),
      option("vibrationPattern", text),
      option("ledColor", color),
    ],
  },
  {
    key: "ios",
    parent: "notification",
    toggle: "notification.option_controls.ios.enabled",
    options: "ios",
    fields: ({ notification: { options } }) => [
      option("subtitle", text),
      option("url", text),
      pushOption("interruption-level", dropdown("passive", "active", "time-sensitive", "critical")),
      // Structured critical sounds stay editable as an object.
      pushOption("sound", isRecord(getPath(options, "push.sound")) ? { object: {} } : text),
      pushOption("badge", { number: { min: 0, mode: "box" } }),
      option("notification_icon_color", color),
      option("presentation_options", { select: { multiple: true, options: ["alert", "badge", "sound"] } }),
    ],
  },
  {
    key: "confirmation",
    toggle: "confirmation.enabled",
    fields({ confirmation: { reminders } }) {
      const fields: EditorField[] = [
        {
          name: "buttons",
          path: "confirmation.buttons",
          selector: { object: {
            multiple: true,
            label_field: "label",
            description_field: "id",
            fields: { label: { required: true, selector: text }, id: { selector: text } },
          } },
        },
        { name: "forget_after_enabled", path: "confirmation.reminders.forget_after_enabled", selector: toggle },
      ];
      if (reminders.forget_after_enabled) fields.push({ name: "timeout", path: "confirmation.reminders.timeout", selector: duration });
      return fields;
    },
  },
  {
    key: "reminder",
    parent: "confirmation",
    toggle: "confirmation.reminders.enabled",
    fields: () => [
      { name: "interval", path: "confirmation.reminders.interval", selector: duration },
      { name: "max_attempts", path: "confirmation.reminders.max_attempts", selector: { number: { min: 1, max: 20, mode: "box" } } },
      { name: "show_attempts", path: "confirmation.reminders.show_attempts", selector: toggle },
    ],
  },
  {
    key: "confirmationNotification",
    parent: "confirmation",
    toggle: "confirmation.notification.enabled",
    fields: () => [
      { name: "message", path: "confirmation.notification.message", selector: { template: {} } },
      { name: "use_default_tag", path: "confirmation.notification.use_default_tag", selector: toggle },
    ],
  },
  {
    key: "postConfirmationActions",
    parent: "confirmation",
    toggle: "confirmation.actions_enabled",
    fields: () => [{ name: "actions", path: "confirmation.actions", selector: { action: {} } }],
  },
];
