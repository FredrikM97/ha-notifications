# Notification Center

A Home Assistant custom integration for creating, managing, and debugging state-based notifications from a dedicated UI.

Notification Center is designed to replace large collections of notification automations and external notification scripts with a single, self-contained integration.

It provides:

* A dedicated Home Assistant frontend panel
* Visual alert management
* YAML editing and import/export
* Device, area and label notification targets
* Trigger-based conditions
* Interval-based condition checking
* Optional use of both trigger and interval checking
* Actionable notifications
* Confirmation handling
* Follow-up actions
* Notification history
* Execution/debug traces
* Persistent alert state
* No `configuration.yaml` entry required
* No external notification script required
* Configuration stored in Home Assistant storage

---

## Features

### Alert management

Alerts can be created and managed from the Notification Center frontend.

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
trigger:
  enabled: true

interval:
  enabled: true
  minutes: 30
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

Notification Center can execute notification services itself.

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

When the user confirms the notification, Notification Center can:

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
actions:
  - action: switch.turn_on
    target:
      entity_id:
        - switch.water_pump_reset
        - switch.filter_reset
```

Multiple actions can be configured.

This makes Notification Center useful for workflows such as:

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
resend:
  enabled: true
  interval:
    minutes: 30
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

Notification Center sup
