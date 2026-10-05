import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { mdiCheckDecagramOutline, mdiClose, mdiCodeBraces, mdiInformationOutline } from "@mdi/js";
import { errorMessage, getMobilePlatforms } from "../api.js";
import type { Alert, Hass } from "../types.js";
import { createLocalizer } from "../localize.js";
import { actions, haButton, NarrowController, navMenu, notify, uiStyles, type Action } from "../ui.js";
import { editableAlert, finalizeAlert } from "./alert-model.js";
import { editorSections, sectionStatus, type EditorSection, type EditorState, type SchemaField } from "./sections.js";

export interface OpenEditorOptions {
  root: ShadowRoot;
  hass: Hass;
  alert?: Alert | null;
  users: { value: string; label: string }[];
  onSave: (alert: Alert) => Promise<Alert | void>;
  onClosed?: () => void;
  onValidateAlert: (alert: Alert) => Promise<unknown>;
}

const TAG = "ha-notifications-alert-editor";

interface HelpEntry {
  title?: string;
  text: string;
}

const styles = css`
  ha-top-app-bar-fixed {
    --app-header-background-color: var(--sidebar-background-color);
    --app-header-text-color: var(--sidebar-text-color);
  }

  .nc-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 240px;
    gap: var(--ha-space-6, 24px);
    max-width: 1100px;
    margin: 0 auto;
    padding: var(--ha-space-6, 24px);
  }

  .nc-layout.narrow {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--ha-space-4, 16px);
    padding: var(--ha-space-4, 16px);
  }

  .nc-nav {
    position: sticky;
    top: 0;
  }

  ha-card .card-content {
    display: grid;
    gap: var(--ha-space-4, 16px);
    min-width: 0;
  }

  ha-form {
    min-width: 0;
    --code-mirror-height: auto;
    --code-mirror-max-height: unset;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    padding-bottom: var(--ha-space-6, 24px);
  }

  .card-header h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--ha-font-size-xl, 24px);
    font-weight: var(--ha-font-weight-normal, 400);
  }

  .nc-heading {
    display: inline-flex;
    align-items: center;
    gap: var(--ha-space-1, 4px);
  }

  .nc-help {
    --mdc-icon-button-size: 32px;
    --mdc-icon-size: 20px;
    color: var(--secondary-text-color);
  }

  .nc-help-content {
    display: grid;
    gap: var(--ha-space-6, 24px);
    padding-block: var(--ha-space-2, 8px);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .nc-help-topic + .nc-help-topic {
    border-top: 1px solid var(--divider-color);
    padding-top: var(--ha-space-5, 20px);
  }

  .nc-help-topic h3 {
    margin: 0 0 var(--ha-space-2, 8px);
    font-size: var(--ha-font-size-m, 16px);
    font-weight: var(--ha-font-weight-medium, 500);
  }

  .nc-help-topic p {
    margin: 0;
    line-height: 1.65;
    color: var(--secondary-text-color);
    white-space: pre-line;
  }

  .nc-option {
    display: grid;
    gap: var(--ha-space-3, 12px);
    min-width: 0;
  }

  .nc-option-input {
    display: flex;
    align-items: center;
    gap: var(--ha-space-3, 12px);
  }

  .nc-option-input ha-form {
    flex: 1;
  }

  input[type="color"] {
    flex-shrink: 0;
    width: 48px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--divider-color);
    border-radius: var(--ha-border-radius-sm, 4px);
    background: none;
    cursor: pointer;
  }

  ha-settings-row {
    padding: 0;
    border-bottom: 1px solid var(--divider-color);
  }

  .nc-dirty {
    margin-inline-end: var(--ha-space-2, 8px);
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
  }
`;

class AlertEditor extends LitElement {
  static styles = [uiStyles, styles];

  private layout = new NarrowController(this);
  private options!: OpenEditorOptions;
  private state!: EditorState;
  private active = editorSections[0];
  private dirty = false;
  private saving = false;
  private dialog: "discard" | "yaml" | "help" | null = null;
  private helpTitle = "";
  private helpEntries: HelpEntry[] = [];
  private yaml: Alert | null = null;
  private platforms: ("android" | "ios")[] = [];
  private platformUnknown = true;
  private platformLoading = false;
  private platformRequest = 0;
  private editorObserver?: MutationObserver;
  private editorSizingTimer?: ReturnType<typeof setTimeout>;
  // ha-form re-creates its fields when the schema identity changes; keep it stable.
  private schemas = new Map<string, { key: string; schema: SchemaField[] }>();

  init(options: OpenEditorOptions): void {
    this.options = options;
    const alert = editableAlert(options.alert);
    this.state = {
      hass: options.hass,
      localize: createLocalizer(options.hass),
      alert,
      postConfirmationActions: alert.confirmation.actions.length > 0,
      users: options.users,
    };
  }

  set hass(hass: Hass) {
    this.state.hass = hass;
    this.state.localize = createLocalizer(hass);
    this.requestUpdate();
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.loadPlatforms();
    void this.state.hass.loadFragmentTranslation?.("config")
      .then(() => this.requestUpdate())
      .catch((error: unknown) => notify(this, errorMessage(error)));
  }

  disconnectedCallback(): void {
    this.editorObserver?.disconnect();
    clearTimeout(this.editorSizingTimer);
    super.disconnectedCallback();
  }

  protected updated(): void {
    this.editorObserver?.disconnect();
    clearTimeout(this.editorSizingTimer);
    const observed = new WeakSet<Node>();
    const inspect = (root: ParentNode): void => {
      if (!observed.has(root)) {
        observed.add(root);
        this.editorObserver!.observe(root, { childList: true, subtree: true });
      }
      for (const element of root.querySelectorAll<HTMLElement>("*")) {
        if (element.localName === "ha-code-editor") {
          const view = (element as HTMLElement & {
            codemirror?: { dom: HTMLElement; scrollDOM?: HTMLElement; contentDOM?: HTMLElement };
          }).codemirror;
          if (view) {
            const messageEditor = this.active.key === "notification" && this.dialog === null;
            const minimumHeight = messageEditor ? 320 : this.layout.narrow ? 320 : 420;
            const contentHeight = `${minimumHeight - 40}px`;
            view.dom.style.minHeight = `${minimumHeight}px`;
            if (view.scrollDOM) {
              view.scrollDOM.style.minHeight = contentHeight;
              view.scrollDOM.style.backgroundColor = "var(--secondary-background-color)";
            }
            if (view.contentDOM) view.contentDOM.style.minHeight = contentHeight;
            const gutter = view.dom.querySelector<HTMLElement>(".cm-gutters");
            if (gutter) gutter.style.minHeight = contentHeight;
          }
        }
        if (element.shadowRoot) inspect(element.shadowRoot);
      }
    };
    let pending = false;
    const inspectAfterRender = async (): Promise<void> => {
      if (pending) return;
      pending = true;
      try {
        for (let pass = 0; pass < 8 && this.isConnected; pass++) {
          const updates: Promise<unknown>[] = [];
          const collect = (root: ParentNode): void => {
            for (const element of root.querySelectorAll<HTMLElement>("*")) {
              const update = (element as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
              if (update) updates.push(update);
              if (element.shadowRoot) collect(element.shadowRoot);
            }
          };
          collect(this.renderRoot);
          await Promise.all(updates);
          if (this.isConnected) inspect(this.renderRoot);
        }
      } finally {
        pending = false;
      }
    };
    this.editorObserver = new MutationObserver(() => { void inspectAfterRender(); });
    inspect(this.renderRoot);
    void inspectAfterRender();
    const retry = (remaining: number): void => {
      this.editorSizingTimer = setTimeout(() => {
        if (!this.isConnected) return;
        inspect(this.renderRoot);
        if (remaining > 0) retry(remaining - 1);
      }, 100);
    };
    retry(19);
  }

  protected render(): TemplateResult {
    const { localize: t, alert } = this.state;
    const narrow = this.layout.narrow;
    const section = this.active;
    const menu: Action[] = [
      { label: t("editor.common.view_yaml"), path: mdiCodeBraces, action: this.showYaml },
      ...(section.validate
        ? [{ label: t(section.validate.label), path: mdiCheckDecagramOutline, action: () => this.validate(section) }]
        : []),
    ];
    const nav = navMenu(
      editorSections.map((item) => ({
        key: item.key,
        label: ["android", "ios"].includes(item.key) && !this.platformLoading && this.platforms.includes(item.key as "android" | "ios")
          ? `${t(item.title)} (${t("editor.mobile.recipient_match")})`
          : t(item.title),
        child: Boolean(item.parent),
        status: sectionStatus(item, this.state),
      })),
      section.key,
      this.select,
      narrow,
      t("editor.common.alert_sections"),
      { on: t("alert.enabled"), off: t("alert.disabled") },
    );

    return html`<ha-top-app-bar-fixed .narrow=${narrow}>
        <ha-icon-button
          slot="navigationIcon"
          .label=${t("editor.common.cancel")}
          .path=${mdiClose}
          @click=${() => this.close()}
        ></ha-icon-button>
        <div slot="title">${alert.name.trim() || t("editor.common.new_alert")}</div>
        <span slot="actionItems" class="nc-dirty">${this.dirty ? t("editor.common.unsaved_changes") : ""}</span>
        <div slot="actionItems">${actions(menu, narrow)}</div>
        ${haButton(t("editor.common.save_alert"), this.save, { disabled: this.saving, slot: "actionItems" })}
        <div class="nc-layout ${narrow ? "narrow" : ""}">
          ${narrow ? nav : nothing}
          <ha-card>
            <div class="card-header"><h2>${section.toggle
              ? `${t(section.toggle.get(this.state) ? "alert.enabled" : "alert.disabled")}: ${t(section.title)}`
              : t(section.title)}</h2>${this.sectionHelp(section)}${this.sectionToggle(section)}</div>
            <div class="card-content">${this.platformStatus(section)}${this.form(section)}</div>
          </ha-card>
          ${narrow ? nothing : nav}
        </div>
      </ha-top-app-bar-fixed>
      ${this.dialogs()}`;
  }

  private form(section: EditorSection, field?: SchemaField): TemplateResult {
    const s = this.state;
    if (section.toggle && !section.toggle.get(s)) return html``;
    if (section.optional && !field) {
      return html`${this.schema(section).map(item => {
        if ("boolean" in item.selector) return this.form(section, item);
        const enabled = section.optional!.enabled(s, item.name);
        const label = s.localize(section.labels[item.name]);
        const helperKey = section.helpers?.[item.name];
        const helper = helperKey ? s.localize(helperKey) : undefined;
        return html`<div class="nc-option">
          <ha-settings-row>
            <span slot="heading" class="nc-heading">${label}${helper && helper !== helperKey ? this.helpButton(label, helper) : nothing}</span>
            <ha-switch .checked=${enabled} aria-label=${`${s.localize(enabled ? "alert.disable" : "alert.enable")} ${label}`}
              @change=${(event: Event) => {
                section.optional!.set(s, item.name, (event.currentTarget as HTMLInputElement).checked);
                this.changed();
              }}></ha-switch>
          </ha-settings-row>
          ${enabled ? html`<div class="nc-option-input">${["color", "ledColor", "notification_icon_color"].includes(item.name)
            ? html`<input type="color" aria-label=${`${label} ${s.localize("editor.mobile.picker")}`}
                .value=${/^#[0-9a-f]{6}$/i.test(String(section.read(s)[item.name])) ? String(section.read(s)[item.name]) : "#03a9f4"}
                @input=${(event: Event) => {
                  section.write(s, { [item.name]: (event.currentTarget as HTMLInputElement).value });
                  this.changed();
                }}>` : nothing}${this.form(section, item)}</div>` : nothing}
        </div>`;
      })}`;
    }
    return html`<ha-form
      .hass=${s.hass}
      .narrow=${this.layout.narrow}
      .schema=${this.schema(section, field)}
      .data=${section.read(s)}
      .computeLabel=${(field: SchemaField) => s.localize(section.labels[field.name] ?? field.name)}
      .computeHelper=${(field: SchemaField) => {
        if (section.optional && !("boolean" in field.selector)) return undefined;
        const key = section.helpers?.[field.name];
        if (!key) return undefined;
        const helper = s.localize(key);
        return helper === key ? undefined : helper;
      }}
      @expanded-will-change=${(event: CustomEvent<{ expanded: boolean }>) => {
        const panels = event.composedPath().filter((target): target is HTMLElement =>
          target instanceof HTMLElement && target.localName === "ha-expansion-panel");
        if (panels.length !== 1) return;
        panels[0].style.setProperty(
          "--expansion-panel-content-padding",
          event.detail.expanded ? "var(--ha-space-6, 24px) var(--ha-space-4, 16px)" : "0",
        );
      }}
      @value-changed=${(event: CustomEvent<{ value: Record<string, unknown> }>) => {
        section.write(s, field ? { [field.name]: event.detail.value[field.name] } : event.detail.value);
        if (section.key === "recipients") void this.loadPlatforms();
        this.changed();
      }}
    ></ha-form>`;
  }

  private async loadPlatforms(): Promise<void> {
    const request = ++this.platformRequest;
    this.platformLoading = true;
    this.requestUpdate();
    try {
      const result = await getMobilePlatforms(this.state.hass, this.state.alert.notification.target);
      if (request !== this.platformRequest || !this.isConnected) return;
      this.platforms = result.platforms;
      this.platformUnknown = result.unknown;
    } catch {
      if (request !== this.platformRequest || !this.isConnected) return;
      this.platforms = [];
      this.platformUnknown = true;
    } finally {
      if (request === this.platformRequest && this.isConnected) {
        this.platformLoading = false;
        this.requestUpdate();
      }
    }
  }

  private helpButton(title: string, content: string | HelpEntry[]): TemplateResult {
    const label = `${this.state.localize("editor.common.more_info")}: ${title}`;
    return html`<ha-icon-button class="nc-help" .path=${mdiInformationOutline} .label=${label} title=${label}
      @click=${() => {
        this.helpTitle = title;
        this.helpEntries = typeof content === "string" ? [{ text: content }] : content;
        this.dialog = "help";
        this.requestUpdate();
      }}></ha-icon-button>`;
  }

  private sectionHelp(section: EditorSection): TemplateResult | typeof nothing {
    const t = this.state.localize;
    const entries = Object.entries(section.helpers ?? {}).flatMap(([name, key]) => {
      const text = t(key);
      return text === key ? [] : [{ title: t(section.labels[name]), text }];
    });
    if (section.toggle?.help) entries.unshift({ title: "", text: t(section.toggle.help) });
    return entries.length ? this.helpButton(t(section.title), entries) : nothing;
  }

  private platformStatus(section: EditorSection): TemplateResult | typeof nothing {
    if (section.key !== "mobile") return nothing;
    const t = this.state.localize;
    const labels = this.platforms.map(platform => t(`editor.mobile.${platform}`));
    if (this.platformUnknown) labels.push(t("editor.mobile.unknown"));
    return html`<ha-settings-row>
      <span slot="heading">${t("editor.mobile.platforms")}</span>
      <span role="status">${this.platformLoading ? t("editor.mobile.detecting") : labels.join(", ")}</span>
    </ha-settings-row>`;
  }

  private schema(section: EditorSection, field?: SchemaField): SchemaField[] {
    const schema = field ? [field] : section.schema(this.state);
    const cacheKey = field ? `${section.key}.${field.name}` : section.key;
    const key = JSON.stringify(schema);
    const cached = this.schemas.get(cacheKey);
    if (cached?.key === key) return cached.schema;
    this.schemas.set(cacheKey, { key, schema });
    return schema;
  }

  private sectionToggle(section: EditorSection): TemplateResult | typeof nothing {
    const toggle = section.toggle;
    if (!toggle) return nothing;
    const t = this.state.localize;
    const enabled = toggle.get(this.state);
    return html`<ha-switch
        .checked=${enabled}
        aria-label=${`${t(enabled ? "alert.disable" : "alert.enable")} ${t(section.title)}`}
        @change=${(event: Event) => {
          toggle.set(this.state, (event.currentTarget as HTMLInputElement).checked);
          this.changed();
        }}
      ></ha-switch>`;
  }

  private dialogs(): TemplateResult | typeof nothing {
    const t = this.state.localize;
    if (this.dialog === "help") {
      return html`<ha-dialog open width="medium" .headerTitle=${this.helpTitle} @closed=${this.closeDialog}>
        <div class="nc-help-content">${this.helpEntries.map(entry => html`<section class="nc-help-topic">
          ${entry.title ? html`<h3>${entry.title}</h3>` : nothing}
          <p>${entry.text}</p>
        </section>`)}</div>
        <div slot="footer">${haButton(t("editor.common.close"), this.closeDialog)}</div>
      </ha-dialog>`;
    }
    if (this.dialog === "discard") {
      return html`<ha-dialog
        open
        type="alert"
        width="small"
        .headerTitle=${t("editor.common.discard_title")}
        @closed=${this.closeDialog}
      >
        <p>${t("editor.common.discard_message")}</p>
        <div slot="footer">
          ${haButton(t("editor.common.stay"), this.closeDialog, { appearance: "plain" })}
          ${haButton(t("editor.common.discard"), () => this.close(true), { variant: "danger" })}
        </div>
      </ha-dialog>`;
    }
    if (this.dialog === "yaml") {
      return html`<ha-dialog open width="large" .headerTitle=${t("editor.common.alert_yaml")} @closed=${this.closeDialog}>
        <ha-yaml-editor .hass=${this.state.hass} .defaultValue=${this.yaml} read-only copy-clipboard></ha-yaml-editor>
      </ha-dialog>`;
    }
    return nothing;
  }

  private changed(): void {
    this.dirty = true;
    this.requestUpdate();
  }

  private select = (key: string): void => {
    this.active = editorSections.find((section) => section.key === key) ?? this.active;
    this.requestUpdate();
  };

  private closeDialog = (): void => {
    this.dialog = null;
    this.requestUpdate();
  };

  private payload(validate = true): Alert {
    return finalizeAlert(this.state.alert, this.state.postConfirmationActions, validate);
  }

  private async validate(section: EditorSection): Promise<void> {
    try {
      await this.options.onValidateAlert(this.payload(false));
      notify(this, this.state.localize(section.validate!.success));
    } catch (error) {
      notify(this, errorMessage(error));
    }
  }

  private showYaml = (): void => {
    try {
      this.yaml = this.payload(false);
      this.dialog = "yaml";
      this.requestUpdate();
    } catch (error) {
      notify(this, errorMessage(error));
    }
  };

  private save = async (): Promise<void> => {
    try {
      const payload = this.payload();
      this.saving = true;
      this.requestUpdate();
      await this.options.onSave(payload);
      this.close(true);
    } catch (error) {
      notify(this, errorMessage(error));
    } finally {
      this.saving = false;
      this.requestUpdate();
    }
  };

  private close(force = false): void {
    if (!force && this.dirty) {
      this.dialog = "discard";
      this.requestUpdate();
      return;
    }
    this.remove();
    this.options.onClosed?.();
  }
}

if (!customElements.get(TAG)) {
  customElements.define(TAG, AlertEditor);
}

export function openEditor(options: OpenEditorOptions): void {
  if (options.root.querySelector(TAG)) return;
  const editor = document.createElement(TAG) as AlertEditor;
  editor.init(options);
  options.root.append(editor);
}

export function updateOpenEditorHass(root: ShadowRoot, hass: Hass): void {
  const editor = root.querySelector<AlertEditor>(TAG);
  if (editor) editor.hass = hass;
}
