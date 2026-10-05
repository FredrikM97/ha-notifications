# HA Notifications

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=FredrikM97&repository=ha-notifications&category=integration)

Actionable notifications for Home Assistant: describe an alert once (when it
fires, who gets it, what it says, whether someone must confirm it) and HA
Notifications generates and maintains a native Home Assistant automation for
it. Everything runs on Home Assistant's own triggers, conditions, templates,
and actions, so alerts keep working exactly like automations you wrote by hand.

<img width="1257" height="862" alt="HA Notifications alert editor" src="https://github.com/user-attachments/assets/b1ce380f-d098-4526-97f1-4ae0080b4cd0" />

## Features

- **Native triggers and conditions** — any Home Assistant trigger or condition,
  edited with Home Assistant's own visual editors.
- **Flexible recipients** — devices, areas, floors, labels, notify entities, or
  Home Assistant users (resolved to their mobile app devices).
- **Templated messages** — Jinja templates with alert context and per-condition
  results.
- **Confirmation** — actionable buttons, reminders until someone responds, an
  optional timeout, a follow-up notification, and actions to run on confirm.
- **Post-send actions** — run any Home Assistant actions after each send.
- **History** — every send, confirmation, and inactive transition, grouped by
  run and filterable.
- **One source of truth** — alerts are stored as YAML-compatible config;
  generated automations are derived from it and can always be recreated.

## Installation

1. Use the **Add to HACS** button above, install **HA Notifications**, and
   restart Home Assistant.
2. Go to **Settings → Devices & services → Add integration** and add
   **HA Notifications**.
3. Open **HA Notifications** from the sidebar.

On first setup the integration adds this line to `configuration.yaml` so its
generated automations are loaded; restart Home Assistant once afterwards:

```yaml
automation ha_notifications: !include ha_notifications_automations.yaml
```

It never touches your own `automations.yaml`.

## Using the panel

- **Alerts** lists every alert. Click a row to edit it, use the switch to
  enable or disable it, and the ⋮ menu for history, the generated automation,
  cancelling an active run, or deleting.
- **Active** shows alerts with a run in progress.
- **History** shows what happened. Search, filter by alert, event type, or
  severity, and group events by run. Active filters stay visible as chips.
- **YAML** edits the whole configuration at once.

The editor has one section per concern (basic, when to run, triggers,
conditions, recipients, notification, confirmation, and so on). Optional
sections have an on/off switch, and the sidebar marks which ones are enabled.

### Companion notification options

**Mobile options** is a separate editor section with **Android** and
**iOS / macOS** child sections. **Post-send actions** stays under
**Notification**. Optional sections share an Enabled/Disabled heading and
header switch. Recipient platforms are detected from the Companion
App registration's reported operating system, not device names. Unknown or
mixed recipients keep both platform sections available; detection does not
change routing or remove saved options.

Selecting recipients and entering a message in **Notification** is sufficient
to send a normal notification. **Android** and **iOS / macOS** are optional
settings with independent on/off switches, not delivery switches. Existing
configured options enable the corresponding section automatically. Turning a
section off excludes its managed options from delivery, preserving the
message, shared options, other platform settings, and custom YAML fields.
Disabled values are retained in editor-only configuration, including after
saving and reopening, and restored when enabled again. Optional settings have
individual switches with inputs shown only when enabled. Notification, LED,
and icon colors include a color picker alongside their text input.
The section menu marks platforms detected among the selected recipients.

Mobile options include grouping, replacement tags, colors, and icons. Android
adds channels, channel importance, sticky and persistent notifications,
lock-screen visibility, timeout, vibration, and LED color. iOS adds subtitle,
interruption level, sound, badge, icon glyph color, and foreground presentation.
Options use the existing notification data mapping and preserve custom fields.

Android persistent notifications use the alert ID as their default tag.
Android 14+ still allows individual dismissal while unlocked. Channel
importance, vibration, and LED settings generally apply when a channel is
first created; subsequent customization belongs in the device's notification
settings. iOS has no direct sticky, persistent, or channel equivalent, and
critical alerts require device permission. See the
[Companion notification documentation](https://companion.home-assistant.io/docs/notifications/notifications-basic/)
for platform requirements.

### Dashboard card

The same UI is available as a card:

```yaml
type: custom:ha-notifications-card
```

## Configuration

The panel and the YAML tab edit the same configuration. A minimal alert:

```yaml
version: 1
alerts:
  - id: freezer_open
    name: Freezer door open
    monitor:
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

A full example with conditions, confirmation, reminders, and actions:

```yaml
version: 1
alerts:
  - id: water_leak
    name: Water leak
    icon: mdi:water-alert
    monitor:
      automation_mode: parallel
      triggers:
        enabled: true
        items: []
      conditions:
        enabled: true
        startup: true
        periodic: true
        interval: 1800
        items:
          - condition: state
            entity_id: binary_sensor.kitchen_leak
            state: "on"
    notification:
      target:
        user_id: [8f2c1d0e4b6a4c4e9a1b2c3d4e5f6a7b]
        device_id: [a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6]
      data:
        title: Water leak
        message: >
          {% if condition.leak %}Water detected in the kitchen.{% endif %}
          Attempt {{ attempt }}.
    confirmation:
      enabled: true
      buttons:
        - id: handled
          label: I'm on it
      reminders:
        enabled: true
        interval: 900        # seconds; also accepts "00:15:00" or {minutes: 15}
        max_attempts: 5
        show_attempts: true
        forget_after_enabled: true
        timeout: 7200
      notification:
        enabled: true
        data:
          message: "{{ confirmed_by }} is handling the leak."
      actions:
        - action: valve.close_valve
          target:
            entity_id: valve.main_water
    post_send_actions:
      enabled: true
      actions:
        - action: light.turn_on
          target:
            area_id: kitchen
          data:
            flash: long
```

### Reference

| Key | Description |
| --- | --- |
| `id` | Lowercase letters, digits, and `_`, starting with a letter. The generated automation is `automation.ha_notifications_<id>`. |
| `name`, `description`, `icon`, `enabled` | Display and on/off state. |
| `monitor.automation_mode` | Main automation mode, defaulting to `parallel`. Conditional alerts use `parallel`. |
| `monitor.triggers` | Custom native Home Assistant triggers. `enabled` controls the feature. |
| `monitor.inactive` | Explicit cancellation triggers: `enabled` defaults to false, `items` contains native triggers, and `clear_notification` optionally clears the delivered notification. These triggers bypass main alert conditions. |
| `monitor.conditions` | Native Home Assistant condition items plus built-in startup and periodic evaluations. `enabled` controls condition gating; conditions are evaluated when configured triggers fire. Give a condition an `id` to use `condition.<id>` in templates. |
| `notification` | `target` (devices, areas, floors, labels, notify entities, users) is resolved to each recipient's notify service. `data` holds `title`, `message`, and any extra service data. `action` is an optional fallback notify action used when the target resolves to nothing. |
| `confirmation` | `buttons`, `reminders`, a follow-up `notification`, and `actions` to run on confirm. |
| `post_send_actions` | Actions to run after every send. |

Durations accept seconds, `"HH:MM:SS"`, or a mapping such as `{minutes: 15}`.

### Templates

Message templates are rendered by Home Assistant when the alert runs. Besides
all normal template helpers, these variables are available:

- `alert_id`, `alert_name`, `alert_active`, `attempt`, `trigger`, `now`
- `condition.<id>` — result of a condition with that `id`
- In confirmation follow-ups: `confirmed_by`, `confirmation_response`,
  `confirmation_response_id`

## Services

| Service | Use |
| --- | --- |
| `ha_notifications.send` | Send a notification (used by generated automations). |
| `ha_notifications.clear` | Clear a delivered notification. |
| `ha_notifications.command` | Send a command to a running alert, for example `skip_confirmation`. |
| `ha_notifications.report` | Record a lifecycle event in history (used by generated automations). |

```yaml
action: ha_notifications.command
data:
  alert_id: water_leak
  command: skip_confirmation
```

Confirmation buttons arrive as the native `mobile_app_notification_action`
event with action `ha_notifications_<alert id>_confirmation_<button id>`.

## Good to know

- Generated automations are grouped under the **HA Notifications** category
  and label. Edit the alert, not the generated automation; it is rewritten on
  save.
- Disabled automations are reported, not silently re-enabled.
- In-flight confirmation waits do not survive a Home Assistant restart.

See [docs/automation-flow.md](docs/automation-flow.md) for exactly what the
generated automations do, and [docs/development.md](docs/development.md) to
work on the integration.
