/**
 * Editor sections as data. Each section is an ha-form schema plus a mapping
 * between the alert and the form; the editor renders all of them the same way.
 */
import type { Hass } from "../types.js";
import type { Localize } from "../localize.js";
import {
  customTriggers,
  fromDuration,
  hasStartupTrigger,
  intervalSeconds,
  intervalTrigger,
  setTriggers,
  toDuration,
  type EditableAlert,
} from "./alert-model.js";

type FormData = Record<string, unknown>;

export interface SchemaField {
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
}

export interface EditorSection {
  key: string;
  /** Translation key for the section title. */
  title: string;
  parent?: string;
  schema(state: EditorState): SchemaField[];
  read(state: EditorState): FormData;
  write(state: EditorState, data: FormData): void;
  /** Field label and helper translation keys, by field name. */
  labels: Record<string, string>;
  helpers?: Record<string, string>;
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

const text = { text: {} };
const multiline = { text: { multiline: true } };
const bool = { boolean: {} };
const duration = { duration: { enable_day: true } };
const template = { template: {} };
const actions = { action: {} };

const MODES = ["parallel", "single", "restart", "queued"];

const confirmed = (s: EditorState) => Boolean(s.alert.confirmation.enabled);

function notificationData(alert: EditableAlert): FormData {
  return alert.notification.data;
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
    parent: key === "mobile" ? undefined : "mobile",
    labels: Object.fromEntries(names.map(name => [name, `editor.mobile.${name}`])),
    helpers: Object.fromEntries(names.map(name => [name, `editor.mobile.${name}_help`])),
    schema: ({ alert }) => fields.map(field => {
      const sound = (notificationData(alert).push as FormData | undefined)?.sound;
      return field.name === "sound" && sound && typeof sound === "object"
        ? { ...field, selector: { object: {} } }
        : field;
    }),
    read: ({ alert }) => {
      const data = notificationData(alert);
      const push = data.push as FormData | undefined;
      return Object.fromEntries(names.map(name => [name, pushFields.includes(name) ? push?.[name] : data[name]]));
    },
    write: ({ alert }, values) => {
      const data = { ...notificationData(alert) };
      writeOptions(data, values, names.filter(name => !pushFields.includes(name)));
      if (pushFields.length) {
        const push = { ...data.push as FormData | undefined };
        writeOptions(push, values, pushFields);
        if (Object.keys(push).length) data.push = push;
        else delete data.push;
      }
      alert.notification.data = data;
    },
    optional: {
      enabled: (state, name) => {
        const saved = state.alert.notification.editor_options?.fields?.[`${key}.${name}`];
        const value = section.read(state)[name];
        return saved?.enabled ?? (value !== undefined && value !== null && value !== "");
      },
      set: (state, name, enabled) => {
        const notification = state.alert.notification;
        notification.editor_options ??= {};
        const options = notification.editor_options.fields ??= {};
        const optionKey = `${key}.${name}`;
        const previous = options[optionKey];
        if (enabled) {
          section.write(state, { [name]: previous?.value ?? section.read(state)[name] });
          options[optionKey] = { enabled: true };
        } else {
          options[optionKey] = { enabled: false, value: section.read(state)[name] ?? previous?.value };
          section.write(state, { [name]: undefined });
        }
      },
    },
    status: ({ alert }) => {
      const data = notificationData(alert);
      const push = data.push as FormData | undefined;
      return names.some(name => {
        const value = pushFields.includes(name) ? push?.[name] : data[name];
        return value !== undefined && value !== null && value !== "";
      });
    },
  };
  if (key === "android" || key === "ios") {
    const configured = section.status;
    section.toggle = {
      get: state => state.alert.notification.editor_options?.sections?.[key]?.enabled ?? Boolean(configured?.(state)),
      set: (state, enabled) => {
        const metadata = state.alert.notification.editor_options ??= {};
        const sections = metadata.sections ??= {};
        if (enabled) {
          const previous = sections[key];
          if (previous) section.write(state, previous.values);
          sections[key] = { enabled: true, values: {} };
        } else {
          sections[key] = { enabled: false, values: section.read(state) };
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
      { name: "name", selector: text, required: true },
      { name: "description", selector: multiline },
      { name: "icon", selector: { icon: {} } },
    ],
    read: ({ alert }) => ({ name: alert.name, description: alert.description, icon: alert.icon }),
    write: ({ alert }, data) => Object.assign(alert, data),
  },
  {
    key: "when",
    title: "editor.triggers.section",
    labels: {
      cancel_on_inactive: "editor.triggers.cancel_on_inactive",
      automation_mode: "editor.basic.automation_mode",
    },
    helpers: {
      cancel_on_inactive: "editor.triggers.cancel_on_inactive_help",
      automation_mode: "editor.basic.automation_mode_help",
    },
    schema: (s) => [
      { name: "cancel_on_inactive", selector: bool },
      {
        name: "automation_mode",
        disabled: s.alert.conditions.length > 0,
        selector: {
          select: {
            mode: "dropdown",
            options: MODES.map((value) => ({ value, label: s.localize(`editor.basic.mode_${value}`) })),
          },
        },
      },
    ],
    read: ({ alert }) => ({
      cancel_on_inactive: alert.cancel_on_inactive === true,
      automation_mode: alert.conditions.length ? "parallel" : alert.automation_mode || "parallel",
    }),
    write: ({ alert }, data) => {
      alert.cancel_on_inactive = Boolean(data.cancel_on_inactive);
      if (!alert.conditions.length) alert.automation_mode = data.automation_mode as EditableAlert["automation_mode"];
    },
  },
  {
    key: "triggers",
    title: "editor.triggers.custom",
    parent: "when",
    labels: { on_condition_change: "editor.triggers.on_condition_change", triggers: "editor.triggers.custom" },
    helpers: { on_condition_change: "editor.triggers.on_condition_change_help", triggers: "editor.triggers.help" },
    schema: () => [
      { name: "on_condition_change", selector: bool },
      { name: "triggers", selector: { trigger: {} } },
    ],
    read: ({ alert }) => ({
      on_condition_change: alert.on_condition_change === true,
      triggers: customTriggers(alert.triggers),
    }),
    write: ({ alert }, data) => {
      alert.on_condition_change = Boolean(data.on_condition_change);
      const interval = intervalTrigger(alert.triggers);
      setTriggers(
        alert,
        (data.triggers as EditableAlert["triggers"]) ?? [],
        hasStartupTrigger(alert.triggers),
        interval ? intervalSeconds(interval) : null,
      );
    },
    status: ({ alert }) => alert.on_condition_change === true || customTriggers(alert.triggers).length > 0,
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
    schema: (s) => [
      { name: "startup", selector: bool },
      { name: "periodic", selector: bool },
      ...(intervalTrigger(s.alert.triggers) ? [{ name: "interval", selector: duration }] : []),
      { name: "conditions", selector: { condition: {} } },
    ],
    read: ({ alert }) => {
      const interval = intervalTrigger(alert.triggers);
      return {
        startup: hasStartupTrigger(alert.triggers),
        periodic: Boolean(interval),
        interval: toDuration(intervalSeconds(interval)),
        conditions: alert.conditions,
      };
    },
    write: ({ alert }, data) => {
      alert.conditions = (data.conditions as EditableAlert["conditions"]) ?? [];
      setTriggers(
        alert,
        customTriggers(alert.triggers),
        Boolean(data.startup),
        data.periodic ? fromDuration(data.interval) : null,
      );
    },
    status: ({ alert }) =>
      hasStartupTrigger(alert.triggers) ||
      Boolean(intervalTrigger(alert.triggers)),
    validate: { label: "editor.common.validate_conditions", success: "panel.condition_valid" },
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
    labels: { title: "editor.notification.title", message: "editor.notification.message" },
    helpers: { message: "editor.notification.template_values_help" },
    schema: () => [
      { name: "title", selector: text },
      { name: "message", selector: template },
    ],
    read: ({ alert }) => ({
      title: String(alert.notification.data.title ?? ""),
      message: String(alert.notification.data.message ?? ""),
    }),
    write: ({ alert }, data) => Object.assign(alert.notification.data, data),
  },
  {
    key: "postSendActions",
    title: "editor.notification.post_send_actions",
    parent: "notification",
    labels: { actions: "editor.notification.post_send_actions" },
    schema: () => [{ name: "actions", selector: actions }],
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
    { name: "group", selector: text },
    { name: "tag", selector: text },
    { name: "color", selector: text },
    { name: "notification_icon", selector: { icon: {} } },
    { name: "icon_url", selector: text },
  ]),
  mobileSection("android", [
    { name: "channel", selector: text },
    { name: "importance", selector: dropdown(["min", "low", "default", "high", "max"]) },
    { name: "sticky", selector: bool },
    { name: "persistent", selector: bool },
    { name: "alert_once", selector: bool },
    { name: "subject", selector: text },
    { name: "clickAction", selector: text },
    { name: "timeout", selector: { number: { min: 0, mode: "box", unit_of_measurement: "s" } } },
    { name: "visibility", selector: dropdown(["public", "private", "secret"]) },
    { name: "vibrationPattern", selector: text },
    { name: "ledColor", selector: text },
  ]),
  mobileSection("ios", [
    { name: "subtitle", selector: text },
    { name: "url", selector: text },
    { name: "interruption-level", selector: dropdown(["passive", "active", "time-sensitive", "critical"]) },
    { name: "sound", selector: text },
    { name: "badge", selector: { number: { min: 0, mode: "box" } } },
    { name: "notification_icon_color", selector: text },
    { name: "presentation_options", selector: { select: { multiple: true, options: ["alert", "badge", "sound"] } } },
  ], ["interruption-level", "sound", "badge"]),
  {
    key: "confirmation",
    title: "editor.confirmation.section",
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
              label: { label: s.localize("editor.confirmation.button_label"), required: true, selector: text },
              id: { label: s.localize("editor.confirmation.button_ids"), selector: text },
            },
          },
        },
      },
      { name: "forget_after_enabled", selector: bool },
      ...(s.alert.confirmation.reminders.forget_after_enabled ? [{ name: "timeout", selector: duration }] : []),
    ],
    read: ({ alert: { confirmation } }) => ({
      buttons: confirmation.buttons,
      forget_after_enabled: confirmation.reminders.forget_after_enabled === true,
      timeout: toDuration(confirmation.reminders.timeout, 900),
    }),
    write: ({ alert: { confirmation } }, data) => {
      confirmation.buttons = (data.buttons as typeof confirmation.buttons) ?? [];
      confirmation.reminders.forget_after_enabled = Boolean(data.forget_after_enabled);
      confirmation.reminders.timeout = data.timeout as Record<string, number>;
    },
    toggle: {
      get: confirmed,
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
      { name: "interval", selector: duration },
      { name: "max_attempts", selector: { number: { min: 1, max: 20, mode: "box" } } },
      { name: "show_attempts", selector: bool },
    ],
    read: ({ alert: { confirmation } }) => ({
      interval: toDuration(confirmation.reminders.interval, 1800),
      max_attempts: confirmation.reminders.max_attempts || 5,
      show_attempts: confirmation.reminders.show_attempts === true,
    }),
    write: ({ alert: { confirmation } }, data) => Object.assign(confirmation.reminders, data),
    toggle: {
      get: ({ alert }) => alert.confirmation.reminders.enabled !== false,
      set: ({ alert }, enabled) => (alert.confirmation.reminders.enabled = enabled),
    },
    status: (s) => confirmed(s) && s.alert.confirmation.reminders.enabled !== false,
  },
  {
    key: "confirmationNotification",
    title: "editor.confirmation.notification.section",
    parent: "confirmation",
    labels: { message: "editor.confirmation.message" },
    schema: () => [{ name: "message", selector: template }],
    read: ({ alert }) => ({ message: String(alert.confirmation.notification.data.message ?? "") }),
    write: ({ alert }, data) => (alert.confirmation.notification.data.message = data.message),
    toggle: {
      get: ({ alert }) => Boolean(alert.confirmation.notification.enabled),
      set: ({ alert }, enabled) => (alert.confirmation.notification.enabled = enabled),
      help: "editor.confirmation.notification.help",
    },
    status: (s) => confirmed(s) && Boolean(s.alert.confirmation.notification.enabled),
  },
  {
    key: "postConfirmationActions",
    title: "editor.confirmation.actions.section",
    parent: "confirmation",
    labels: { actions: "editor.confirmation.actions.section" },
    schema: () => [{ name: "actions", selector: actions }],
    read: ({ alert }) => ({ actions: alert.confirmation.actions }),
    write: ({ alert }, data) => (alert.confirmation.actions = (data.actions as []) ?? []),
    toggle: {
      get: (s) => s.postConfirmationActions,
      set: (s, enabled) => (s.postConfirmationActions = enabled),
      help: "editor.confirmation.actions.help",
    },
    status: (s) => confirmed(s) && s.postConfirmationActions,
  },
];

export function sectionStatus(section: EditorSection, state: EditorState): boolean | undefined {
  return section.status?.(state) ?? section.toggle?.get(state);
}
