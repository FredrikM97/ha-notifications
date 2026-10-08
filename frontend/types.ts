/**
 * Frontend contracts for the HA Notifications config and websocket API.
 * Home Assistant shapes come from `home-assistant-js-websocket`, HA's own types.
 */
import type { HassServiceTarget } from "home-assistant-js-websocket";

/** The subset of HA's frontend `hass` object this panel uses. */
export interface Hass {
  callWS<Response>(message: Record<string, unknown>): Promise<Response>;
  localize?(key: string, variables?: Record<string, unknown>): string;
  loadFragmentTranslation?(fragment: string): Promise<void>;
  locale?: HassLocale;
  user?: { is_admin: boolean };
}

export interface HassLocale {
  language: string;
  date_format: string;
  time_format: string;
}

/** Native HA passthrough fields; Home Assistant validators own their semantics. */
export interface HaConfig {
  [key: string]: unknown;
}

export interface DurationParts {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

export type DurationValue = string | number | DurationParts;
export type AutomationMode = "single" | "restart" | "queued" | "parallel";

/** HA service target plus `user_id`, which the integration resolves to mobile devices. */
export interface NotificationTarget extends HassServiceTarget {
  user_id?: string[];
}

export interface NotificationOptionControl {
  enabled: boolean;
  fields: Record<string, boolean>;
}

export interface NotificationOptionControls {
  mobile?: NotificationOptionControl;
  android?: NotificationOptionControl;
  ios?: NotificationOptionControl;
}

export interface Notification {
  /** Follow-up delivery switch; main notification enablement belongs to the alert. */
  enabled?: boolean;
  action?: string;
  target?: NotificationTarget;
  title: string;
  message: string;
  use_default_tag?: boolean;
  options: HaConfig;
  option_controls?: NotificationOptionControls;
}

export interface TriggerConfig {
  enabled: boolean;
  items: HaConfig[];
}

export interface IntervalConfig {
  enabled: boolean;
  value: DurationValue;
}

export interface ConditionConfig {
  enabled: boolean;
  items: HaConfig[];
  startup: boolean;
  interval: IntervalConfig;
}

export interface InactiveConfig {
  enabled: boolean;
  items: HaConfig[];
  clear_notification: boolean;
}

export interface MonitorConfig {
  automation_mode: AutomationMode;
  triggers: TriggerConfig;
  conditions: ConditionConfig;
  inactive: InactiveConfig;
}

export interface ConfirmationButton {
  id?: string;
  label: string;
}

export interface ReminderConfig {
  enabled: boolean;
  interval: DurationValue;
  max_attempts: number;
  show_attempts: boolean;
  forget_after: IntervalConfig;
}

export interface ActionsConfig {
  enabled: boolean;
  items: HaConfig[];
}

export interface ConfirmationConfig {
  enabled: boolean;
  buttons: ConfirmationButton[];
  notification: Notification;
  reminders: ReminderConfig;
  actions: ActionsConfig;
}

/** One alert, as stored in the integration's canonical configuration. */
export interface Alert {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  monitor: MonitorConfig;
  notification: Notification;
  confirmation?: ConfirmationConfig;
  post_send_actions?: ActionsConfig;
  runtime?: unknown;
}

export interface AlertsConfig {
  version: number;
  alerts: Alert[];
}

export interface AutomationRuntimeStatus {
  status: "managed" | "missing" | "disabled" | "conflict";
  enabled: boolean;
  mode: string;
  current: number;
  running?: boolean;
  triggered?: boolean;
  notification_active?: boolean;
  automation_id?: string;
}

export interface RuntimeAlertHistoryEntry {
  config?: { id: string; name: string };
  event: {
    event_id: string;
    timestamp: string;
    type: string;
    message: string;
    details: HaConfig;
    flow_id?: string;
  };
}
