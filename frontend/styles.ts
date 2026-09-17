export const styles = `
:host {
  display: block;
  color: var(--primary-text-color);
  background: var(--primary-background-color);
  min-height: 100%;
  box-sizing: border-box;
}

:host(ha-notifications-card) {
  container-type: inline-size;
}

* {
  box-sizing: border-box;
}

[hidden] {
  display: none !important;
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
  border-radius: var(--ha-border-radius-m, 8px);
  padding: 8px 12px;
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
  border-radius: var(--ha-border-radius-m, 8px);
  margin-bottom: 18px;
}

.nc-tab {
  flex: 1;
  border: 0;
  background: transparent;
  padding: 8px 10px;
  border-radius: var(--ha-border-radius-s, 4px);
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
  border-radius: var(--ha-card-border-radius, 12px);
  padding: 16px;
  box-shadow: var(--ha-box-shadow);
}

.nc-section {
  background: transparent;
}

.nc-section-content {
  padding: 0 16px 16px;
}

.nc-reminder-options {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.nc-section-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(244, 67, 54, 0.12);
  color: var(--error-color);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
}

.nc-section-status.active {
  background: rgba(76, 175, 80, 0.14);
  color: var(--success-color, #4caf50);
}

.nc-alert {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 14px;
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

.nc-alert-icon ha-icon {
  --mdc-icon-size: 24px;
}

.nc-alert-main {
  min-width: 0;
}

.nc-alert-name {
  font-weight: 700;
  font-size: 17px;
}

.nc-alert-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
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

.nc-alert-actions .nc-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 9px;
}

.nc-alert-actions ha-icon {
  --mdc-icon-size: 16px;
}

.nc-alert-statuses {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
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

.nc-status ha-icon {
  --mdc-icon-size: 14px;
}

.nc-status.active {
  background: rgba(244, 67, 54, 0.14);
  color: var(--error-color);
}

.nc-status.ok {
  background: rgba(76, 175, 80, 0.14);
  color: var(--success-color, #4caf50);
}

.nc-status.idle {
  background: rgba(33, 150, 243, 0.12);
  color: var(--info-color, #2196f3);
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
.nc-yaml textarea,
.nc-code-editor {
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  background: var(--card-background-color);
  color: var(--primary-text-color);
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  padding: 10px;
}

ha-code-editor.nc-code-editor {
  display: block;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}

ha-code-editor.nc-code-editor .cm-editor,
ha-code-editor.nc-code-editor .cm-scroller,
ha-code-editor.nc-code-editor .cm-content {
  max-width: 100%;
}

ha-code-editor.nc-code-editor .cm-scroller {
  overflow-x: auto;
}

.nc-history {
  display: grid;
  gap: 8px;
}

.nc-history-filter {
  display: grid;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 4px 0 12px;
  background: var(--card-background-color);
  border-bottom: 1px solid var(--divider-color);
}

.nc-history-filter-heading,
.nc-history-controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.nc-history-filter-heading {
  align-items: center;
  justify-content: space-between;
}

.nc-history-filter-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--secondary-text-color);
  font-size: 13px;
  font-weight: 700;
}

.nc-history-filter-label ha-icon {
  --mdc-icon-size: 18px;
  color: var(--primary-color);
}

.nc-history-filter-heading .nc-history-clear {
  min-height: 0;
  padding: 0;
  background: transparent;
  color: var(--secondary-text-color);
  font-size: 13px;
  line-height: 18px;
}

.nc-history-controls ha-input {
  --ha-input-padding-bottom: 0px;
  min-height: 36px;
  box-sizing: border-box;
}

.nc-history-controls ha-selector {
  flex: 0 1 180px;
  min-width: 150px;
  min-height: 36px;
  box-sizing: border-box;
}

.nc-history-search {
  flex: 1 1 220px;
  min-width: 180px;
}

.nc-history-no-results,
.nc-history-count {
  padding: 16px 0;
  color: var(--secondary-text-color);
}

.nc-history-count {
  padding-top: 4px;
  font-size: 12px;
}

.nc-history-filter-title {
  font-weight: 700;
}

.nc-history-filter-subtitle {
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-history-item {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 9px 6px;
  border-bottom: 1px solid var(--divider-color);
}

.nc-history-item.clickable {
  cursor: pointer;
}

.nc-history-item.clickable:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}

.nc-history-time {
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-history-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.nc-history-title {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  min-width: 0;
  gap: 6px;
  font-weight: 700;
}

.nc-history-alert-link {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.nc-history-alert-link:hover {
  text-decoration: underline;
}

.nc-history-title .nc-history-alert-link {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nc-history-title .nc-history-badge,
.nc-history-title .nc-history-flow {
  flex: 0 0 auto;
}

.nc-history-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 700;
}

.nc-history-badge.error {
  background: rgba(244, 67, 54, 0.14);
  color: var(--error-color);
}

.nc-history-badge.success {
  background: rgba(76, 175, 80, 0.14);
  color: var(--success-color, #4caf50);
}

.nc-history-badge.info {
  background: rgba(33, 150, 243, 0.12);
  color: var(--info-color, #2196f3);
}

.nc-history-badge.muted {
  background: var(--secondary-background-color);
  color: var(--secondary-text-color);
}

.nc-history-flow {
  display: inline-flex;
  align-items: center;
  max-width: 180px;
  overflow: hidden;
  border: 1px solid var(--divider-color);
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--secondary-text-color);
  font-family: monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nc-details {
  margin-top: 6px;
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-details summary {
  cursor: pointer;
}

.nc-history-details {
  margin-top: 0;
}

.nc-details pre {
  margin: 6px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: var(--secondary-background-color);
  white-space: pre-wrap;
}

.nc-yaml {
  display: grid;
  gap: 12px;
}

.nc-yaml textarea,
.nc-code-editor {
  width: 100%;
  min-height: min(650px, 70vh);
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
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
}

.nc-editor-shell {
  background: var(--card-background-color);
  color: var(--primary-text-color);
  border-radius: 16px;
  box-shadow: var(--ha-box-shadow);
  overflow: hidden;
}

.nc-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--divider-color);
}

.nc-editor-header h1,
.nc-editor-header h2 {
  margin: 0;
}

.nc-editor-header h1 {
  font-size: 22px;
}

.nc-editor-identity {
  min-width: 0;
  flex: 1 1 auto;
}

.nc-editor-title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  min-width: 0;
  gap: 10px;
}

.nc-editor-title-row h1,
.nc-editor-title-row h2 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nc-editor-title-separator {
  color: var(--secondary-text-color);
  font-size: 18px;
}

.nc-editor-header h2 {
  color: var(--secondary-text-color);
  font-size: 18px;
  font-weight: 500;
}

.nc-editor-section-controls {
  display: flex;
  align-items: center;
  min-width: 118px;
  flex: 0 1 auto;
}

.nc-section-manage-button {
  display: none;
}

.nc-editor-validation {
  padding: 10px 24px;
  border-bottom: 1px solid var(--divider-color);
  background: color-mix(in srgb, var(--warning-color, #ff9800) 12%, transparent);
  color: var(--primary-text-color);
  font-size: 13px;
  line-height: 1.45;
}

.nc-editor-shell > .nc-modal-header {
  background: var(--card-background-color);
  color: var(--primary-text-color);
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

.nc-discard-modal {
  width: min(440px, 100%);
}

.nc-discard-modal p {
  margin: 0;
  line-height: 1.5;
}

.nc-modal-header {
  background: var(--secondary-background-color);
  padding: 20px;
  border-bottom: 1px solid var(--divider-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  .nc-editor-shell > .nc-modal-header {
    background: var(--card-background-color);
    color: var(--primary-text-color);
  }
  margin: 0;
}

.nc-modal-body {
  padding: 24px;
}

.nc-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 232px;
  grid-template-areas: "content sidebar";
  gap: 28px;
}

.nc-section-header {
  grid-area: sidebar;
  position: sticky;
  top: 0;
  z-index: 15;
  align-self: start;
  display: grid;
  gap: 2px;
  padding: 4px 0 4px 14px;
  border-left: 1px solid var(--divider-color);
  background: transparent;
}

.nc-mobile-section-menu {
  display: none;
}

.nc-section-nav-row {
  display: flex;
  align-items: center;
  min-width: 0;
}

.nc-section-header .nc-section-nav-button {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
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
  justify-content: flex-start;
  gap: 7px;
}

.nc-section-header .nc-section-nav-button > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nc-section-header .nc-section-nav-button:hover {
  background: var(--primary-background-color);
  color: var(--primary-text-color);
}

.nc-section-header .nc-section-nav-button.active {
  background: var(--secondary-background-color);
  color: var(--primary-text-color);
  box-shadow: none;
  border-left: 3px solid var(--primary-color);
  padding-left: 9px;
}

.nc-section-header .nc-section-nav-button.nc-section-nav-child {
  width: calc(100% - 12px);
  margin-left: 12px;
  font-size: 12px;
}

.nc-section-collapse-button {
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
}

.nc-section-collapse-button:hover {
  background: var(--secondary-background-color);
  color: var(--primary-text-color);
}

.nc-section-collapse-button ha-icon {
  --mdc-icon-size: 18px;
}

.nc-optional-setting[hidden] {
  display: none;
}

.nc-section-header .nc-section-status {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--error-color);
}

.nc-section-header .nc-section-status.active {
  background: var(--success-color, #4caf50);
}

.nc-section:not(.active) {
  display: none;
}

.nc-editor-sections {
  grid-area: content;
  min-width: 0;
}

.nc-modal-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  align-items: center;
  flex-wrap: wrap;
  padding: 16px 20px;
  border-top: 1px solid var(--divider-color);
  background: var(--card-background-color);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.nc-editor-state {
  margin-right: auto;
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-yaml-utility {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--divider-color);
}

.nc-yaml-utility .nc-alert-yaml-editor {
  min-height: 360px;
}

.nc-section {
  border: 0;
  border-radius: 0;
  padding: 0 0 28px;
  margin-bottom: 28px;
}

.nc-section-content {
  padding: 0;
}

.nc-section-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 18px;
}

.nc-setting-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.nc-setting-state {
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-icon-button {
  display: inline-grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
}

.nc-icon-button:hover {
  background: var(--secondary-background-color);
  color: var(--primary-text-color);
}

.nc-icon-button.danger:hover {
  color: var(--error-color);
}

.nc-icon-button ha-icon {
  --mdc-icon-size: 20px;
}

.nc-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 22px;
}

.nc-field {
  display: grid;
  gap: 10px;
}

.nc-field.full {
  grid-column: 1 / -1;
}

.nc-field label {
  font-weight: 600;
  font-size: 15px;
}

.nc-field-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  font-size: 15px;
}

.nc-monitor-settings {
  display: grid;
  gap: 26px;
}

.nc-monitor-toggles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 28px;
}

.nc-monitor-toggle {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  width: 100%;
  font-size: 15px;
  font-weight: 600;
}

.nc-monitor-toggle ha-switch,
.nc-field-heading ha-switch {
  flex: 0 0 auto;
}

.nc-field ha-input,
.nc-field ha-icon-picker,
.nc-field ha-selector {
  display: block;
  width: 100%;
}

.nc-field ha-selector.nc-description-input {
  width: 100%;
}

.nc-field ha-icon-picker {
  width: min(100%, 14rem);
}

.nc-field ha-input.nc-duration-input,
.nc-field ha-input.nc-number-field {
  width: min(100%, 10rem);
}

.nc-field ha-selector.nc-duration-input {
  display: block;
  width: min(100%, 24rem);
  max-width: 100%;
}

ha-code-editor.nc-action-editor {
  --code-editor-background-color: var(--secondary-background-color);
  --code-editor-gutter-color: var(--secondary-background-color);
  display: block;
  width: 100%;
  height: auto;
  min-height: 0;
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

.nc-recipient-toolbar ha-input {
  min-width: 0;
  width: 100%;
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
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  z-index: 50;
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



.nc-switch-label {
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  cursor: pointer;
}

.nc-setting-group {
  display: grid;
  gap: 14px;
}

.nc-subfield {
  display: grid;
  gap: 8px;
  width: min(100%, 24rem);
  color: var(--primary-text-color);
  font-size: 15px;
  font-weight: 600;
}

.nc-setting-row {
  justify-content: space-between;
  width: 100%;
}

.nc-confirmation-clear {
  margin-top: 16px;
}

.nc-duration-input {
  font-variant-numeric: tabular-nums;
}

.nc-help {
  margin-top: 12px;
  color: var(--secondary-text-color);
  font-size: 12px;
  line-height: 1.5;
}

.nc-template-help-trigger {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 10px;
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-template-help-trigger .nc-icon-button {
  width: 30px;
  height: 30px;
}

.nc-template-help-modal {
  width: min(560px, 100%);
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  background: var(--secondary-background-color);
}

.nc-condition-row > * {
  min-width: 0;
  max-width: 100%;
}

.nc-condition-row > .nc-field {
  width: 100%;
  min-width: 0;
  align-self: start;
}

.nc-condition-row > .nc-condition-duration {
  grid-column: 1 / -1;
}

.nc-condition-row .nc-field ha-input,
.nc-condition-row .nc-field ha-selector {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.nc-condition-row .nc-field ha-selector.nc-duration-input {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.nc-condition-actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-self: end;
  align-self: end;
  justify-content: flex-end;
}

.nc-condition-actions .nc-button {
  white-space: nowrap;
}

.nc-condition-id-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.nc-condition-id-toggle ha-icon {
  --mdc-icon-size: 16px;
}

.nc-error {
  color: var(--error-color);
  background: rgba(244, 67, 54, 0.1);
  border-radius: 9px;
  padding: 10px;
  white-space: pre-wrap;
}

.nc-toast-list {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 20000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nc-toast {
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--primary-text-color);
  color: var(--primary-background-color);
  box-shadow: var(--ha-box-shadow);
}

.nc-toast.error {
  background: var(--error-color);
  color: white;
}

@container (min-width: 701px) and (max-width: 980px) {
  .nc-condition-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (max-width: 700px) {
  .nc-page {
    padding: 14px;
  }

  .nc-editor-view {
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
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
    width: 100%;
  }

  .nc-alert-actions .nc-button {
    justify-content: center;
    min-width: 0;
    padding: 8px 4px;
  }

  .nc-alert-actions .nc-button-label {
    display: none;
  }

  .nc-grid,
  .nc-condition-row,
  .nc-recipient-toolbar {
    grid-template-columns: 1fr;
  }

  .nc-monitor-toggles {
    grid-template-columns: 1fr;
  }

  .nc-modal-body {
    padding: 16px;
  }

  .nc-editor-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: flex-start;
    gap: 6px;
    padding: 16px;
  }

  .nc-editor-identity {
    grid-column: 1;
    grid-row: 1;
  }

  .nc-editor-section-controls {
    min-width: 0;
    width: auto;
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .nc-editor-title-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
  }

  .nc-editor-title-separator {
    display: none;
  }

  .nc-editor-header h1 {
    font-size: 20px;
  }

  .nc-editor-header h2 {
    font-size: 14px;
  }

  .nc-editor-validation {
    padding: 10px 16px;
  }

  .nc-editor-layout {
    display: block;
    position: relative;
  }

  .nc-editor-shell {
    overflow: visible;
  }

  .nc-editor-header {
    position: relative;
    z-index: 100;
  }

  .nc-section-header:not(.nc-mobile-section-menu) {
    display: none;
  }

  .nc-section-manage-button {
    display: inline-grid;
    grid-column: 2;
    grid-row: 1;
    width: 40px;
    min-height: 40px;
    padding: 8px;
  }

  .nc-section-manage-button ha-icon {
    --mdc-icon-size: 20px;
  }

  .nc-mobile-section-menu {
    display: none;
    position: absolute;
    top: calc(100% - 8px);
    right: 16px;
    z-index: 110;
    width: min(300px, calc(100% - 32px));
    gap: 2px;
    padding: 8px;
    border: 1px solid var(--divider-color);
    border-radius: 10px;
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
  }

  .nc-mobile-section-menu.mobile-open {
    display: grid;
  }

  .nc-toolbar,
  .nc-yaml .nc-actions {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .nc-yaml .nc-actions .nc-button {
    width: 100%;
  }

  .nc-code-editor,
  ha-code-editor.nc-alert-yaml-editor {
    min-height: min(420px, 62vh);
  }

  .nc-history-item {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .nc-history-filter-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .nc-history-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .nc-history-controls .nc-history-search {
    grid-column: 1 / -1;
  }

  .nc-history-controls ha-input,
  .nc-history-controls ha-selector,
  .nc-history-controls .nc-button {
    width: 100%;
  }
}

@media (min-width: 801px) and (max-width: 980px) {
  .nc-condition-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (min-width: 701px) and (max-width: 800px) {
  .nc-condition-row {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 701px) and (max-width: 800px) {
  .nc-condition-row {
    grid-template-columns: 1fr;
  }
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
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
    width: 100%;
  }

  .nc-alert-actions .nc-button {
    justify-content: center;
    min-width: 0;
    padding: 8px 4px;
  }

  .nc-alert-actions .nc-button-label {
    display: none;
  }

  .nc-grid {
    grid-template-columns: 1fr;
  }

  .nc-modal-body {
    padding: 16px;
  }

  .nc-editor-layout {
    display: block;
    position: relative;
  }

  .nc-editor-shell {
    overflow: visible;
  }

  .nc-editor-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    position: relative;
    align-items: start;
    gap: 6px;
    padding: 16px;
    z-index: 100;
  }

  .nc-editor-identity {
    grid-column: 1;
    grid-row: 1;
  }

  .nc-editor-section-controls {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .nc-section-header:not(.nc-mobile-section-menu) {
    display: none;
  }

  .nc-section-manage-button {
    display: inline-grid;
    grid-column: 2;
    grid-row: 1;
    width: 40px;
    min-height: 40px;
    padding: 8px;
  }

  .nc-section-manage-button ha-icon {
    --mdc-icon-size: 20px;
  }

  .nc-mobile-section-menu {
    display: none;
    position: absolute;
    top: calc(100% - 8px);
    right: 16px;
    z-index: 110;
    width: min(300px, calc(100% - 32px));
    gap: 2px;
    padding: 8px;
    border: 1px solid var(--divider-color);
    border-radius: 10px;
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
  }

  .nc-mobile-section-menu.mobile-open {
    display: grid;
  }

  .nc-toolbar,
  .nc-yaml .nc-actions {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .nc-yaml .nc-actions .nc-button {
    width: 100%;
  }

  .nc-code-editor,
  ha-code-editor.nc-alert-yaml-editor {
    min-height: min(420px, 62vh);
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

  .nc-history-filter-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .nc-history-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .nc-history-controls .nc-history-search {
    grid-column: 1 / -1;
  }

  .nc-history-controls ha-input,
  .nc-history-controls ha-selector,
  .nc-history-controls .nc-button {
    width: 100%;
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

ha-code-editor.nc-alert-yaml-editor {
  --code-editor-background-color: var(--secondary-background-color);
  --code-editor-gutter-color: var(--secondary-background-color);
  display: block;
  min-height: min(650px, 70vh);
}
`;
