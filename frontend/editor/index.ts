import { css, html, LitElement, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { mdiCheckDecagramOutline, mdiClose, mdiCodeBraces } from "@mdi/js";
import { errorMessage, request } from "../api.js";
import type { Alert, Hass } from "../types.js";
import { createLocalizer, optionalTranslation, type Localize } from "../localize.js";
import { actions, haButton, NarrowController, navMenu, notify, toolbar, uiStyles, type Action } from "../ui.js";
import { editableAlert, finalizeAlert, type EditableAlert } from "./alert-model.js";
import "./setting-row.js";
import { insetNativeEditors, nativeEditorKind } from "./native-editor.js";
import type { EnabledChangedDetail, HelpEntry, HelpRequestDetail } from "./setting-row.js";
import {
  editorSections, embeddedSections, findSection, hasOptionValues, isFieldEnabled, isSectionEnabled, readField,
  rootSection, sectionStatus, setFieldEnabled, setSectionEnabled, writeField, type EditorField, type EditorSection,
} from "./sections.js";

const styles = css`
  :host {
    --nc-field-width: 400px;
    --nc-help-width: 32px;
  }

  ha-top-app-bar-fixed {
    --app-header-background-color: var(--primary-background-color);
    --app-header-text-color: var(--primary-text-color);
  }

  ha-card {
    color: var(--primary-text-color);
  }

  ha-card > section {
    padding: var(--ha-space-5, 20px) var(--ha-space-4, 16px);
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

  .card-header {
    padding-bottom: var(--ha-space-6, 24px);
  }

  .card-header .nc-toolbar {
    width: 100%;
    padding: 0;
    border: 0;
  }

  .card-header .nc-toolbar-start {
    overflow: visible;
    white-space: normal;
    color: var(--primary-text-color);
  }

  .card-header h2 {
    min-width: 0;
    margin: 0;
    font-size: var(--ha-font-size-l, 20px);
    font-weight: var(--ha-font-weight-normal, 400);
  }

  .card-content,
  .nc-embedded {
    display: grid;
    gap: var(--ha-space-4, 16px);
    min-width: 0;
  }

  .nc-embedded-title {
    font-size: var(--ha-font-size-m, 16px);
    font-weight: var(--ha-font-weight-medium, 500);
  }

  .nc-title-group {
    display: grid;
    gap: var(--ha-space-1, 4px);
    min-width: 0;
  }

  .nc-platform-summary {
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
    line-height: 1.4;
  }

  .nc-heading {
    display: inline-flex;
    align-items: center;
    gap: var(--ha-space-1, 4px);
    min-width: 0;
  }

  .nc-heading > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  ha-form {
    min-width: 0;
    --code-mirror-height: auto;
    --code-mirror-max-height: unset;
  }

  ha-form.nc-code-form,
  ha-yaml-editor.nc-yaml-preview {
    --code-mirror-height: 320px;
  }

  /* The native code editor only draws its top bar and gutter. */
  ha-form.nc-code-form {
    display: block;
    overflow: hidden;
    border: 1px solid var(--divider-color);
    border-radius: var(--ha-border-radius-sm, 4px);
  }

  .nc-field-input {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--nc-help-width);
    align-items: start;
    gap: var(--ha-space-2, 8px);
    flex: 1 1 0;
    max-width: calc(var(--nc-field-width) + var(--nc-help-width) + var(--ha-space-2, 8px));
    min-width: 0;
  }

  .nc-field-input.nc-wide {
    flex-basis: 100%;
    max-width: none;
  }

  .nc-field-input.nc-wide:not(:has(> ha-notifications-help-icon)) {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Center on the 56px native field, not the form box with its bottom spacing. */
  .nc-field-input > ha-notifications-help-icon {
    margin-top: var(--ha-space-3, 12px);
  }

  input[type="color"] {
    flex: none;
    width: 48px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--divider-color);
    border-radius: var(--ha-border-radius-sm, 4px);
    background: none;
    cursor: pointer;
  }

  .nc-info-dialog {
    --ha-dialog-width-sm: 420px;
    --ha-dialog-width-full: calc(100vw - 32px);
    --ha-dialog-min-height: auto;
    --ha-dialog-max-height: calc(100dvh - 48px);
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

  .nc-dirty {
    margin-inline-end: var(--ha-space-2, 8px);
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
  }
`;

export interface OpenEditorOptions {
  root: ShadowRoot;
  hass: Hass;
  alert?: Alert | null;
  onSave: (alert: Alert) => Promise<Alert | void>;
  onClosed?: () => void;
  onValidateAlert: (alert: Alert) => Promise<unknown>;
}

type EditorDialog =
  | { type: "help"; title: string; entries: HelpEntry[] }
  | { type: "yaml"; alert: Alert }
  | { type: "discard" }
  | null;

type Platform = "android" | "ios";

type PlatformDetection =
  | { status: "loading" }
  | { status: "ready"; platforms: Platform[]; unknown: boolean }
  | { status: "error" };

type Selector = Record<string, unknown>;

const TAG = "ha-notifications-alert-editor" as const;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Large editors own their whole row; their help moves into the section heading. */
function isBlockField(field: EditorField): boolean {
  return Boolean(nativeEditorKind(field.selector)) || ["template", "object", "target"].some(type => type in field.selector);
}

function isWideField(section: EditorSection, field: EditorField): boolean {
  if ((field.selector.select as { multiple?: boolean } | undefined)?.multiple) return true;
  if ("number" in field.selector || "duration" in field.selector) return false;
  return !section.options;
}

class AlertEditor extends LitElement {
  static styles = [uiStyles, styles];
  static properties = {
    hass: { attribute: false },
    selected: { state: true },
    dirty: { state: true },
    saving: { state: true },
    dialog: { state: true },
    platformDetection: { state: true },
  };

  declare hass: Hass;
  declare private selected: string;
  declare private dirty: boolean;
  declare private saving: boolean;
  declare private dialog: EditorDialog;
  declare private platformDetection: PlatformDetection;
  private layout = new NarrowController(this);
  private options!: OpenEditorOptions;
  private alert!: EditableAlert;
  private localizeText!: Localize;
  // ha-form re-creates its fields when the schema identity changes; keep it stable.
  private schemas = new Map<string, { key: string; schema: Selector[] }>();

  constructor() {
    super();
    this.selected = editorSections[0].key;
    this.dirty = false;
    this.saving = false;
    this.dialog = null;
    this.platformDetection = { status: "loading" };
    this.addEventListener("help-request", this.showHelp.bind(this));
  }

  init(options: OpenEditorOptions): void {
    this.options = options;
    this.hass = options.hass;
    this.alert = editableAlert(options.alert);
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.loadPlatforms();
    void this.hass.loadFragmentTranslation?.("config")
      .then(() => this.requestUpdate())
      .catch((error: unknown) => notify(this, errorMessage(error)));
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("hass")) this.localizeText = createLocalizer(this.hass);
  }

  protected updated(): void {
    for (const form of this.renderRoot.querySelectorAll<HTMLElement>("ha-form[data-native-editor]")) void insetNativeEditors(form);
  }

  protected render(): TemplateResult {
    const narrow = this.layout.narrow;
    const section = this.currentSection();
    return html`<ha-top-app-bar-fixed .narrow=${narrow}>
        <ha-icon-button slot="navigationIcon" .label=${this.localizeText("editor.common.cancel")} .path=${mdiClose}
          @click=${() => this.close()}></ha-icon-button>
        <div slot="title">${this.alert.name.trim() || this.localizeText("editor.common.new_alert")}</div>
        ${this.renderActions()}
        <div class=${classMap({ "nc-layout": true, narrow })}>
          ${narrow ? this.renderNavigation(section) : nothing}
          <ha-card>
            <section data-section=${section.key}>
              ${this.renderHeader(section)}
              <div class="card-content">
                ${this.renderFields(section)}
                ${embeddedSections(section).map(child => this.renderEmbeddedSection(child))}
              </div>
            </section>
          </ha-card>
          ${narrow ? nothing : this.renderNavigation(section)}
        </div>
      </ha-top-app-bar-fixed>
      ${this.renderDialog()}`;
  }

  private renderActions(): TemplateResult {
    return html`<span slot="actionItems" class="nc-dirty">${this.dirty ? this.localizeText("editor.common.unsaved_changes") : ""}</span>
      <div slot="actionItems">${actions([
        { label: this.localizeText("editor.common.view_yaml"), path: mdiCodeBraces, action: this.showYaml },
      ], this.layout.narrow)}</div>
      ${haButton(this.localizeText("editor.common.save_alert"), this.save, { disabled: this.saving, slot: "actionItems" })}`;
  }

  private renderNavigation(current: EditorSection): TemplateResult {
    const items = editorSections
      .filter(section => !section.embedded && !this.platformUnavailable(section))
      .map(section => ({
        key: section.key,
        label: this.sectionLabel(section),
        child: Boolean(section.parent),
        status: sectionStatus(this.alert, section),
      }));
    return navMenu(items, current.key, this.select, this.layout.narrow, this.localizeText("editor.common.alert_sections"),
      { on: this.localizeText("alert.enabled"), off: this.localizeText("alert.disabled") });
  }

  private renderHeader(section: EditorSection): TemplateResult {
    const validation: Action[] = section.validate
      ? [{ label: this.localizeText(`editor.${section.key}.validate`), path: mdiCheckDecagramOutline, action: () => this.validate(section) }]
      : [];
    const title = html`<div class="nc-title-group">
      <div class="nc-heading"><h2>${this.sectionLabel(section)}</h2>${this.renderSectionHelp(section)}</div>
      ${section.key === "recipients" ? this.renderPlatformSummary() : nothing}
    </div>`;
    return html`<div class="card-header">${toolbar(title, validation, this.layout.narrow, this.renderSectionSwitch(section))}</div>`;
  }

  private renderEmbeddedSection(section: EditorSection): TemplateResult {
    return html`<div class="nc-embedded" data-embedded-section=${section.key}>
      <div class="nc-embedded-title">
        <span class="nc-heading"><span>${this.sectionLabel(section)}</span>${this.renderSectionHelp(section)}</span>
      </div>
      ${this.renderFields(section)}
    </div>`;
  }

  private renderSectionSwitch(section: EditorSection): TemplateResult | undefined {
    if (!section.toggle) return undefined;
    return this.renderSwitch(Boolean(isSectionEnabled(this.alert, section)), this.sectionLabel(section),
      enabled => this.setSectionEnabled(section, enabled));
  }

  private renderSwitch(enabled: boolean, label: string, change: (enabled: boolean) => void, slot?: string): TemplateResult {
    return html`<ha-notifications-feature-switch slot=${slot ?? nothing} .enabled=${enabled}
      .label=${`${this.localizeText(enabled ? "alert.disable" : "alert.enable")} ${label}`}
      @enabled-changed=${(event: CustomEvent<EnabledChangedDetail>) => change(event.detail.enabled)}></ha-notifications-feature-switch>`;
  }

  private renderFields(section: EditorSection): TemplateResult[] {
    return section.fields(this.alert).map(field => this.renderField(section, field));
  }

  private renderField(section: EditorSection, field: EditorField): TemplateResult {
    if ("boolean" in field.selector) return this.renderBooleanField(section, field);
    if ("color_hex" in field.selector) return this.renderColorField(section, field);
    if (isBlockField(field)) return this.renderForm(section, field);
    return html`<ha-notifications-setting-row data-editor-field=${field.name}>
      <div class=${classMap({ "nc-field-input": true, "nc-wide": isWideField(section, field) })}>
        ${this.renderForm(section, field)}${this.renderFieldHelp(section, field)}
      </div>
      ${this.renderFieldSwitch(section, field)}
    </ha-notifications-setting-row>`;
  }

  private renderColorField(section: EditorSection, field: EditorField): TemplateResult {
    const label = this.fieldLabel(section, field);
    const value = readField(this.alert, field);
    return html`<ha-notifications-setting-row data-editor-field=${field.name}>
      <input type="color" aria-label=${label} .value=${HEX_COLOR.test(String(value)) ? String(value) : this.themeColor()}
        @input=${(event: Event) => this.edit(section, field, (event.currentTarget as HTMLInputElement).value)}>
      <span slot="label">${label}</span>${this.renderFieldHelp(section, field, "help")}
      ${this.renderFieldSwitch(section, field)}
    </ha-notifications-setting-row>`;
  }

  private renderFieldSwitch(section: EditorSection, field: EditorField): TemplateResult | typeof nothing {
    if (!section.options) return nothing;
    return this.renderSwitch(isFieldEnabled(this.alert, section, field), this.fieldLabel(section, field),
      enabled => this.setFieldEnabled(section, field, enabled), "toggle");
  }

  private renderBooleanField(section: EditorSection, field: EditorField): TemplateResult {
    const label = this.fieldLabel(section, field);
    return html`<ha-notifications-setting-row data-editor-field=${field.name}>
      <span slot="label">${label}</span>${this.renderFieldHelp(section, field, "help")}
      <ha-switch slot="toggle" .checked=${readField(this.alert, field) as boolean} .disabled=${Boolean(field.disabled)}
        aria-label=${label} @change=${(event: Event) => this.edit(section, field, (event.currentTarget as HTMLInputElement).checked)}></ha-switch>
    </ha-notifications-setting-row>`;
  }

  private renderForm(section: EditorSection, field: EditorField): TemplateResult {
    const label = this.fieldLabel(section, field);
    const block = isBlockField(field);
    return html`<ha-form
      data-editor-section=${section.key}
      class=${classMap({ "nc-code-form": "template" in field.selector })}
      data-native-editor=${nativeEditorKind(field.selector) ?? nothing}
      aria-label=${block ? label : nothing}
      .hass=${this.hass}
      .narrow=${this.layout.narrow}
      .schema=${this.schema(section, field)}
      .data=${{ [field.name]: readField(this.alert, field) }}
      .computeLabel=${() => (block ? "" : label)}
      @value-changed=${(event: CustomEvent<{ value: Record<string, unknown> }>) => this.edit(section, field, event.detail.value[field.name])}
    ></ha-form>`;
  }

  private renderFieldHelp(section: EditorSection, field: EditorField, slot?: string): TemplateResult | typeof nothing {
    const text = this.fieldHelp(section, field);
    if (!text) return nothing;
    return this.renderHelpIcon(this.fieldLabel(section, field), [{ text }], slot);
  }

  private renderSectionHelp(section: EditorSection): TemplateResult | typeof nothing {
    const entries: HelpEntry[] = [];
    const help = optionalTranslation(this.localizeText, `editor.${section.key}.helper`);
    if (help) entries.push({ text: help });
    for (const field of section.fields(this.alert).filter(isBlockField)) {
      const text = this.fieldHelp(section, field);
      if (text) entries.push({ title: this.fieldLabel(section, field), text });
    }
    if (!entries.length) return nothing;
    return this.renderHelpIcon(this.sectionLabel(section), entries);
  }

  private renderHelpIcon(heading: string, entries: HelpEntry[], slot?: string): TemplateResult {
    return html`<ha-notifications-help-icon slot=${slot ?? nothing} .heading=${heading}
      .moreInfo=${this.localizeText("editor.common.more_info")} .entries=${entries}></ha-notifications-help-icon>`;
  }

  private renderPlatformSummary(): TemplateResult {
    const detection = this.platformDetection;
    let summary: string;
    if (detection.status === "loading") summary = this.localizeText("editor.recipients.detecting");
    else if (detection.status === "error") summary = this.localizeText("editor.recipients.unknown");
    else {
      const labels = detection.platforms.map(platform => this.localizeText(`editor.${platform}.label`));
      if (detection.unknown) labels.push(this.localizeText("editor.recipients.unknown"));
      summary = labels.join(", ") || this.localizeText("editor.recipients.no_platforms");
    }
    return html`<span class="nc-platform-summary" role="status">${summary}</span>`;
  }

  private renderDialog(): TemplateResult | typeof nothing {
    if (this.dialog?.type === "help") return this.renderHelpDialog(this.dialog.title, this.dialog.entries);
    if (this.dialog?.type === "discard") return this.renderDiscardDialog();
    if (this.dialog?.type === "yaml") return this.renderYamlDialog(this.dialog.alert);
    return nothing;
  }

  private renderHelpDialog(title: string, entries: HelpEntry[]): TemplateResult {
    return html`<ha-dialog class="nc-info-dialog" open type="alert" width="small" .headerTitle=${title} @closed=${this.closeDialog}>
      <div class="nc-help-content">${entries.map(entry => html`<section class="nc-help-topic">
        ${entry.title ? html`<h3>${entry.title}</h3>` : nothing}
        <p>${entry.text}</p>
      </section>`)}</div>
      <div slot="footer">${haButton(this.localizeText("editor.common.close"), this.closeDialog)}</div>
    </ha-dialog>`;
  }

  private renderDiscardDialog(): TemplateResult {
    return html`<ha-dialog open type="alert" width="small" .headerTitle=${this.localizeText("editor.common.discard.title")} @closed=${this.closeDialog}>
      <p>${this.localizeText("editor.common.discard.message")}</p>
      <div slot="footer">
        ${haButton(this.localizeText("editor.common.stay"), this.closeDialog, { appearance: "plain" })}
        ${haButton(this.localizeText("editor.common.discard.label"), () => this.close(true), { variant: "danger" })}
      </div>
    </ha-dialog>`;
  }

  private renderYamlDialog(alert: Alert): TemplateResult {
    return html`<ha-dialog open width="large" .headerTitle=${this.localizeText("editor.common.alert_yaml")} @closed=${this.closeDialog}>
      <ha-yaml-editor class="nc-yaml-preview" .hass=${this.hass} .defaultValue=${alert} read-only></ha-yaml-editor>
    </ha-dialog>`;
  }

  private sectionLabel(section: EditorSection): string {
    return this.localizeText(`editor.${section.key}.label`);
  }

  private fieldLabel(section: EditorSection, field: EditorField): string {
    return this.localizeText(`editor.${section.key}.${field.name}.label`);
  }

  private fieldHelp(section: EditorSection, field: EditorField): string | undefined {
    return optionalTranslation(this.localizeText, `editor.${section.key}.${field.name}.helper`);
  }

  private themeColor(): string {
    const color = getComputedStyle(this).getPropertyValue("--primary-color").trim();
    return HEX_COLOR.test(color) ? color : "#03a9f4";
  }

  /** Stable one-field schema with select options and object field labels localized by convention. */
  private schema(section: EditorSection, field: EditorField): Selector[] {
    const { path: _path, read: _read, write: _write, ...item } = field;
    // ha-form renders an optional field's `default` as its placeholder.
    const placeholder = optionalTranslation(this.localizeText, `editor.${section.key}.${field.name}.placeholder`);
    const schema = [{ ...item, selector: this.localizeSelector(section, field), ...(placeholder ? { default: placeholder } : {}) }];
    const cacheKey = `${section.key}.${field.name}`;
    const key = JSON.stringify(schema);
    const cached = this.schemas.get(cacheKey);
    if (cached?.key === key) return cached.schema;
    this.schemas.set(cacheKey, { key, schema });
    return schema;
  }

  private localizeSelector(section: EditorSection, field: EditorField): Selector {
    const prefix = `editor.${section.key}.${field.name}`;
    const { select, object } = field.selector as {
      select?: { options: string[] };
      object?: { fields?: Record<string, Selector> };
    };
    if (select) {
      const options = select.options.map(value => ({ value, label: optionalTranslation(this.localizeText, `${prefix}.options.${value}`) ?? value }));
      return { select: { ...select, options } };
    }
    if (object?.fields) {
      const fields = Object.fromEntries(Object.entries(object.fields)
        .map(([name, item]) => [name, { ...item, label: this.localizeText(`${prefix}.fields.${name}`) }]));
      return { object: { ...object, fields } };
    }
    return field.selector;
  }

  private currentSection(): EditorSection {
    const section = findSection(this.selected);
    return this.platformUnavailable(section) ? rootSection(section) : section;
  }

  /** Hide a platform section nobody receives unless it is enabled or configured. */
  private platformUnavailable(section: EditorSection): boolean {
    const platform = section.options;
    return (platform === "android" || platform === "ios")
      && this.platformDetection.status === "ready"
      && !this.platformDetection.unknown
      && !this.platformDetection.platforms.includes(platform)
      && !isSectionEnabled(this.alert, section)
      && !hasOptionValues(this.alert, section);
  }

  private edit(section: EditorSection, field: EditorField, value: unknown): void {
    writeField(this.alert, section, field, value);
    if (section.key === "recipients") void this.loadPlatforms();
    this.changed();
  }

  private setSectionEnabled(section: EditorSection, enabled: boolean): void {
    setSectionEnabled(this.alert, section, enabled);
    this.changed();
  }

  private setFieldEnabled(section: EditorSection, field: EditorField, enabled: boolean): void {
    setFieldEnabled(this.alert, section, field, enabled);
    // An enabled picker with no stored value would show a color that is never sent.
    if (enabled && "color_hex" in field.selector && !readField(this.alert, field)) {
      writeField(this.alert, section, field, this.themeColor());
    }
    this.changed();
  }

  private changed(): void {
    this.dirty = true;
    this.requestUpdate();
  }

  private async loadPlatforms(): Promise<void> {
    const pending: PlatformDetection = { status: "loading" };
    this.platformDetection = pending;
    let detection: PlatformDetection;
    try {
      const result = await request<{ platforms: Platform[]; unknown: boolean }>(
        this.hass, "mobile_platforms", { target: this.alert.notification.target },
      );
      detection = { status: "ready", ...result };
    } catch {
      detection = { status: "error" };
    }
    if (this.platformDetection !== pending || !this.isConnected) return;
    this.platformDetection = detection;
  }

  private showHelp(event: Event): void {
    const { title, entries } = (event as CustomEvent<HelpRequestDetail>).detail;
    this.dialog = { type: "help", title, entries };
  }

  private select = (key: string): void => {
    this.selected = key;
  };

  private closeDialog = (): void => {
    this.dialog = null;
  };

  private async validate(section: EditorSection): Promise<void> {
    try {
      await this.options.onValidateAlert(finalizeAlert(this.alert, false));
      notify(this, this.localizeText(`editor.${section.key}.valid`));
    } catch (error) {
      notify(this, errorMessage(error));
    }
  }

  private showYaml = (): void => {
    try {
      this.dialog = { type: "yaml", alert: finalizeAlert(this.alert, false) };
    } catch (error) {
      notify(this, errorMessage(error));
    }
  };

  private save = async (): Promise<void> => {
    if (this.saving) return;
    try {
      const payload = finalizeAlert(this.alert);
      this.saving = true;
      await this.options.onSave(payload);
      this.close(true);
    } catch (error) {
      notify(this, errorMessage(error));
    } finally {
      this.saving = false;
    }
  };

  private close(force = false): void {
    if (!force && this.dirty) {
      this.dialog = { type: "discard" };
      return;
    }
    this.remove();
    this.options.onClosed?.();
  }
}

if (!customElements.get(TAG)) {
  customElements.define(TAG, AlertEditor);
}

declare global {
  interface HTMLElementTagNameMap {
    [TAG]: AlertEditor;
  }
}

export function openEditor(options: OpenEditorOptions): void {
  if (options.root.querySelector(TAG)) return;
  const editor = document.createElement(TAG);
  editor.init(options);
  options.root.append(editor);
}

export function updateOpenEditorHass(root: ShadowRoot, hass: Hass): void {
  const editor = root.querySelector(TAG);
  if (editor) editor.hass = hass;
}
