import type { Hass } from "./types.js";

const DOMAIN = "ha_notifications";

export async function request<Response = unknown>(
  hass: Hass,
  endpoint: string,
  payload: Record<string, unknown> = {},
): Promise<Response> {
  const type = endpoint.includes("/") ? endpoint : `${DOMAIN}/${endpoint}`;
  try {
    return await hass.callWS<Response>({
      ...payload,
      type,
    });
  } catch (error) {
    throw new Error(`${type}: ${errorMessage(error)}`);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const value = error as Record<string, unknown>;
    const nestedError = value.error as Record<string, unknown> | undefined;
    const details = value.details as Record<string, unknown> | undefined;
    return String(
      nestedError?.message || details?.message || value.message || error,
    );
  }

  return String(error);
}

