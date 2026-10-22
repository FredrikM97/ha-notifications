import type { Hass } from "./types.js";

const DOMAIN = "ha_notifications";

export async function request<Response = unknown>(
  hass: Hass,
  endpoint: string,
  payload: Record<string, unknown> = {},
): Promise<Response> {
  const type = endpoint.includes("/") ? endpoint : `${DOMAIN}/${endpoint}`;
  return requestWebsocket<Response>(hass, type, payload);
}

export async function requestWebsocket<Response = unknown>(
  hass: Hass,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<Response> {
  try {
    return await hass.callWS<Response>({
      ...payload,
      type,
    });
  } catch (error) {
    throw new Error(`${type}: ${errorMessage(error)}`, { cause: error });
  }
}

export async function requestApi<Response = unknown>(
  hass: Hass,
  method: string,
  endpoint: string,
  payload?: Record<string, unknown>,
): Promise<Response> {
  try {
    return await hass.callApi<Response>(method, endpoint, payload);
  } catch (error) {
    throw new Error(`${method} ${endpoint}: ${errorMessage(error)}`, {
      cause: error,
    });
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
    const body = value.body as Record<string, unknown> | undefined;
    return String(
      nestedError?.message ||
        details?.message ||
        body?.message ||
        value.message ||
        value.error ||
        error,
    );
  }

  return String(error);
}

export function isAdmin(hass: Hass | null | undefined): boolean {
  return hass?.user?.is_admin === true;
}

/** Return the transport error wrapped by `request`, `requestWebsocket`, or `requestApi`. */
export function errorCause(error: unknown): Record<string, unknown> {
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === "object" && cause !== null
    ? (cause as Record<string, unknown>)
    : {};
}
