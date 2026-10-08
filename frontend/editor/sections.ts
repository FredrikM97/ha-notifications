/**
 * Editor sections as data. Each section is an ha-form schema plus a mapping
 * between the alert and the form; the editor renders all of them the same way.
 */
import type { Hass } from "../types.js";
import type { Localize } from "../localize.js";
import {
  fromDuration,
  toDuration,
  type EditableAlert,
} from "./alert-model.js";

type FormData = Record<string, unknown>;

export interface SchemaField {
  hideLabel?: boolean;
  default?: string;
  name: string;
  selector: Record<string, unknown>;
  required?: boolean;
  disabled?: boolean;
}

export interface EditorState {
  hass: Hass;
  localize: Localize;
  alert: EditableAlert;
  postConfirmationActions: boolean;
  users: { value: string; label: string }[];
  mobileDrafts?: Record<string, {
    enabled?: boolean;
    values?: FormData;
    fields?: Record<string, { enabled: boolean; value?: unknown }>;
  }>;
}

export interface EditorSection {
  key: string;
  /** Translation key for the section title. */
  title: string;
  localTitle?: string;
  parent?: string;
  embedded?: boolean;
  schema(state: EditorState): SchemaField[];
  read(state: EditorState): FormData;
  write(state: EditorState, data: FormData): void;
  /** Field label and helper translation keys, by field name. */
  labels: Record<string, string>;
  helpers?: Record<string, string>;
  helperIcons?: string[];
  optional?: {
    enabled(state: EditorState, name: string): boolean;
    set(state: EditorState, name: string, enabled: boolean): void;
  };
  /** Optional enable switch, shown above the form; also drives the nav status dot. */
  toggle?: {
    get(state: EditorState): boolean;
    set(state: EditorState, enabled: boolean): void;
    help?: string;
  };
  status?(state: EditorState): boolean;
  /** Adds a footer action that validates the alert with Home Assistant. */
  validate?: { label: string; success: string };
}

function mobileOptionsGroup(key: string): "general" | "android" | "ios" {
  return key === "mobile" ? "general" : key as "android" | "ios";
}

function writeOptions(target: FormData, data: FormData, fields: string[]): void {
  for (const name of fields) {
    if (!(name in data)) continue;
    const value = data[name];
    if (value === "" || value === null || value === undefined) delete target[name];
    else target[name] = value;
  }
}

function mobileSection(key: string, fields: SchemaField[], pushFields: string[] = []): EditorSection {
  const names = fields.map(field => field.name);
  const section: EditorSection = {
    key,
    title: `editor.mobile.${key}`,
    parent: "notification",
    embedded: key === "mobile",
    labels: Object.fromEntries(names.map(name => [name, `editor.mobile.${name}`])),
    helpers: Object.fromEntries(names.map(name => [name, `editor.mobile.${name}_help`])),
    schema: ({ alert, localize }) => fields.map(field => {
      const sound = (alert.notification.options.push as FormData | undefined)?.sound;
      if (field.name === "sound" && sound && typeof sound === "object") {
        return { ...field, selector: { object: {} } };
      }
      if ("text" in field.selector) {
        return { ...field, selector: { text: { ...(field.selector.text as Record<string, unknown>), placeholder: localize("editor.mobile.not_set") } } };
      }
      return field;
    }),
    read: ({ alert, mobileDrafts }) => {
      const data = alert.notification.options;
      const push = data.push as FormData | undefined;
      const group = mobileOptionsGroup(key);
      const savedSection = mobileDrafts?.[group];
      const savedValues = savedSection?.enabled === false ? savedSection.values : undefined;
      return Object.fromEntries(names.map(name => {
        if (savedValues) return [name, savedValues[name]];
        return [name, pushFields.includes(name) ? push?.[name] : data[name]];
      }));
    },
    write: ({ alert }, values) => {
      const data = { ...alert.notification.options };
      writeOptions(data, values, names.filter(name => !pushFields.includes(name)));
      if (pushFields.length) {
        const push = { ...data.push as FormData | undefined };
        writeOptions(push, values, pushFields);
        if (Object.keys(push).length) data.push = push;
        else delete data.push;
      }
      alert.notification.options = data;
    },
    optional: {
      enabled: (state, name) => {
        const saved = state.mobileDrafts?.[mobileOptionsGroup(key)]?.fields?.[name];
        const data = state.alert.notification.options;
        const target = pushFields.includes(name) ? data.push as FormData | undefined : data;
        return saved?.enabled ?? Boolean(target && Object.hasOwn(target, name));
      },
      set: (state, name, enabled) => {
        state.mobileDrafts ??= {};
        const group = state.mobileDrafts[mobileOptionsGroup(key)] ??= {};
        group.fields ??= {};
        const previous = group.fields[name];
        if (enabled) {
          section.write(state, { [name]: previous?.value ?? section.read(state)[name] });
          group.fields[name] = { enabled: true };
        } else {
          group.fields[name] = { enabled: false, value: section.read(state)[name] ?? previous?.value };
          section.write(state, { [name]: undefined });
        }
      },
    },
    status: ({ alert }) => {
      const data = alert.notification.options;
      const push = data.push as FormData | undefined;
      return names.some(name => {
        return pushFields.includes(name) ? Boolean(push && Object.hasOwn(push, name)) : Object.hasOwn(data, name);
      });
    },
  };
  if (key === "android" || key === "ios") {
    const configured = section.status;
    section.toggle = {
      get: state => state.mobileDrafts?.[key]?.enabled ?? Boolean(configured?.(state)),
      set: (state, enabled) => {
        state.mobileDrafts ??= {};
        const mobileOptions = state.mobileDrafts[key] ??= {};
        if (enabled) {
          const previousValues = mobileOptions.values;
          mobileOptions.enabled = true;
          mobileOptions.values = undefined;
          if (previousValues) section.write(state, previousValues);
        } else {
          mobileOptions.enabled = false;
          mobileOptions.values = section.read(state);
          section.write(state, Object.fromEntries(names.map(name => [name, undefined])));
        }
      },
      help: "editor.mobile.optional_help",
    };
  }
  delete section.status;
  return section;
}

const dropdown = (options: string[]) => ({ select: { mode: "dropdown", options } });

export const editorSections: EditorSection[] = [
  {
    key: "basic",
    title: "editor.basic.section",
    labels: { name: "editor.basic.name", description: "editor.basic.description", icon: "editor.basic.icon" },
    helpers: { description: "editor.basic.description_help" },
    schema: () => [
      { name: "name", selector: { text: {} }, required: true },
      { name: "description", selector: { text: { multiline: true } } },
      { name: "icon", selector: { icon: {} } },
    ],
    read: ({ alert }) => ({ name: alert.name, description: alert.description, icon: alert.icon }),
    write: ({ alert }, data) => Object.assign(alert, data),
  },
  {
    key: "when",
    title: "editor.triggers.section",
    localTitle: "editor.triggers.overview",
    labels: {
      automation_mode: "editor.basic.automation_mode",
    },
    helpers: {
      automation_mode: "editor.basic.automation_mode_help",
    },
    schema: (s) => [
      {
        name: "automation_mode",
        disabled: s.alert.monitor.conditions.items.length > 0,
        selector: {
          select: {
            mode: "dropdown",
            options: ["parallel", "single", "restart", "queued"].map((value) => ({ value, label: s.localize(`editor.basic.mode_${value}`) })),
          },
        },
      },
    ],
    read: ({ alert }) => ({
      automation_mode: alert.monitor.conditions.items.length ? "parallel" : alert.monitor.automation_mode || "parallel",
    }),
    write: ({ alert }, data) => {
      if (!alert.monitor.conditions.items.length) alert.monitor.automation_mode = data.automation_mode as EditableAlert["monitor"]["automation_mode"];
    },
  },
  {
    key: "triggers",
    title: "editor.triggers.custom",
    parent: "when",
    labels: { triggers: "editor.triggers.custom" },
    helpers: { triggers: "editor.triggers.help" },
    toggle: {
      get: ({ alert }) => alert.monitor.triggers.enabled,
      set: ({ alert }, enabled) => (alert.monitor.triggers.enabled = enabled),
      help: "editor.triggers.enable_help",
    },
    schema: () => [{ name: "triggers", selector: { trigger: {} } }],
    read: ({ alert }) => ({ triggers: alert.monitor.triggers.items }),
    write: ({ alert }, data) => {
      alert.monitor.triggers.items = (data.triggers as EditableAlert["monitor"]["triggers"]["items"]) ?? [];
    },
    validate: { label: "editor.common.validate_triggers", success: "panel.triggers_valid" },
  },
  {
    key: "conditions",
    title: "editor.conditions.section",
    parent: "when",
    labels: {
      startup: "editor.conditions.startup",
      periodic: "editor.conditions.interval_enabled",
      interval: "editor.conditions.interval",
      conditions: "editor.conditions.section",
    },
    helpers: { interval: "editor.conditions.interval_help", conditions: "editor.conditions.help" },
    toggle: {
      get: ({ alert }) => alert.monitor.conditions.enabled,
      set: ({ alert }, enabled) => (alert.monitor.conditions.enabled = enabled),
      help: "editor.conditions.enable_help",
    },
    schema: (s) => [
      { name: "startup", selector: { boolean: {} } },
      { name: "periodic", selector: { boolean: {} } },
      ...(s.alert.monitor.conditions.periodic ? [{ name: "interval", selector: { duration: { enable_day: true } } }] : []),
      { name: "conditions", selector: { condition: {} } },
    ],
    read: ({ alert }) => ({
      startup: alert.monitor.conditions.startup,
      periodic: alert.monitor.conditions.periodic,
      interval: toDuration(alert.monitor.conditions.interval),
      conditions: alert.monitor.conditions.items,
    }),
    write: ({ alert }, data) => {
      alert.monitor.conditions.items = (data.conditions as EditableAlert["monitor"]["conditions"]["items"]) ?? [];
      alert.monitor.conditions.startup = Boolean(data.startup);
      alert.monitor.conditions.periodic = Boolean(data.periodic);
      if (data.periodic) alert.monitor.conditions.interval = fromDuration(data.interval);
    },
    validate: { label: "editor.common.validate_conditions", success: "panel.condition_valid" },
  },
  {
    key: "inactive",
    title: "editor.inactive.section",
    parent: "when",
    labels: { triggers: "editor.triggers.custom", clear_notification: "editor.inactive.clear_notification" },
    helpers: { clear_notification: "editor.inactive.clear_notification_help" },
    helperIcons: ["clear_notification"],
    toggle: {
      get: ({ alert }) => alert.monitor.inactive.enabled,
      set: ({ alert }, enabled) => (alert.monitor.inactive.enabled = enabled),
      help: "editor.inactive.enable_help",
    },
    schema: () => [
      { name: "clear_notification", selector: { boolean: {} } },
      { name: "triggers", selector: { trigger: {} } },
    ],
    read: ({ alert }) => ({ triggers: alert.monitor.inactive.items, clear_notification: alert.monitor.inactive.clear_notification }),
    write: ({ alert }, data) => {
      alert.monitor.inactive.items = (data.triggers as EditableAlert["monitor"]["inactive"]["items"]) ?? [];
      alert.monitor.inactive.clear_notification = Boolean(data.clear_notification);
    },
  },
  {
    key: "recipients",
    title: "editor.recipients.section",
    labels: { target: "editor.recipients.section" },
    helpers: { target: "editor.recipients.service_help" },
    schema: () => [
      { name: "target", selector: { target: { entity: { domain: "notify" } } } },
    ],
    read: ({ alert }) => {
      const { user_id, ...target } = alert.notification.target;
      return { target };
    },
    write: ({ alert }, data) => {
      const users = alert.notification.target.user_id;
      alert.notification.target = {
        ...(data.target as object),
        ...(users?.length ? { user_id: users } : {}),
      };
    },
  },
  {
    key: "notification",
    title: "editor.notification.section",
    labels: { title: "editor.notification.title", message: "editor.notification.message", use_default_tag: "editor.notification.use_default_tag" },
    helpers: { message: "editor.notification.template_values_help", use_default_tag: "editor.notification.use_default_tag_help" },
    helperIcons: ["use_default_tag"],
    schema: ({ localize }) => [
      { name: "title", selector: { text: {} } },
      { name: "message", selector: { template: {} }, hideLabel: true, default: localize("editor.notification.message_placeholder") },
      { name: "use_default_tag", selector: { boolean: {} } },
    ],
    read: ({ alert }) => ({
      title: alert.notification.title,
      message: alert.notification.message,
      use_default_tag: alert.notification.use_default_tag,
    }),
    write: ({ alert }, data) => Object.assign(alert.notification, data),
  },
  {
    key: "postSendActions",
    title: "editor.notification.post_send_actions",
    parent: "notification",
    labels: { actions: "editor.notification.post_send_actions" },
    schema: () => [{ name: "actions", selector: { action: {} } }],
    read: ({ alert }) => ({ actions: alert.post_send_actions?.actions ?? [] }),
    write: ({ alert }, data) =>
      (alert.post_send_actions = { ...alert.post_send_actions, enabled: Boolean(alert.post_send_actions?.enabled), actions: data.actions as [] }),
    toggle: {
      get: ({ alert }) => Boolean(alert.post_send_actions?.enabled),
      set: ({ alert }, enabled) => (alert.post_send_actions = { ...alert.post_send_actions, enabled }),
      help: "editor.notification.post_send_help",
    },
  },
  mobileSection("mobile", [
    { name: "group", selector: { text: {} } },
    { name: "color", selector: { text: {} } },
    { name: "notification_icon", selector: { icon: {} } },
    { name: "icon_url", selector: { text: {} } },
  ]),
  mobileSection("android", [
    { name: "channel", selector: { text: {} } },
    { name: "importance", selector: dropdown(["min", "low", "default", "high", "max"]) },
    { name: "sticky", selector: { boolean: {} } },
    { name: "persistent", selector: { boolean: {} } },
    { name: "alert_once", selector: { boolean: {} } },
    { name: "clickAction", selector: { text: {} } },
    { name: "timeout", selector: { number: { min: 0, mode: "box", unit_of_measurement: "s" } } },
    { name: "visibility", selector: dropdown(["public", "private", "secret"]) },
    { name: "vibrationPattern", selector: { text: {} } },
    { name: "ledColor", selector: { text: {} } },
  ]),
  mobileSection("ios", [
    { name: "subtitle", selector: { text: {} } },
    { name: "url", selector: { text: {} } },
    { name: "interruption-level", selector: dropdown(["passive", "active", "time-sensitive", "critical"]) },
    { name: "sound", selector: { text: {} } },
    { name: "badge", selector: { number: { min: 0, mode: "box" } } },
    { name: "notification_icon_color", selector: { text: {} } },
    { name: "presentation_options", selector: { select: { multiple: true, options: ["alert", "badge", "sound"] } } },
  ], ["interruption-level", "sound", "badge"]),
  {
    key: "confirmation",
    title: "editor.confirmation.section",
    localTitle: "editor.confirmation.buttons",
    labels: {
      buttons: "editor.confirmation.button_label",
      forget_after_enabled: "editor.confirmation.enable_timeout",
      timeout: "editor.confirmation.timeout",
    },
    helpers: { forget_after_enabled: "editor.confirmation.timeout_help" },
    schema: (s) => [
      {
        name: "buttons",
        selector: {
          object: {
            multiple: true,
            label_field: "label",
            description_field: "id",
            fields: {
              label: { label: s.localize("editor.confirmation.button_label"), required: true, selector: { text: {} } },
              id: { label: s.localize("editor.confirmation.button_ids"), selector: { text: {} } },
            },
          },
        },
      },
      { name: "forget_after_enabled", selector: { boolean: {} } },
      ...(s.alert.confirmation.reminders.forget_after_enabled ? [{ name: "timeout", selector: { duration: { enable_day: true } } }] : []),
    ],
    read: ({ alert: { confirmation } }) => ({
      buttons: confirmation.buttons,
      forget_after_enabled: confirmation.reminders.forget_after_enabled === true,
      timeout: toDuration(confirmation.reminders.timeout),
    }),
    write: ({ alert: { confirmation } }, data) => {
      confirmation.buttons = (data.buttons as typeof confirmation.buttons) ?? [];
      confirmation.reminders.forget_after_enabled = Boolean(data.forget_after_enabled);
      if ("timeout" in data) confirmation.reminders.timeout = data.timeout as Record<string, number>;
    },
    toggle: {
      get: ({ alert }) => alert.confirmation.enabled,
      set: ({ alert }, enabled) => (alert.confirmation.enabled = enabled),
    },
  },
  {
    key: "reminder",
    title: "editor.confirmation.reminder.section",
    parent: "confirmation",
    labels: {
      interval: "editor.confirmation.reminder.remind_every",
      max_attempts: "editor.confirmation.reminder.maximum",
      show_attempts: "editor.confirmation.reminder.show_attempt_count",
    },
    schema: () => [
      { name: "interval", selector: { duration: { enable_day: true } } },
      { name: "max_attempts", selector: { number: { min: 1, max: 20, mode: "box" } } },
      { name: "show_attempts", selector: { boolean: {} } },
    ],
    read: ({ alert: { confirmation } }) => ({
      interval: toDuration(confirmation.reminders.interval),
      max_attempts: confirmation.reminders.max_attempts,
      show_attempts: confirmation.reminders.show_attempts === true,
    }),
    write: ({ alert: { confirmation } }, data) => Object.assign(confirmation.reminders, data),
    toggle: {
      get: ({ alert }) => alert.confirmation.reminders.enabled !== false,
      set: ({ alert }, enabled) => (alert.confirmation.reminders.enabled = enabled),
    },
    status: (s) => s.alert.confirmation.enabled && s.alert.confirmation.reminders.enabled !== false,
  },
  {
    key: "confirmationNotification",
    title: "editor.confirmation.notification.section",
    parent: "confirmation",
    labels: { message: "editor.confirmation.message", use_default_tag: "editor.notification.use_default_tag" },
    helpers: { use_default_tag: "editor.notification.use_default_tag_help" },
    helperIcons: ["use_default_tag"],
    schema: ({ localize }) => [
      { name: "message", selector: { template: {} }, hideLabel: true, default: localize("editor.confirmation.message") },
      { name: "use_default_tag", selector: { boolean: {} } },
    ],
    read: ({ alert }) => ({ message: alert.confirmation.notification.message, use_default_tag: alert.confirmation.notification.use_default_tag }),
    write: ({ alert }, data) => Object.assign(alert.confirmation.notification, data),
    toggle: {
      get: ({ alert }) => Boolean(alert.confirmation.notification.enabled),
      set: ({ alert }, enabled) => (alert.confirmation.notification.enabled = enabled),
      help: "editor.confirmation.notification.help",
    },
    status: (s) => s.alert.confirmation.enabled && Boolean(s.alert.confirmation.notification.enabled),
  },
  {
    key: "postConfirmationActions",
    title: "editor.confirmation.actions.section",
    parent: "confirmation",
    labels: { actions: "editor.confirmation.actions.section" },
    schema: () => [{ name: "actions", selector: { action: {} } }],
    read: ({ alert }) => ({ actions: alert.confirmation.actions }),
    write: ({ alert }, data) => (alert.confirmation.actions = (data.actions as []) ?? []),
    toggle: {
      get: (s) => s.postConfirmationActions,
      set: (s, enabled) => (s.postConfirmationActions = enabled),
      help: "editor.confirmation.actions.help",
    },
    status: (s) => s.alert.confirmation.enabled && s.postConfirmationActions,
  },
];

export function sectionStatus(section: EditorSection, state: EditorState): boolean | undefined {
  return section.status?.(state) ?? section.toggle?.get(state);
}

export function rootSection(key: string): EditorSection | undefined {
  const section = editorSections.find(section => section.key === key);
  if (!section?.parent) return section;
  const parent = editorSections.find(item => item.key === section.parent);
  return parent?.parent ? editorSections.find(item => item.key === parent.parent) : parent;
}
