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
.nc-yaml textarea {
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

.nc-yaml textarea {
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

.nc-target-select {
  min-height: 130px;
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

  .nc-history-item {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
`;