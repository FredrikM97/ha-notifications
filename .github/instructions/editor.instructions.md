---
description: "Use when changing alert editor help icons, labels, boolean rows, section headings, or their visible DOM tests."
applyTo: "frontend/editor/index.ts, tests/frontend/editor-native-controls.test.ts"
---

Reuse `labelWithHelp()`: `.nc-heading` contains a label-text span immediately
followed by its info icon. Boolean help stays after label text, never after
the switch/checkbox or at the end of the row.
Boolean rows use `.nc-option.nc-option-inline` with a separate trailing
`ha-switch`, not a `ha-settings-row` heading slot. Keep `.nc-heading`
inline-flex with a small gap and content-sized children; the switch, not
the info icon, absorbs remaining row space.
Do not duplicate native form labels or manipulate private shadow DOM.

Section help goes immediately right of the heading via `sectionHelp()` and
the shared label/help template, never inside or beside a code editor.
Notification template-values help belongs beside the Notification `h2`,
not its message field. Preserve other field-specific text helper layouts.
Test the visible shared structure: label-text span then icon in `.nc-heading`,
switch outside that label, and section-heading help without duplicate
message-field help.