# HA Notifications

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=FredrikM97&repository=ha-notifications&category=integration)

Create actionable notifications using Home Assistant's native triggers,
conditions, templates, and actions. Configure recipients, confirmation buttons,
reminders, and follow-up actions in one panel. The integration generates and
maintains the automations for you.

<img width="1257" height="862" alt="HA Notifications alert editor" src="https://github.com/user-attachments/assets/b1ce380f-d098-4526-97f1-4ae0080b4cd0" />

## Installation

1. Install **HA Notifications** through HACS and restart Home Assistant.
2. Add **HA Notifications** under **Settings > Devices & services**.
3. Open the sidebar panel and create an alert.

First setup adds an automation include to `configuration.yaml`; restart once
afterwards to load it. Your own `automations.yaml` is left untouched.

## Using the Panel

- **Alerts:** create, edit, enable, or disable alerts; open their automations or
  history, test the saved action flow, and cancel active runs.
- **Active:** alerts with automation runs currently in progress.
- **History:** searchable events, optionally grouped into collapsed runs with
  latest-activity timestamps.
- **YAML:** edit, validate, and save the complete configuration.

Choose when an alert runs, its recipients, and its message. Conditions,
confirmation, reminders, and Android/iOS options are optional. **Inactive**
triggers explicitly cancel pending confirmation waits and can also clear the
notification; no opposite-state triggers are inferred.

To use the panel as a dashboard card:

```yaml
type: custom:ha-notifications-card
```

## Configuration Example

The editor and YAML view use the same configuration. Replace the entity and
recipient target below with your own:

```yaml
version: 1
alerts:
  - id: freezer_open
    name: Freezer door open
    monitor:
      automation_mode: parallel
      triggers:
        enabled: true
        items:
          - trigger: state
            entity_id: binary_sensor.freezer_door
            to: "on"
            for: "00:05:00"
    notification:
      target:
        area_id: [kitchen]
      data:
        title: Freezer
        message: The freezer door has been open for 5 minutes.
```

## Good to Know

- Edit alerts, not their generated automations: those are rewritten on save.
- Conditions are evaluated when configured triggers fire, not continuously.
- **Test alert** runs saved actions with conditions bypassed. It sends real
  notifications and executes configured actions; it does not simulate triggers.
- Notifications use the alert ID as their default tag, allowing supported
  providers to replace previous notifications. Clearing is explicit, not tied
  to an automation finishing.
- Confirmation messages support `{{ confirmed_by }}`, for example
  `Confirmed by {{ confirmed_by }}`.
- Pending confirmation waits do not survive a Home Assistant restart.

For details, see the [automation flow](docs/automation-flow.md),
[development guide](docs/development.md), and
[Companion notification documentation](https://companion.home-assistant.io/docs/notifications/notifications-basic/).
