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

export interface ConfirmationConfig {
  enabled: boolean;
  button: string;
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
  ttl?: boolean;
  data?: Record<string, unknown>;
}

export interface PostSendActionsConfig {
  enabled: boolean;
  actions?: Record<string, unknown>[];
}

export interface RuntimeAlertState {
  active?: boolean;
  attempts?: number;
  last_notified?: string;
  last_event?: Record<string, unknown>;
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
  monitor: {
    on_change: boolean;
    startup: boolean;
    interval?: string | number | Record<string, number>;
    retention?: HistoryRetentionConfig;
  };
  notification: NotificationConfig;
  confirmation?: ConfirmationConfig;
  post_send_actions?: PostSendActionsConfig;
  runtime?: RuntimeAlertState;
  [key: string]: unknown;
}

export interface HistoryEntry {
  alert_id?: string;
  flow_id?: string;
  timestamp?: string;
  alert_name?: string;
  type?: string;
  message?: string;
  details?: Record<string, unknown>;
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
