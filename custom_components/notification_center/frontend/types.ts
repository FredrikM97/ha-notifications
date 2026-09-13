export interface Hass {
  connection: {
    sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
  };
  user?: {
    is_admin: boolean;
  };
}

export type AlertConditionType = "template" | "state" | "numeric" | "attribute";

export interface AlertCondition {
  type: AlertConditionType;
  template?: string;
  entity_id?: string | string[];
  attribute?: string;
  above?: string | number;
  below?: string | number;
  state?: string | string[];
  value?: string;
  for?: string | Record<string, number>;
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
  completion_message: string;
  notify_on_confirmation: boolean;
  confirmation_message: string;
  clear_on_confirmation: boolean;
  resend_interval: string | Record<string, number>;
  max_attempts: number;
  actions_enabled: boolean;
  actions?: Record<string, unknown>[];
}

export interface NotificationConfig {
  action: string;
  target: NotificationTarget;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  repeat?: {
    interval?: string | Record<string, number>;
    max_attempts?: number;
    enabled?: boolean;
    [key: string]: unknown;
  };
  actions_enabled: boolean;
  actions?: Record<string, unknown>[];
  confirmation: ConfirmationConfig;
}

export interface RuntimeAlertState {
  active?: boolean;
  last_notified?: string;
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
    interval?: string | Record<string, number>;
  };
  notification: NotificationConfig;
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
