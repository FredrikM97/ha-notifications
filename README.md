# HA Notifications

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=FredrikM97&repository=ha-notifications&category=integration)

Create actionable notifications using Home Assistant's native triggers,
conditions, templates, and actions. Configure recipients, confirmation buttons,
reminders, and follow-up actions in one panel. The integration generates and
maintains the automations for you.

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
- **History:** searchable notification and automation events.
- **YAML:** edit, validate, and save the complete configuration.

Choose when an alert runs, its recipients, and its message. Conditions,
confirmation, reminders, and Android/iOS options are optional.

To use the panel as a dashboard card:

```yaml
type: custom:ha-notifications-card
```

Edit alerts rather than their generated automations. **Test alert** sends real
notifications and executes configured actions; it is not a simulation.

For details, see the [automation flow](docs/automation-flow.md),
[development guide](docs/development.md), and
[Companion notification documentation](https://companion.home-assistant.io/docs/notifications/notifications-basic/).

# Gallery
<p align="center">
  <img width="70%" alt="Overview of dashboard" src="https://github.com/user-attachments/assets/387f3189-f640-4956-b26e-e1143bf4dc29">
  <br>
  <em>Overview of dashboard</em>
</p>

<p align="center">
  <img width="70%" alt="Settings page" src="https://github.com/user-attachments/assets/789551e0-0fdf-41ff-b6ee-e51556d7b70e">
  <br>
  <em>Settings page</em>
</p>

<p align="center">
  <img width="70%" alt="image" src="https://github.com/user-attachments/assets/24db5608-40a5-4bf2-9d00-b188b4a356ef">
  <br>
   <em>History page</em>
</p>

<p align="center">
  <img width="70%" alt="image" src="https://github.com/user-attachments/assets/61a0116f-bbb0-407d-9de9-f9652d3963bc">
  <br>
  <em>Raw yaml settings</em>
</p>

<p align="center">
  <img width="70%" alt="image" src="https://github.com/user-attachments/assets/545d11c1-31df-4a14-921e-e31cf4ef713c">
  <br>
  <em>Trigger example</em>
</p>

<p align="center">
  <img width="70%" alt="image" src="https://github.com/user-attachments/assets/0d8e0431-549a-487b-8534-c0c98f96fec1" />
  <br>
  <em>Automation population</em>
</p>




