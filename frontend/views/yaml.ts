import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { mdiCheckDecagramOutline, mdiInformationOutline, mdiReload } from "@mdi/js";
import { errorMessage, request } from "../api.js";
import type { Hass } from "../types.js";
import { localize } from "../localize.js";
import { haButton, NarrowController, notify, toolbar, uiStyles } from "../ui.js";

const styles = css`
  :host {
    display: block;
    min-width: 0;
    max-width: 100%;
  }

  ha-card {
    min-width: 0;
    max-width: 100%;
  }

  .nc-yaml-title {
    display: flex;
    align-items: center;
    gap: var(--ha-space-1, 4px);
    min-width: 0;
    color: var(--primary-text-color);
  }

  .nc-yaml-title strong {
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: var(--ha-font-size-m, 16px);
  }

  .nc-yaml-title ha-icon-button {
    flex-shrink: 0;
    color: var(--secondary-text-color);
  }

  ha-alert {
    display: block;
    margin: var(--ha-space-2, 8px) var(--ha-space-4, 16px) 0;
  }

  ha-yaml-editor {
    display: block;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    --code-mirror-height: max(160px, calc(100dvh - 240px));
    --code-mirror-max-height: max(160px, calc(100dvh - 240px));
    padding: var(--ha-space-2, 8px);
  }
`;
class YamlView extends LitElement {
  static properties = {
    hass: { attribute: false },
    config: { state: true },
    draft: { state: true },
    valid: { state: true },
    dirty: { state: true },
    busy: { state: true },
  };
  static styles = [uiStyles, styles];

  declare hass: Hass;
  private layout = new NarrowController(this);
  declare private config: Record<string, unknown> | null;
  declare private draft: unknown;
  declare private valid: boolean;
  declare private busy: boolean;
  /** Unsaved edits; the panel asks before leaving the tab. */
  declare dirty: boolean;

  constructor() {
    super();
    this.config = null;
    this.setDraft(null, true, false);
    this.busy = false;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("beforeunload", this.warnUnsaved);
  }

  disconnectedCallback(): void {
    window.removeEventListener("beforeunload", this.warnUnsaved);
    super.disconnectedCallback();
  }

  /** Ask before discarding unsaved edits; returns whether leaving is fine. */
  confirmLeave(): boolean {
    return !this.dirty || window.confirm(this.localizeText("yaml.unsaved"));
  }

  private warnUnsaved = (event: BeforeUnloadEvent): void => {
    if (this.dirty) event.preventDefault();
  };

  protected firstUpdated(): void {
    void this.load().catch(error => notify(this, errorMessage(error)));
  }

  private localizeText = (key: string) => localize(this.hass, key);

  protected render() {
    return html`<ha-card>
      ${toolbar(
        html`<div class="nc-yaml-title">
          <strong>${this.localizeText("yaml.aria")}</strong>
          <ha-icon-button id="yaml-help" .path=${mdiInformationOutline}
            .label=${this.localizeText("yaml.about.label")} aria-describedby="yaml-help-tooltip"
          ></ha-icon-button>
          <ha-tooltip id="yaml-help-tooltip" for="yaml-help">${this.localizeText("yaml.about.helper")}</ha-tooltip>
        </div>`,
        [
          { label: this.localizeText("yaml.validate.label"), tooltip: this.localizeText("yaml.validate.helper"), path: mdiCheckDecagramOutline, action: this.validate, disabled: this.busy },
          { label: this.localizeText("yaml.reload.label"), tooltip: this.localizeText("yaml.reload.helper"), path: mdiReload, action: this.reload, disabled: this.busy },
        ],
        this.layout.narrow,
        haButton(this.localizeText("yaml.save"), this.save, { disabled: this.busy || !this.valid }),
      )}
      ${this.renderValidation()}
      ${this.renderEditor()}
    </ha-card>`;
  }

  private renderValidation(): TemplateResult | typeof nothing {
    if (this.valid) return nothing;
    return html`<ha-alert alert-type="error">${this.localizeText("yaml.invalid")}</ha-alert>`;
  }

  private renderEditor(): TemplateResult | typeof nothing {
    if (!this.config) return nothing;
    return html`<ha-yaml-editor
      .hass=${this.hass}
      .defaultValue=${this.config}
      .label=${""}
      aria-label=${this.localizeText("yaml.aria")}
      @value-changed=${this.editDocument}
    ></ha-yaml-editor>`;
  }

  private editDocument = (event: CustomEvent<{ value: unknown; isValid: boolean }>): void => {
    event.stopPropagation();
    this.setDraft(event.detail.value, event.detail.isValid);
  };

  private setDraft(value: unknown, valid: boolean, dirty = true): void {
    this.draft = value;
    this.valid = valid;
    this.dirty = dirty;
  }

  private async load(): Promise<void> {
    const config = await request<Record<string, unknown>>(this.hass, "get_config");
    if (!this.isConnected) return;
    this.config = config;
    this.setDraft(config, true, false);
  }

  private mapping(): Record<string, unknown> {
    if (!this.valid || !this.draft || typeof this.draft !== "object" || Array.isArray(this.draft)) {
      throw new Error("YAML must contain a mapping.");
    }
    return this.draft as Record<string, unknown>;
  }

  /** Run one busy action at a time and report its outcome. */
  private async run(task: () => Promise<string>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      notify(this, await task());
    } catch (error) {
      notify(this, errorMessage(error));
    } finally {
      this.busy = false;
    }
  }

  private validate = () =>
    this.run(async () => {
      await request(this.hass, "validate_config", { config: this.mapping() });
      return this.localizeText("yaml.valid");
    });

  private reload = () =>
    this.run(async () => {
      await request(this.hass, "reload");
      this.config = null;
      await this.load();
      return this.localizeText("yaml.reloaded");
    });

  private save = () =>
    this.run(async () => {
      const config = this.mapping();
      const result = await request<{ saved: boolean }>(this.hass, "save_config", { config });
      if (!result.saved) throw new Error(this.localizeText("yaml.not_saved"));
      if (this.draft === config) this.setDraft(config, this.valid, false);
      this.dispatchEvent(new CustomEvent("yaml-saved", { bubbles: true, composed: true }));
      return this.localizeText("yaml.saved");
    });
}

if (!customElements.get("ha-notifications-yaml-view")) {
  customElements.define("ha-notifications-yaml-view", YamlView);
}
