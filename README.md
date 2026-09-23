# HA Notifications

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=FredrikM97&repository=ha-notifications&category=integration)

HA Notifications creates reliable, state-based alerts without a collection of
repetitive notification automations or external scripts. Define a condition,
choose the recipients, and optionally add confirmation, reminders, follow-up
actions, and history in one Home Assistant panel.

Alert history survives Home Assistant restarts. Active alert runtime state is
recreated from the current configuration when Home Assistant starts.

Use the **Add to HACS** button above to install the integration. HACS includes
the compiled frontend; no separate Lovelace resource is required. Restart Home
Assistant after installation.

<img width="1257" height="862" alt="HA Notifications alert editor" src="https://github.com/user-attachments/assets/b1ce380f-d098-4526-97f1-4ae0080b4cd0" />

<img width="1242" height="609" alt="HA Notifications history" src="https://github.com/user-attachments/assets/97ef8118-be42-48fc-b978-493ea7320a7f" />

## Lovelace card

The integration registers its compiled frontend with Home Assistant. In a
dashboard, choose **Add card**, select **HA Notifications**, and add it. The
card opens the same alert editor, history, and YAML interface as the sidebar
panel.

```yaml
type: custom:ha-notifications-card
```

## What it supports

Each alert can include:

- Visual or Jinja conditions, evaluated on state changes, at startup, or on an interval
- Multiple notification targets, including devices, areas, labels, entities, and services
- Optional confirmation actions, user attribution, completion notifications, and follow-up service calls
- Reminder retries with configurable intervals and attempt limits
- Delivery history across Home Assistant restarts; active runtime state is process-local
- YAML import/export using the same configuration model as the editor

## YAML

The editor and YAML view use the same canonical configuration shape. A minimal
alert looks like this:

```yaml
version: 1
alerts:
  - id: low_water
    name: Low water
    enabled: true
    monitor:
      on_change: true
      startup: true
      interval: 3600
    conditions:
      - type: template
        template: "{{ states('sensor.water_level') | float(100) < 20 }}"
    notification:
      target:
        device_id:
          - YOUR_DEVICE_ID
      title: Reminder
      message: Something needs your attention.
    confirmation:
      enabled: true
      buttons:
        - id: confirm
          label: Activity completed
      reminders:
        enabled: true
        interval: 1800
        max_attempts: 5
      actions:
        enabled: true
        items:
          - action: switch.turn_on
            target:
              entity_id: switch.water_pump_reset
```

Multiple conditions are combined with `AND`. Confirmation is configured at
the alert level, separately from the notification message and recipients.

## Development

See [docs/development.md](docs/development.md) for setup, validation, local
Home Assistant installation, and HACS packaging instructions. See
[docs/architecture.md](docs/architecture.md) for the source layout, feature
ownership, and runtime flow.
