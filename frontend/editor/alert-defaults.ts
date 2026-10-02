import type { Alert } from "../types.js";
import type { EditorMode } from "./types.js";

export function editorModeFor(_value: Alert): EditorMode {
  return "yaml";
}

export function defaultAlert(): Alert {
  return {
    id: `alert_${Date.now()}`,
    name: "",
    enabled: true,
    description: "",
    icon: "mdi:bell-outline",
    triggers: [],
    conditions: [],
    automation_mode: "parallel",
    notification: {
      target: {},
      data: { title: "", message: "" },
    },
    confirmation: {
      enabled: false,
      buttons: [{ id: "confirm", label: "Done" }],
      notification: {
        enabled: false,
        data: { message: "" },
      },
      reminders: {
        enabled: false,
        interval: "00:30:00",
        max_attempts: 5,
        show_attempts: false,
        forget_after_enabled: false,
        timeout: "00:15:00",
      },
      actions: [],
    },
  };
}