export interface Hass {
  connection: {
    sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
  };
  navigate?(path: string): void;
  localize?(key: string, variables?: Record<string, unknown>): string;
  locale?: HassLocale;
  user?: {
    is_admin: boolean;
  };
}

export interface HassLocale {
  language: string;
  date_format: string;
  time_format: string;
}

export interface CanonicalCondition {
  condition: string;
  [key: string]: unknown;
}

export type AlertCondition = CanonicalCondition[];

export interface AlertRecovery {
  notification?: NotificationConfig;
  [key: string]: unknown;
}

export interface AutomationStatus {
  id?: string;
  ownership?: "managed" | "manual";
  status?: string;
  [key: string]: unknown;
}

export type AutomationStatusValue =
  | "managed"
  | "manual"
  | "missing"
  | "disabled"
  | "conflict";

export interface AutomationRuntimeStatus {
  status: AutomationStatusValue;
  enabled: boolean;
  last_triggered?: string | null;
}

export interface AlertsConfig {
  version: number;
  alerts: CanonicalAlert[];
}

export interface NotificationTarget {
  device_id?: string[];
  area_id?: string[];
  floor_id?: string[];
  label_id?: string[];
  entity_id?: string[];
  user_id?: string[];
}

export interface EvaluateConfig {
  on_change: boolean;
  startup: boolean;
  interval?: string | number | Record<string, number>;
  clear_on_inactive?: boolean;
  retention?: HistoryRetentionConfig;
}

export interface MonitorConfig {
  on_change?: boolean;
  startup?: boolean;
  interval?: number | string;
  clear_on_inactive?: boolean;
}

export interface ConfirmationConfig {
  enabled: boolean;
  buttons: { id?: string; label: string }[];
  notification: CanonicalNotification;
  reminders: {
    enabled: boolean;
    interval: string | number | Record<string, number>;
    max_attempts: number;
    show_attempts: boolean;
    forget_after_enabled: boolean;
    timeout: string | number | Record<string, number>;
  };
  actions: Record<string, unknown>[];
}

export interface NotificationConfig {
  target: NotificationTarget;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface CanonicalNotification {
  action?: string;
  target?: NotificationTarget;
  data: Record<string, unknown>;
}

export interface CanonicalRecovery {
  clear?: boolean;
  notification?: CanonicalNotification;
}

export interface CanonicalEvaluateConfig {
  on_change?: boolean;
  startup?: boolean;
  interval?: string | number | Record<string, unknown>;
}

export interface CanonicalAlert {
  id: string;
  name?: string | null;
  enabled?: boolean;
  conditions: CanonicalCondition[];
  monitor?: MonitorConfig | null;
  notification: CanonicalNotification;
  repeat?: Record<string, unknown> | null;
  recovery?: CanonicalRecovery | null;
  confirmation?: ConfirmationConfig | null;
  snooze?: Record<string, unknown> | null;
  escalation?: Record<string, unknown> | null;
  automation?: AutomationStatus;
}

export interface PostSendActionsConfig {
  enabled: boolean;
  actions?: Record<string, unknown>[];
}

export interface RuntimeEvent {
  event_id: string;
  timestamp: string;
  type: string;
  message: string;
  details: Record<string, unknown>;
  flow_id?: string;
}

export interface RuntimeState {
  active?: boolean;
  flow_id?: string;
  started_at?: string;
  last_evaluated?: string;
  last_notified?: string;
  last_error?: string;
  acknowledged?: boolean;
  confirmed_at?: string;
  confirmed_by?: string;
}

export interface AutomationRuntimeStatus {
  status: AutomationStatusValue;
  enabled: boolean;
  last_triggered?: string | null;
  mode: "single" | "restart" | "queued" | "parallel" | string;
  active_runs: number;
  active_runs_uncertain: boolean;
}

export interface RuntimeAlertState {
  config?: Alert;
  state?: RuntimeState;
  trace?: Record<string, unknown>[];
}

export interface RuntimeAlertHistoryEntry extends RuntimeAlertState {
  event: RuntimeEvent;
}

export interface HistoryRetentionConfig {
  enabled?: boolean;
  days?: number;
}

export interface Alert {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  conditions: AlertCondition;
  monitor?: MonitorConfig | null;
  notification: CanonicalNotification;
  confirmation?: ConfirmationConfig;
  post_send_actions?: PostSendActionsConfig;
  runtime?: RuntimeAlertState;
}

export interface Registries {
  entities: RegistryEntity[];
  devices: RegistryDevice[];
  areas: RegistryArea[];
  labels: RegistryLabel[];
  floors: RegistryFloor[];
  users: RegistryUser[];
}

export interface RegistryEntity {
  entity_id: string;
  friendly_name?: string;
  name?: string;
  name_by_user?: string;
  original_name?: string;
}

export interface RegistryState {
  entity_id: string;
  attributes?: {
    friendly_name?: string;
    [key: string]: unknown;
  };
}

export interface RegistryDevice {
  id: string;
  name?: string;
  name_by_user?: string;
}

export interface RegistryArea {
  id?: string;
  area_id?: string;
  name?: string;
}

export interface RegistryLabel {
  id?: string;
  label_id?: string;
  name?: string;
}

export interface RegistryFloor {
  id?: string;
  floor_id?: string;
  name?: string;
}

export interface RegistryUser {
  id: string;
  name: string;
  is_active?: boolean;
}
