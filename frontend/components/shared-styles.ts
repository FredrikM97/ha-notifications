import { css } from "lit";

export const sharedStyles = css`
  .nc-card {
    background: var(--card-background-color);
    border-radius: var(--ha-card-border-radius, 12px);
    padding: 16px;
    box-shadow: var(--ha-box-shadow);
  }

  .nc-empty {
    padding: 55px 20px;
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
    color: var(--secondary-text-color);
    text-align: center;
  }

  .nc-empty h2 {
    color: var(--primary-text-color);
  }
`;