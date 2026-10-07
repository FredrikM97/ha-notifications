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

type HaConfig = Record<string, unknown>;
type Duration = string | number | Record<string, number>;

/** HA service target plus `user_id`, which the integration resolves to mobile devices. */
export type NotificationTarget = HassServiceTarget & { user_id?: string[] };

export interface Notification {
  action?: string;
  target?: NotificationTarget;
  title: string;
  message: string;
  use_default_tag?: boolean;
  options: Record<string, unknown>;
}

export interface EnabledFeature {
  enabled: boolean;
}

export interface MonitorConfig {
  automation_mode: "single" | "restart" | "queued" | "parallel";
  triggers: EnabledFeature & {
    items: HaConfig[];
  };
  conditions: EnabledFeature & {
    items: HaConfig[];
    startup: boolean;
    periodic: boolean;
    interval?: Duration;
  };
  inactive: EnabledFeature & {
    items: HaConfig[];
    clear_notification: boolean;
  };
}

export interface ConfirmationConfig {
  enabled: boolean;
  buttons: { id?: string; label: string }[];
  notification: Notification & { enabled?: boolean };
  reminders: {
    enabled: boolean;
    interval: Duration;
    max_attempts: number;
    show_attempts: boolean;
    forget_after_enabled: boolean;
    timeout: Duration;
  };
  actions: HaConfig[];
}

/** One alert, as stored in the integration's canonical configuration. */
export interface Alert {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  monitor: MonitorConfig;
  notification: Notification & { target: NotificationTarget };
  confirmation?: ConfirmationConfig;
  post_send_actions?: { enabled: boolean; actions?: HaConfig[] };
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
    details: Record<string, unknown>;
    flow_id?: string;
  };
}
