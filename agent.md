# Notification Center — Agent Instructions

## Goal

Make Notification Center feel like a **native Home Assistant feature**: simple for everyday use, compact, visual, and powerful when needed.

The core principle is:

> **Simple by default, powerful when needed.**

Do not remove working functionality just to simplify the UI.

---

## UI design

### Minimal new alert

Creating an alert should start with only the essentials:

* Name
* Checking/trigger behaviour
* Condition

Then let the user add functionality when needed:

```text
+ Add notification
+ Add confirmation
+ Add action
```

Do not present every possible option in one large form.

---

## Compact and collapsible

Avoid excessive scrolling.

Organize configuration into compact expandable sections:

```text
▾ When
▸ Condition
▸ Notifications
▸ Confirmation
▸ Actions
▸ Advanced / YAML
```

Keep sections collapsed unless they contain something the user is currently editing.

---

## Checking / trigger behaviour

Do not force the user into a traditional **WHEN → THEN** automation model.

The alert should instead describe:

**When should the condition be checked?**

Allow either or both:

```text
☑ When the condition changes
☑ Periodically

Every [ 12 hours ]
```

The user can enable:

* change-based checking only
* periodic checking only
* both

---

## Visual conditions

For common use cases, users should not need to write Jinja.

The condition builder should feel similar to Home Assistant's automation UI.

For example:

```text
Entity [ Temperature ]
        [ is above ]
        [ 25 ]

+ Add condition
```

Support common operations such as:

* state equals
* state does not equal
* numeric above/below
* duration
* entity availability
* device/entity based conditions

Use Home Assistant's native selectors wherever possible.

Raw templates/Jinja should still be available under **Advanced**.

---

## Notifications

Notifications should be optional and added individually.

Each notification can have its own:

* title
* message
* target
* notification data
* advanced options

An alert should be able to send different notifications to different targets.

Targets should use Home Assistant's native selectors where possible, including things such as:

* devices
* entities
* areas
* labels

Do not build custom target-selection UI when Home Assistant already provides an appropriate selector.

The integration itself must handle the notification functionality. Do not require an external notification script.

---

## Confirmation

Confirmation is optional.

Initially show:

```text
+ Add confirmation
```

When enabled, allow configuration of:

* confirmation button
* completion message
* actions after confirmation

Confirmation actions should support normal Home Assistant actions/services, including targets and data.

---

## YAML

YAML should be a **first-class part of the UI**.

Every alert should have an easy way to switch between the visual editor and YAML:

```text
[ Visual ] [ YAML ]
```

The YAML editor should support:

* view
* edit
* copy
* paste
* validate
* apply

Users should be able to copy an alert's configuration out of the UI and paste configuration back in.

Invalid YAML must never replace a valid saved configuration.

---

## Dashboard

The main dashboard should be a compact list of alerts.

Each alert should clearly show things such as:

* name
* enabled/disabled
* current condition status
* last notification
* recent activity

Useful quick actions:

* Edit
* Test
* History
* Enable/disable
* Delete

The dashboard should remain clean and readable rather than becoming another large configuration screen.

---

## History and debugging

Every alert should have an easy-to-understand activity/history view.

Show what happened and in what order, for example:

```text
10:30  Condition became true
10:30  Notification sent
22:30  Notification resent
22:35  Confirmation received
22:35  Action executed
```

The goal is to answer:

> **Why did this alert trigger, and what happened afterwards?**

Include useful timestamps and relevant details without overwhelming the user.

---

## Saving and validation

Saving must be reliable and explicit.

The complete flow should be:

```text
Edit
 ↓
Validate
 ↓
Save
 ↓
Persist configuration
 ↓
Update running alert
 ↓
Refresh UI
```

The UI must clearly indicate success or failure.

Test at minimum:

* create alert
* edit alert
* delete alert
* enable/disable
* save changes
* reload Home Assistant
* invalid configuration
* YAML copy/paste
* YAML validation
* runtime update after saving

Never silently lose changes.

---

## Preserve functionality

The redesign should continue supporting:

* condition monitoring
* condition-change checks
* periodic checks
* multiple notification targets
* multiple notifications
* confirmation
* confirmation actions
* templates/Jinja
* YAML configuration
* persistent configuration/state
* history/debugging
* configuration through Home Assistant
* runtime updates

Do not regress existing functionality while changing the UI.

---

## Home Assistant style

Prefer native Home Assistant UI components, selectors and interaction patterns wherever possible.

The user should feel like they are configuring a normal Home Assistant automation rather than using a completely separate application.

Avoid unnecessary custom controls when Home Assistant already has a suitable component.

---

## Implementation discipline

Before considering a change complete:

* Validate all Python syntax.
* Verify every import refers to something that actually exists.
* Verify every frontend resource actually loads.
* Check browser console for JavaScript errors.
* Test creating and saving an alert.
* Test editing an existing alert.
* Test deleting an alert.
* Test YAML validation.
* Test invalid configuration.
* Test Home Assistant restart/reload.
* Confirm the alert still runs after changes.

Do not make architectural changes merely for the sake of reorganizing files.

## Final principle

Build a UI that is:

**compact, visual, native to Home Assistant, easy for beginners, configurable for advanced users, and reliable enough to trust.**
