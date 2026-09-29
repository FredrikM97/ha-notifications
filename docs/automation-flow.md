# Automation Flow

The generated automation is assembled from the canonical alert configuration.
Only enabled features contribute actions to the YAML. The `ha_notifications`
services record managed delivery and native action results in persistent
history; `logbook.log` is included only when configured as a post-send action.
The persistent history store belongs to the loaded config entry's
`runtime_data`; it is not kept in `hass.data`.

Generated automations are written to the dedicated
`ha_notifications_automations.yaml` include. Add this to Home Assistant's
`configuration.yaml`:

```yaml
automation ha_notifications: !include ha_notifications_automations.yaml
```

This named automation entry is unique to HA Notifications and can coexist with
your other automation configuration. The integration adds this include
automatically when it is missing. Restart Home Assistant after the first
automatic insertion so the new configuration is loaded.

Generated automations are attributable because HA Notifications adds its own
metadata and record actions. If a user manually edits or replaces an owned
automation, that attribution guarantee no longer applies.

```mermaid
flowchart TD
    A[Trigger: state, startup, or interval] --> B{Alert conditions true?}
    B -- No --> P{clear_on_inactive?}
    P -- Yes --> Q[ha_notifications.clear<br/>record notification_cleared]
    P -- No --> Z[No action]
    B -- Yes --> C[ha_notifications.send<br/>record notification_sent]
    C --> D{Post-send actions enabled?}
    D -- Yes --> E[Run configured native actions<br/>record each action]
    D -- No --> F{Confirmation enabled?}
    E --> F
    F -- No --> Z
    F -- Yes --> G[Wait for confirmation event]
    G --> H{Confirmed before timeout?}
    H -- Yes --> I[Send confirmation notification<br/>run confirmation actions<br/>record each action]
    I --> Z
    H -- No --> J{Reminders enabled?}
    J -- No --> Z
    J -- Yes --> K[Repeat up to max_attempts]
    K --> L[ha_notifications.send<br/>record notification_sent]
    L --> M[Wait for confirmation event]
    M --> N{Confirmed?}
    N -- Yes --> I
    N -- No --> O{Attempts remaining?}
    O -- Yes --> K
    O -- No --> Z
```