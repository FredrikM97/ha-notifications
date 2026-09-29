# HA Notifications

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=FredrikM97&repository=ha-notifications&category=integration)

HA Notifications stores alert definitions and generates one managed Home
Assistant automation for each alert. Home Assistant owns triggers, conditions,
templates, durations, delays, repeats, and automation execution. HA
Notifications owns notification delivery. Notification history is not currently
persisted by the backend; its retention and storage contract remains an open
product decision.

Use the **Add to HACS** button above to install the integration. HACS includes
the compiled frontend; no separate Lovelace resource is required. Restart Home
Assistant after installation.

<img width="1257" height="862" alt="HA Notifications alert editor" src="https://github.com/user-attachments/assets/b1ce380f-d098-4526-97f1-4ae0080b4cd0" />

## Lovelace card

The integration registers its compiled frontend with Home Assistant. In a
dashboard, choose **Add card**, select **HA Notifications**, and add it. The
card opens the same alert editor and YAML interface as the sidebar panel.

```yaml
type: custom:ha-notifications-card
```

## What it supports

Each alert can define:

- Native Home Assistant triggers and conditions, evaluated on state changes, at startup, or on an interval
- Notification action, target, and service data passed to `ha_notifications.send`
- Native Home Assistant delays, repeats, confirmations, recovery, and escalation
- YAML import/export using the same configuration model as the editor

## YAML

The editor and YAML view use the same canonical configuration shape. Alert
configuration is the source of truth; the generated automation is derived and
can be recreated from it. A minimal alert looks like this:

```yaml
version: 1
alerts:
  - id: low_water
    name: Low water
    evaluate:
      on_change: true
      startup: true
      interval:
        hours: 1
    condition:
      condition: numeric_state
      entity_id: sensor.water_level
      below: 20
    notification:
      action: notify.mobile_app_phone
      target:
        entity_id: YOUR_DEVICE_ID
      data:
        title: Low water
        message: Something needs your attention.
    recovery:
      clear: false
      notification:
        action: notify.mobile_app_phone
        target:
          entity_id: YOUR_DEVICE_ID
        data:
          title: Water level recovered
          message: The water level is back to normal.
    confirmation:
      enabled: true
      buttons:
        - id: confirm
          label: Confirm
      reminders:
        enabled: true
        interval:
          minutes: 15
        max_attempts: 5
      follow_up:
        notification:
          action: notify.mobile_app_phone
          data:
            message: Confirmation received.
    automation:
      ownership: managed
```

`condition` contains native Home Assistant condition syntax and may use nested
`and`, `or`, `not`, template, state, numeric-state, time, device, or event
conditions. Templates remain unevaluated in the integration and are rendered
by Home Assistant when the generated automation runs. `repeat`, confirmation,
reminders, follow-up actions, and escalation use native automation actions and
triggers when configured. A confirmation button is handled through the native
`mobile_app_notification_action` event and can run a follow-up notification or
native Home Assistant actions. Resolving means the evaluated condition is back
to normal; it is separate from confirmation. Resolving does nothing by
default. When configured, `recovery.notification` sends an optional recovery
delivery, and `recovery.clear: true` clears the active notification.

Confirmation waits, reminder delays, and recovery edge detection are owned by
the generated automation. In-flight waits and edge state are not durable
across Home Assistant restart or automation reload in this release.

The `automation` block is an explicit reconciliation policy: `managed` is the
default, while `manual` opts an automation out of future updates. The generated
ID is stable and derived as `ha_notifications_<alert id>`. Alert IDs must start with
a lowercase letter and contain only lowercase letters, digits, and underscores;
generated trigger,
condition, and action details are not a second persisted source of truth.

The rewrite uses this schema as the single canonical contract. Existing
configurations using the retired `monitor` or custom `conditions` shape must be
converted by the migration path; the integration does not maintain legacy
aliases indefinitely.

Generated automations are managed by HA Notifications by default. Missing
automations can be recreated, while disabled automations are reported and are
not silently re-enabled. Users who need to edit one manually must convert it to
`automation.ownership: manual`; manual automations are no longer reconciled by
the integration.

Add the generated automation include to Home Assistant's `configuration.yaml`:

```yaml
automation ha_notifications: !include ha_notifications_automations.yaml
```

This named automation entry is unique to HA Notifications and can coexist with
your other automation configuration.

The integration owns that dedicated file and does not modify Home Assistant's
default `automations.yaml`. On first installation, Home Assistant must be
restarted after the integration adds the include so the new configuration is
loaded.

## Development

See [docs/development.md](docs/development.md) for setup, validation, local
Home Assistant installation, and HACS packaging instructions.
