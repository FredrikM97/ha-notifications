import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import {
  checkedOf,
  durationInput,
  durationInputValue,
  enabledLabel,
  field,
  section,
  toggleTitle,
  valueOf,
} from "../editor/helpers.js";

export function renderReminderIntervalSection(
  context: EditorContext,
): TemplateResult {
  const notification = context.value.notification;
  const repeat = notification.repeat;
  const repeatEnabled = Boolean(repeat && repeat.enabled !== false);
  const repeatState = enabledLabel(repeatEnabled);
  const repeatTitle = toggleTitle(repeatEnabled, "reminder interval");
  const isRepeatEnabled = (): boolean =>
    Boolean(notification.repeat && notification.repeat.enabled !== false);
  const repeatInterval = (): string | Record<string, number> =>
    repeat?.interval || "00:30:00";
  const repeatMaxAttempts = (): number => repeat?.max_attempts || 5;
  const toggleRepeat = (enabled: boolean): void => {
    if (enabled) {
      notification.repeat = {
        interval: repeatInterval(),
        max_attempts: repeatMaxAttempts(),
        enabled: true,
      };
    } else if (notification.repeat) {
      notification.repeat.enabled = false;
    } else {
      notification.repeat = {
        interval: "00:30:00",
        max_attempts: 5,
        enabled: false,
      };
    }
    context.markDirty();
    context.refreshStatuses();
  };

  return section(
    "Reminder interval",
    html`<div class="nc-help">
        Send another notification while this alert remains active.
      </div>
      <div class="nc-grid">
        ${field(
          "Interval",
          durationInput(
            durationInputValue(
              repeat?.interval as string | Record<string, number> | undefined,
              "00:30:00",
            ),
            (next) => {
              notification.repeat = {
                interval: next,
                max_attempts: repeatMaxAttempts(),
                enabled: isRepeatEnabled(),
              };
              context.markDirty();
            },
          ),
        )}
        ${field(
          "Maximum reminders",
          html`<input
            type="number"
            min="1"
            .value=${String(repeat?.max_attempts || 5)}
            @input=${(event: Event) => {
              notification.repeat = {
                interval: repeatInterval(),
                max_attempts: Number(valueOf(event)) || 5,
                enabled: isRepeatEnabled(),
              };
              context.markDirty();
            }}
          />`,
        )}
      </div>`,
    "",
    html`<div class="nc-setting-controls">
      <span class="nc-setting-state">${repeatState}</span>
      <input
        class="nc-switch-input"
        type="checkbox"
        role="switch"
        .checked=${repeatEnabled}
        aria-label="Enable reminder interval"
        title=${repeatTitle}
        @change=${(event: Event) => {
          const enabled = checkedOf(event);
          toggleRepeat(enabled);
          const label = (event.currentTarget as HTMLElement)
            .closest(".nc-setting-controls")
            ?.querySelector<HTMLElement>(".nc-setting-state");
          if (label) label.textContent = enabledLabel(enabled);
        }}
      />
    </div>`,
  );
}
