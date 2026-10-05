import { css, html, LitElement, nothing } from "lit";
import { mdiCheckDecagramOutline, mdiReload } from "@mdi/js";
import { errorMessage, getConfig, reload, saveConfig, validateConfig } from "../api.js";
import type { Hass } from "../types.js";
import { localize } from "../localize.js";
import { haButton, NarrowController, notify, toolbar, uiStyles } from "../ui.js";

const styles = css`
  ha-alert {
    display: block;
    margin: var(--ha-space-2, 8px) var(--ha-space-4, 16px) 0;
  }

  ha-yaml-editor {
    display: block;
    padding: var(--ha-space-2, 8px);
  }
`;
class YamlView extends LitElement {
  static properties = { hass: { attribute: false } };
  static styles = [uiStyles, styles];

  declare hass: Hass;
  private layout = new NarrowController(this);
  private config: Record<string, unknown> | null = null;
  private draft: unknown = null;
  private valid = true;
  private busy = false;
  /** Unsaved edits; the panel asks before leaving the tab. */
  dirty = false;

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
    return !this.dirty || window.confirm(this.t("yaml.unsaved"));
  }

  private warnUnsaved = (event: BeforeUnloadEvent): void => {
    if (this.dirty) event.preventDefault();
  };

  protected firstUpdated(): void {
    void this.load();
  }

  private t = (key: string) => localize(this.hass, key);

  protected render() {
    return html`<ha-card>
      ${toolbar(
        this.t("yaml.description"),
        [
          { label: this.t("yaml.validate"), path: mdiCheckDecagramOutline, action: this.validate, disabled: this.busy },
          { label: this.t("yaml.reload"), path: mdiReload, action: this.reload, disabled: this.busy },
        ],
        this.layout.narrow,
        haButton(this.t("yaml.save"), this.save, { disabled: this.busy || !this.valid }),
      )}
      ${this.valid
        ? nothing
        : html`<ha-alert alert-type="error">${this.t("yaml.invalid")}</ha-alert>`}
      ${this.config
        ? html`<ha-yaml-editor
            .hass=${this.hass}
            .defaultValue=${this.config}
            .label=${this.t("yaml.aria")}
            @value-changed=${(event: CustomEvent<{ value: unknown; isValid: boolean }>) => {
              event.stopPropagation();
              this.draft = event.detail.value;
              this.valid = event.detail.isValid;
              this.dirty = true;
              this.requestUpdate();
            }}
          ></ha-yaml-editor>`
        : html``}
    </ha-card>`;
  }

  private async load(): Promise<void> {
    try {
      this.config = (await getConfig(this.hass)) as unknown as Record<string, unknown>;
      this.draft = this.config;
      this.valid = true;
      this.dirty = false;
      this.requestUpdate();
    } catch (error) {
      notify(this, errorMessage(error));
    }
  }

  private mapping(): Record<string, unknown> {
    if (!this.valid || !this.draft || typeof this.draft !== "object" || Array.isArray(this.draft)) {
      throw new Error("YAML must contain a mapping.");
    }
    return this.draft as Record<string, unknown>;
  }

  /** Run one busy action at a time and report its outcome. */
  private async run(task: () => Promise<string>): Promise<void> {
    this.busy = true;
    this.requestUpdate();
    try {
      notify(this, await task());
    } catch (error) {
      notify(this, errorMessage(error));
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }

  private validate = () =>
    this.run(async () => {
      await validateConfig(this.hass, this.mapping());
      return this.t("yaml.valid");
    });

  private reload = () =>
    this.run(async () => {
      await reload(this.hass);
      this.config = null;
      this.requestUpdate();
      await this.load();
      return this.t("yaml.reloaded");
    });

  private save = () =>
    this.run(async () => {
      const result = await saveConfig(this.hass, this.mapping());
      if (!result.saved) throw new Error(this.t("yaml.not_saved"));
      this.dirty = false;
      this.dispatchEvent(new CustomEvent("yaml-saved", { bubbles: true, composed: true }));
      return this.t("yaml.saved");
    });
}

if (!customElements.get("ha-notifications-yaml-view")) {
  customElements.define("ha-notifications-yaml-view", YamlView);
}
