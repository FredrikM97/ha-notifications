export interface Hass {
  connection: {
    sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
  };
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

export type AlertConditionType = "template" | "state" | "numeric" | "attribute";

export interface AlertCondition {
  id?: string;
  type: AlertConditionType;
  template?: string;
  entity_id?: string | string[];
  attribute?: string;
  above?: string | number;
  below?: string | number;
  state?: string | string[];
  value?: string;
  for?: string | number | Record<string, number>;
  [key: string]: unknown;
}

export interface NotificationTarget {
  device_id?: string[];
  area_id?: string[];
  floor_id?: string[];
  label_id?: string[];
  entity_id?: string[];
  user_id?: string[];
}

export interface MonitorConfig {
  on_change: boolean;
  startup: boolean;
  interval?: string | number | Record<string, number>;
  clear_on_condition_change?: boolean;
  retention?: HistoryRetentionConfig;
}

export interface ConfirmationConfig {
  enabled: boolean;
  buttons: { id: string; label: string }[];
  notification: {
    enabled: boolean;
    message: string;
    clear: boolean;
  };
  reminders: {
    enabled: boolean;
    interval: string | number | Record<string, number>;
    max_attempts: number;
    show_attempts: boolean;
    timeout: string | number | Record<string, number>;
  };
  actions: {
    enabled: boolean;
    items?: Record<string, unknown>[];
  };
}

export interface NotificationConfig {
  target: NotificationTarget;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface PostSendActionsConfig {
  enabled: boolean;
  actions?: Record<string, unknown>[];
}

export interface RuntimeAlertEvent {
  event_id: string;
  timestamp: string;
  type: string;
  message: string;
  details: Record<string, unknown>;
}

export interface RuntimeAlertState {
  alert?: Alert;
  event?: RuntimeAlertEvent;
  active?: boolean;
  acknowledged?: boolean;
  confirmation?: {
    action_ids?: Record<string, string>;
    attempts?: number;
  };
  notification_id?: string;
  flow_id?: string;
  started_at?: string;
  last_evaluated?: string;
  last_notified?: string;
  confirmed_at?: string;
  confirmed_by?: string;
  last_error?: string;
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
  conditions: AlertCondition[];
  monitor: MonitorConfig;
  notification: NotificationConfig;
  confirmation?: ConfirmationConfig;
  post_send_actions?: PostSendActionsConfig;
  runtime?: RuntimeAlertState;
  [key: string]: unknown;
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
