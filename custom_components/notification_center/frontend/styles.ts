export const styles = `
:host {
  display: block;
  color: var(--primary-text-color);
  background: var(--primary-background-color);
  min-height: 100%;
  box-sizing: border-box;
}

* {
  box-sizing: border-box;
}

button,
input,
textarea,
select {
  font: inherit;
}

.nc-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.nc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.nc-title {
  display: flex;
  align-items: center;
  gap: 14px;
}

.nc-title-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--primary-color);
  color: var(--text-primary-color);
  display: grid;
  place-items: center;
  font-size: 24px;
}

.nc-title h1 {
  margin: 0;
  font-size: 28px;
}

.nc-title p {
  margin: 4px 0 0;
  color: var(--secondary-text-color);
}

.nc-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.nc-button {
  border: 0;
  border-radius: 10px;
  padding: 10px 15px;
  cursor: pointer;
  background: var(--primary-color);
  color: white;
  font-weight: 600;
}

.nc-button.secondary {
  background: var(--secondary-background-color);
  color: var(--primary-text-color);
}

.nc-button.danger {
  background: var(--error-color);
  color: white;
}

.nc-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.nc-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--secondary-background-color);
  border-radius: 12px;
  margin-bottom: 18px;
}

.nc-tab {
  flex: 1;
  border: 0;
  background: transparent;
  padding: 10px;
  border-radius: 9px;
  cursor: pointer;
  color: var(--secondary-text-color);
  font-weight: 600;
}

.nc-tab.active {
  background: var(--card-background-color);
  color: var(--primary-text-color);
  box-shadow: var(--ha-box-shadow);
}

.nc-alerts {
  display: grid;
  gap: 12px;
}

.nc-card {
  background: var(--card-background-color);
  border-radius: 16px;
  padding: 18px;
  box-shadow: var(--ha-box-shadow);
}

.nc-section {
  background: var(--card-background-color);
  border-radius: 14px;
  border: 1px solid var(--divider-color);
  margin-bottom: 12px;
  overflow: hidden;
}

.nc-section-content {
  padding: 0 16px 16px;
}

.nc-section-status {
  color: var(--error-color);
  font-size: 14px;
  line-height: 1;
}

.nc-section-status.active {
  color: var(--success-color, #4caf50);
}

.nc-alert {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 15px;
  align-items: center;
}

.nc-alert-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--secondary-background-color);
  display: grid;
  place-items: center;
  font-size: 21px;
}

.nc-alert-main {
  min-width: 0;
}

.nc-alert-name {
  font-weight: 700;
  font-size: 17px;
}

.nc-alert-meta {
  margin-top: 5px;
  color: var(--secondary-text-color);
  font-size: 13px;
}

.nc-alert-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.nc-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.nc-status.active {
  background: rgba(244, 67, 54, 0.14);
  color: var(--error-color);
}

.nc-status.ok {
  background: rgba(76, 175, 80, 0.14);
  color: var(--success-color, #4caf50);
}

.nc-status.disabled {
  background: var(--secondary-background-color);
  color: var(--secondary-text-color);
}

.nc-empty {
  text-align: center;
  padding: 55px 20px;
  color: var(--secondary-text-color);
}

.nc-empty h2 {
  color: var(--primary-text-color);
}

.nc-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.nc-toolbar select,
.nc-toolbar input,
.nc-yaml textarea,\n.nc-code-editor {
  background: var(--card-background-color);
  color: var(--primary-text-color);
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  padding: 10px;
}

.nc-history {
  display: grid;
  gap: 8px;
}

.nc-history-item {
  display: grid;
  grid-template-columns: 150px 180px 1fr;
  gap: 12px;
  align-items: start;
  padding: 13px;
  border-bottom: 1px solid var(--divider-color);
}

.nc-history-time {
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-history-type {
  font-weight: 700;
}

.nc-history-message {
  min-width: 0;
}

.nc-details {
  margin-top: 6px;
  color: var(--secondary-text-color);
  font-size: 12px;
  white-space: pre-wrap;
}

.nc-yaml {
  display: grid;
  gap: 12px;
}

.nc-yaml textarea,\n.nc-code-editor {
  width: 100%;
  min-height: 650px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
}

.nc-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.48);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.nc-editor-view {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px;
}

.nc-editor-shell {
  background: var(--card-background-color);
  color: var(--primary-text-color);
  border-radius: 14px;
  box-shadow: var(--ha-box-shadow);
  overflow: hidden;
}

.nc-editor-shell > .nc-modal-header {
  background: var(--primary-color);
  color: var(--text-primary-color);
}

.nc-modal {
  width: min(900px, 100%);
  max-height: 92vh;
  overflow: auto;
  background: var(--card-background-color);
  color: var(--primary-text-color);
  border-radius: 18px;
  box-shadow: 0 20px 70px rgba(0,0,0,.35);
}

.nc-modal-header {
  background: var(--secondary-background-color);
  padding: 20px;
  border-bottom: 1px solid var(--divider-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.nc-modal-header h2 {
  margin: 0;
}

.nc-modal-body {
  padding: 20px;
  display: grid;
  gap: 18px;
}

.nc-section-header {
  position: sticky;
  top: 0;
  z-index: 15;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  border-radius: 12px;
  margin-bottom: 18px;
  background: var(--card-background-color);
  box-shadow: var(--ha-box-shadow);
}

.nc-section-header .nc-section-nav-button {
  flex: 1 0 auto;
  border: 0;
  border-radius: 9px;
  padding: 10px 12px;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.nc-section-header .nc-section-nav-button:hover {
  background: var(--primary-background-color);
  color: var(--primary-text-color);
}

.nc-section-header .nc-section-nav-button.active {
  background: var(--card-background-color);
  color: var(--primary-text-color);
  box-shadow: var(--ha-box-shadow);
}

.nc-section:not(.active) {
  display: none;
}

.nc-modal-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--divider-color);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.nc-section {
  border: 1px solid var(--divider-color);
  border-radius: 13px;
  padding: 15px;
}

.nc-section h3 {
  margin: 0 0 12px;
}

.nc-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.nc-field {
  display: grid;
  gap: 6px;
}

.nc-field.full {
  grid-column: 1 / -1;
}

.nc-field label {
  font-weight: 600;
  font-size: 13px;
}

.nc-field input,
.nc-field textarea,
.nc-field select {
  width: 100%;
  border: 1px solid var(--divider-color);
  border-radius: 9px;
  padding: 10px;
  background: var(--primary-background-color);
  color: var(--primary-text-color);
}

.nc-field textarea {
  min-height: 110px;
  resize: vertical;
  font-family: inherit;
}

.nc-field textarea.code {
  min-height: 180px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.nc-target-picker {
  display: grid;
  gap: 8px;
}

.nc-recipient-input {
  position: relative;
  z-index: 40;
}

.nc-section-recipient {
  position: relative;
  z-index: 30;
  overflow: visible;
}

.nc-recipient-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.nc-recipient-toolbar input {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--divider-color);
  border-radius: 9px;
  padding: 10px;
  background: var(--primary-background-color);
  color: var(--primary-text-color);
}

.nc-recipient-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  grid-column: 1 / -1;
}

.nc-recipient-filter {
  border: 1px solid var(--divider-color);
  border-radius: 999px;
  padding: 5px 9px;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
  font-size: 12px;
}

.nc-recipient-filter.active,
.nc-recipient-filter:hover {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: var(--text-primary-color, white);
}

.nc-recipient-results {
  display: grid;
  position: relative;
  top: auto;
  right: auto;
  left: auto;
  z-index: 1;
  grid-template-columns: 1fr;
  gap: 6px;
  max-height: 240px;
  overflow: auto;
  padding: 2px;
  border: 1px solid var(--divider-color);
  border-radius: 9px;
  background: var(--card-background-color);
  box-shadow: var(--ha-box-shadow);
}

.nc-recipient-results[hidden] {
  display: none;
}

.nc-recipient-option {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--primary-background-color);
  color: var(--primary-text-color);
  cursor: pointer;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nc-recipient-option:hover {
  border-color: var(--primary-color);
}

.nc-recipient-empty {
  grid-column: 1 / -1;
  padding: 12px;
  color: var(--secondary-text-color);
  text-align: center;
}

.nc-target-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 24px;
}

.nc-target-selection-label {
  color: var(--secondary-text-color);
  font-size: 12px;
  font-weight: 600;
}

.nc-target-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 7px 5px 10px;
  border-radius: 999px;
  background: var(--secondary-background-color);
  color: var(--primary-text-color);
  font-size: 13px;
}

.nc-chip-remove {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
  font-size: 0;
}

.nc-chip-remove::after {
  content: "×";
  font-size: 18px;
  line-height: 1;
}



.nc-check input.nc-switch-input {
  appearance: none;
  position: relative;
  width: 42px !important;
  height: 24px;
  margin: 0;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: var(--divider-color);
  cursor: pointer;
  transition: background 0.15s ease;
  background-image: radial-gradient(
    circle at 12px 12px,
    var(--card-background-color) 0 8px,
    transparent 9px
  );
}

.nc-check input.nc-switch-input:checked {
  background-color: var(--primary-color);
  background-position: 18px 0;
}

.nc-check {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nc-check input {
  width: auto;
}

.nc-help {
  color: var(--secondary-text-color);
  font-size: 12px;
  line-height: 1.5;
}

.nc-condition-mode {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.nc-condition-mode-button {
  border: 1px solid var(--divider-color);
  border-radius: 999px;
  padding: 7px 11px;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.nc-condition-mode-button.active,
.nc-condition-mode-button:hover {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: var(--text-primary-color, white);
}

.nc-condition-rows {
  display: grid;
  gap: 10px;
  margin-bottom: 10px;
}

.nc-condition-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  background: var(--secondary-background-color);
}

.nc-condition-row .nc-button {
  justify-self: start;
}

.nc-error {
  color: var(--error-color);
  background: rgba(244, 67, 54, 0.1);
  border-radius: 9px;
  padding: 10px;
  white-space: pre-wrap;
}

.nc-toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 20000;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--primary-text-color);
  color: var(--primary-background-color);
  box-shadow: var(--ha-box-shadow);
}

@media (max-width: 700px) {
  .nc-page {
    padding: 14px;
  }

  .nc-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .nc-alert {
    grid-template-columns: auto 1fr;
  }

  .nc-alert-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .nc-grid {
    grid-template-columns: 1fr;
  }

  .nc-condition-row {
    grid-template-columns: 1fr;
  }

  .nc-recipient-toolbar {
    grid-template-columns: 1fr;
  }

  .nc-history-item {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
.nc-alert-yaml-modal {
  width: min(1000px, 100%);
  max-height: 92vh;
}

.nc-alert-yaml-editor {
  min-height: 600px;
  width: 100%;
}

ha-code-editor.nc-code-editor {
  display: block;
  min-height: 650px;
}
`;
