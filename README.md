# HA Notifications

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=FredrikM97&repository=ha-notifications&category=integration)

The integration source lives under `custom_components/ha_notifications`,
as expected by Home Assistant and HACS. For packaging, run
`npm install && npm run export:hacs`. The source frontend remains TypeScript;
the export contains compiled browser output.

## Installation

### HACS

Use the **Add to HACS** button above, or search for **HA Notifications** in
HACS. HACS installs the integration and its compiled frontend together.

No separate Lovelace resource or frontend download is required. After the
integration is installed and Home Assistant is restarted, it registers its
sidebar panel and frontend module automatically.

### Manual ZIP installation

Download the `ha-notifications.zip` asset from a release, create the
integration directory, and extract the ZIP contents into your Home Assistant
configuration directory:

```text
<config>/custom_components/ha_notifications/
```

For example:

```bash
mkdir -p <config>/custom_components/ha_notifications
unzip ha-notifications.zip -d <config>/custom_components/ha_notifications
```

The ZIP contains the integration files at its root. Do not copy the ZIP file
itself into `custom_components`; `manifest.json` and `dist/panel.js` must be
directly inside the integration directory. Restart Home Assistant after
installation.

The release ZIP already contains the compiled frontend. You only need
`npm run build` when installing from the source repository or developing the
integration locally.

For local Home Assistant testing, build the frontend in a Node-capable
environment, then run the Node-free installer to copy the integration into
`config/custom_components/ha_notifications`, or pass a different Home
Assistant configuration directory:

```bash
npm run build
sh scripts/install_local.sh /path/to/home-assistant-config
```

A Home Assistant custom integration for creating, managing, and debugging state-based notifications from a dedicated UI.

HA Notifications is designed to replace large collections of notification automations and external notification scripts with a single, self-contained integration.

It provides:

* A dedicated Home Assistant frontend panel
* A Lovelace custom card with the full HA Notifications management UI
* Visual alert management
* YAML editing and import/export
* Device, area and label notification targets
* Condition-change monitoring
* Interval-based condition checking
* Optional use of both mechanisms
* Actionable notifications
* Confirmation handling
* Follow-up actions
* Notification history
* Execution/debug traces
* Persistent alert state
* No `configuration.yaml` entry required
* No external notification script required
* Configuration stored in Home Assistant storage

## Lovelace card

The integration automatically registers its compiled frontend module with Home
Assistant, so no manually configured Lovelace resource is required. In a
dashboard, choose **Add card**, select **HA Notifications**, and add it. The
card opens the same full alert editor, history, and YAML UI as the sidebar
panel; it is not a status-only card.

The card configuration is:

```yaml
type: custom:ha-notifications-card
```

Only Home Assistant administrators can access the card's alert data or editing
controls. Non-administrators see an access-required message. Disabling an
already-added confirmation leaves its notification and post-confirmation
settings intact and editable, so it can be re-enabled without rebuilding it.

---

## Features

### Alert management

Alerts can be created and managed from the HA Notifications frontend.

Each alert can contain:

* Name
* Description
* Enabled/disabled state
* Condition
* Trigger behaviour
* Interval checking
* Notification configuration
* Notification targets
* Confirmation settings
* Completion message
* Actions after confirmation

Alerts can be enabled or disabled without removing their configuration.

---

## Trigger modes

An alert can determine when its condition should be evaluated.

The UI supports:

### Condition changes

The condition is monitored and evaluated when Home Assistant detects a relevant change.

Example:

```jinja
{{ is_state('binary_sensor.freezer_door', 'on') }}
```

This is useful when an alert should react immediately to state changes.

---

### Interval

The condition is periodically evaluated.

Example:

```yaml
interval:
  hours: 1
```

This is useful for conditions based on things such as:

* elapsed time
* battery levels
* sensor thresholds
* schedules
* values that change without producing a useful state trigger

---

### Both

Both mechanisms can be enabled.

For example:

```yaml
monitor:
  on_change: true
  interval: "00:30:00"
```

The condition can therefore be evaluated immediately when relevant entities change while also being periodically rechecked.

The UI deliberately presents these as simple options rather than forcing users to understand Home Assistant's automation `WHEN` / `THEN` terminology.

---

## Conditions

Each alert has a condition that evaluates to `true` or `false`.

For example:

```jinja
{{ states('sensor.water_level') | float(100) < 20 }}
```

More advanced Jinja templates are supported.

Example:

```jinja
{% set threshold = 20 %}
{% set ns = namespace(low=false) %}

{% for device_id in label_devices('plants') %}
  {% for entity_id in device_entities(device_id) %}
    {% if states(entity_id) | float(100) < threshold %}
      {% set ns.low = true %}
    {% endif %}
  {% endfor %}
{% endfor %}

{{ ns.low }}
```

The condition editor supports direct template editing when more advanced logic is required.

---

# Notifications

Notification delivery is built directly into the integration.

You do **not** need a separate notification script such as:

```text
script.global_multi_device_actionable_notifie
```

HA Notifications can execute notification services itself.

This makes the integration self-contained and avoids an external dependency on a specific Home Assistant script.

---

## Notification targets

An alert is not restricted to a single device.

Targets can be selected from the UI.

Depending on the target type supported by the installed Home Assistant environment, an alert can target things such as:

* Devices
* Areas
* Labels
* Entities
* Notification services

For example, an alert could notify:

```text
Phone
Tablet
All devices in Bedroom
All devices with label "Family"
```

Multiple targets can be selected for the same alert.

Different alerts can have completely different targets.

Example:

```text
Low water
→ Kitchen devices

Freezer open
→ All household phones

Plant moisture
→ Personal phone

Battery warning
→ Maintenance devices
```

---

# Actionable notifications

Alerts can optionally contain an action/confirmation button.

Example:

```yaml
confirmation:
  enabled: true
  button: "Activity completed"
```

When the user confirms the notification, HA Notifications can:

1. Detect the notification action
2. Identify the user where possible
3. Record the confirmation
4. Clear the active notification
5. Send an optional completion message
6. Execute configured follow-up actions
7. Record the complete operation in the debug history

---

## Confirmation actions

An alert can execute Home Assistant actions after confirmation.

Example:

```yaml
confirmation:
  enabled: true
  actions:
    enabled: true
    items:
      - action: switch.turn_on
        target:
          entity_id:
            - switch.water_pump_reset
            - switch.filter_reset
```

Multiple actions can be configured.

Actions run sequentially and can include a Home Assistant-style delay. The
delay may be an `HH:MM:SS` string or a duration mapping:

```yaml
confirmation:
  actions:
    enabled: true
    items:
      - delay: "00:10:00"
      - action: switch.turn_off
        target:
          entity_id: switch.water_pump
```

This makes HA Notifications useful for workflows such as:

```text
Notification
    ↓
User confirms
    ↓
Clear notification
    ↓
Run Home Assistant actions
    ↓
Send completion message
    ↓
Record result
```

---

# Notification retry behaviour

Actionable notifications can optionally be resent if they have not been confirmed.

For example:

```yaml
confirmation:
  enabled: true
  reminders:
    enabled: true
    interval: "00:30:00"
    max_attempts: 5
```

This allows a notification to behave like:

```text
Send
 ↓
Wait
 ↓
Confirmed?
 ├─ Yes → Complete
 └─ No
      ↓
   Wait again
      ↓
   Send again
```

The UI should expose these options without requiring users to manually build the state machine.

---

# YAML support

## Canonical YAML structure

HA Notifications writes one canonical representation for each alert.
Configuration uses one `notification`, a `conditions` list, and a `monitor`
object. YAML validation rejects malformed structures before writing.

```yaml
version: 1
alerts:
  - id: low_water
    name: Low water
    enabled: true
    description: ""
    icon: mdi:bell-outline
    monitor:
      on_change: true
      startup: true
      interval: "01:00:00"
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
      button: Activity completed
      reminders:
        enabled: true
        interval: "00:30:00"
        max_attempts: 5
      actions:
        enabled: true
        items:
          - action: switch.turn_on
            target:
              entity_id:
                - switch.water_pump_reset
```

Multiple visual conditions are combined with `AND`. There is no separate `logic` field.

`confirmation.actions.enabled` explicitly controls whether follow-up actions are configured.
Empty `confirmation.actions.items` lists are omitted from saved YAML when no
follow-up actions are configured.
