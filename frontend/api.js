const DOMAIN = "notification_center";

export async function call(hass, command, data = {}) {
  return hass.connection.sendMessagePromise({
    type: `${DOMAIN}/${command}`,
    ...data,
  });
}

async function callRegistry(hass, type) {
  try {
    return await hass.connection.sendMessagePromise({
      type,
    });
  } catch (_err) {
    return [];
  }
}

export async function loadRegistries(hass) {
  const [
    entities,
    devices,
    areas,
    labels,
    floors,
  ] = await Promise.all([
    callRegistry(
      hass,
      "config/entity_registry/list",
    ),
    callRegistry(
      hass,
      "config/device_registry/list",
    ),
    callRegistry(
      hass,
      "config/area_registry/list",
    ),
    callRegistry(
      hass,
      "config/label_registry/list",
    ),
    callRegistry(
      hass,
      "config/floor_registry/list",
    ),
  ]);

  return {
    entities,
    devices,
    areas,
    labels,
    floors,
  };
}

export async function getAlerts(hass) {
  return call(hass, "list");
}

export async function saveAlert(hass, alert) {
  return call(hass, "save", {
    alert,
  });
}

export async function deleteAlert(hass, alertId) {
  return call(hass, "delete", {
    alert_id: alertId,
  });
}

export async function testAlert(hass, alertId) {
  return call(hass, "test", {
    alert_id: alertId,
  });
}

export async function getHistory(
  hass,
  alertId = null,
  limit = 100,
) {
  return call(hass, "history", {
    ...(alertId
      ? { alert_id: alertId }
      : {}),
    limit,
  });
}

export async function getYaml(hass) {
  return call(hass, "get_yaml");
}

export async function saveYaml(hass, yaml) {
  return call(hass, "save_yaml", {
    yaml,
  });
}

export async function reload(hass) {
  return call(hass, "reload");
}