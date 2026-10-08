---
description: "Use when changing alert editor help icons, labels, boolean rows, section headings, or their visible DOM tests."
applyTo: "frontend/editor/index.ts, tests/frontend/editor-native-controls.test.ts"
---

Use `ha-notifications-setting-row` for boolean and scalar field rows;
slot native controls, label text, help icons, and the trailing toggle into it.
Use `ha-notifications-help-icon` for info buttons. It owns the native icon and
accessible tooltip, and emits `help-request`; the editor alone owns help dialogs.
Boolean rows: label then help inside `.nc-heading`, a separate slotted `ha-switch`.
Scalar rows: the one-field `ha-form` then its help icon (top-aligned to the
native field), then the optional `ha-notifications-feature-switch` for
option-group fields. Option-group rows, numbers and durations keep the compact
field width; other fields use the full card width. Template code editors get a
divider-colored frame. Prefer a `placeholder` translation
over a help icon for short text-field guidance. Color rows: native picker,
label, help, then the switch.
Large editors (trigger, condition, action, template, object, target) take the
full row with no visible label (label becomes `aria-label`); their `helper` text
joins the section `helper` in the heading help dialog, never beside the editor.
Section help goes immediately right of the section heading.
Do not duplicate native form labels or manipulate private shadow DOM. One exception:
HA's native editors differ only in that the trigger editor lacks the `.card-content.card`
inset its condition and action editors have, so `insetNativeEditors()` in
`frontend/editor/native-editor.ts` adopts that same HA rule on all three after render.
`NATIVE_EDITOR_KINDS` there is the only list of native editor kinds; derive every
trigger/condition/action special case from it. No observers, tree walks, timers, or markup changes.
Section and optional-field enablement use the presentation-only
`ha-notifications-feature-switch`; it takes enabled/label values and emits
`enabled-changed`. Boolean value controls remain direct native switches.
Tests may access the feature component's public shadow switch explicitly.
