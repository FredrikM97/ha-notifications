import type { Alert } from "../types.js";

export function confirmationNotificationEnabled(
  notification: NonNullable<Alert["confirmation"]>["notification"],
): boolean {
  if (typeof notification.enabled === "boolean") return notification.enabled;
  return Boolean(
    notification.action ||
      notification.target !== undefined ||
      notification.title !== undefined ||
      notification.message !== undefined ||
      notification.data !== undefined,
  );
}