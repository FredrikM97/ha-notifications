import { sharedStyles } from "./components/shared-styles.js";

export const styles = `
${sharedStyles.cssText}
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

.nc-back-button {
  display: none;
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 50%;
  color: var(--primary-text-color);
  background: var(--secondary-background-color);
  text-decoration: none;
}

.nc-back-button:hover {
  background: var(--divider-color);
}

:host(ha-notifications-card) .nc-back-button {
  display: none;
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

.nc-title-icon img {
  width: 32px;
  height: 32px;
  object-fit: contain;
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

.nc-confirmation-add-button {
  justify-self: start;
  border: 1px solid var(--divider-color);
}

.nc-confirmation-controls {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}

.nc-confirmation-button-ids > summary {
  list-style: none;
  cursor: pointer;
  border: 1px solid var(--divider-color);
}

.nc-confirmation-button-ids > summary::-webkit-details-marker {
  display: none;
}

.nc-confirmation-button-id-fields {
  display: grid;
  gap: 12px;
  padding: 12px 0;
}

.nc-confirmation-add-button:hover {
  border-color: var(--primary-color);
  background: color-mix(
    in srgb,
    var(--primary-color) 10%,
    var(--secondary-background-color)
  );
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

.nc-debug-list {
  display: grid;
  gap: 12px;
}

.nc-debug-alert,
.nc-debug-section {
  background: var(--card-background-color);
  border-radius: var(--ha-card-border-radius, 12px);
  box-shadow: var(--ha-box-shadow);
}

.nc-debug-alert > summary,
.nc-debug-section > summary {
  cursor: pointer;
  list-style: none;
}

.nc-debug-alert > summary::-webkit-details-marker,
.nc-debug-section > summary::-webkit-details-marker {
  display: none;
}

.nc-debug-alert > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  font-weight: 600;
}

.nc-debug-alert > summary::before,
.nc-debug-section > summary::before {
  content: ">";
  color: var(--secondary-text-color);
  margin-right: 8px;
}

.nc-debug-alert[open] > summary::before,
.nc-debug-section[open] > summary::before {
  content: "v";
}

.nc-debug-alert > summary code {
  color: var(--secondary-text-color);
  font: var(--code-font, 14px monospace);
  font-weight: 400;
}

.nc-debug-sections {
  display: grid;
  gap: 8px;
  padding: 0 8px 8px;
}

.nc-debug-section {
  box-shadow: none;
  background: var(--primary-background-color);
}

.nc-debug-section > summary {
  padding: 10px 12px;
  color: var(--secondary-text-color);
  font-size: 0.9rem;
  font-weight: 600;
}

.nc-debug-section pre {
  margin: 0;
  padding: 0 12px 12px;
  overflow: auto;
  color: var(--primary-text-color);
  font: var(--code-font, 14px monospace);
  white-space: pre-wrap;
}

.nc-empty {
  text-align: center;
  padding: 55px 20px;
  color: var(--secondary-text-color);
}

.nc-empty h2 {
  color: var(--primary-text-color);
}

@container (max-width: 700px) {
  .nc-page {
    padding: 14px;
  }

  .nc-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
  }

  .nc-back-button {
    display: inline-grid;
    grid-column: 1;
    grid-row: 2;
  }

  .nc-title {
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    justify-self: start;
  }

  .nc-title h1 {
    font-size: 24px;
  }

  .nc-actions {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-end;
    width: 100%;
  }

}

@media (max-width: 700px) {
  .nc-page {
    padding: 14px;
  }

  .nc-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
  }

  .nc-back-button {
    display: inline-grid;
    grid-column: 1;
    grid-row: 2;
  }

  .nc-title {
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    justify-self: start;
  }

  .nc-title h1 {
    font-size: 24px;
  }

  .nc-actions {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-end;
    width: 100%;
  }

}
`;
