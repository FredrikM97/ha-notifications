import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { mdiCheckDecagramOutline, mdiClose, mdiCodeBraces, mdiInformationOutline } from "@mdi/js";
import { errorMessage, request } from "../api.js";
import type { Alert, Hass } from "../types.js";
import { createLocalizer } from "../localize.js";
import { actions, haButton, NarrowController, navMenu, notify, toolbar, uiStyles, type Action } from "../ui.js";
import { editableAlert, finalizeAlert } from "./alert-model.js";
import { editorSections, rootSection, sectionStatus, type EditorSection, type EditorState, type SchemaField } from "./sections.js";

const styles = css`
  :host {
    --nc-standard-field-width: 400px;
    --nc-compact-field-width: 360px;
    --nc-field-width: var(--nc-standard-field-width);
    --nc-help-width: 32px;
  }

  .nc-compact {
    --nc-field-width: var(--nc-compact-field-width);
  }

  ha-top-app-bar-fixed {
    --app-header-background-color: var(--primary-background-color);
    --app-header-text-color: var(--primary-text-color);
  }

  ha-card {
    color: var(--primary-text-color);
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

  ha-card > section {
    padding: var(--ha-space-5, 20px) var(--ha-space-4, 16px);
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

  .nc-embedded-title {
    margin: 0;
    font-size: var(--ha-font-size-m, 16px);
    font-weight: var(--ha-font-weight-medium, 500);
  }

  .nc-embedded {
    display: grid;
    gap: var(--ha-space-3, 12px);
    min-width: 0;
  }

  ha-form {
    min-width: 0;
    --code-mirror-height: auto;
    --code-mirror-max-height: unset;
  }

  ha-form.nc-field-form {
    width: 100%;
    max-width: var(--nc-field-width);
  }

  ha-form.nc-code-form,
  ha-yaml-editor.nc-yaml-preview {
    --code-mirror-height: 420px;
    --code-mirror-max-height: unset;
  }

  .narrow ha-form.nc-code-form,
  ha-form.nc-code-form.nc-message-form,
  ha-yaml-editor.nc-yaml-preview.narrow {
    --code-mirror-height: 320px;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    padding-bottom: var(--ha-space-6, 24px);
  }

  .nc-title-group {
    display: grid;
    flex: 1;
    gap: var(--ha-space-1, 4px);
    min-width: 0;
  }

  .nc-title-row {
    display: flex;
    align-items: center;
    gap: var(--ha-space-1, 4px);
    min-width: 0;
  }

  .card-header h2 {
    flex: 0 1 auto;
    min-width: 0;
    margin: 0;
    font-size: var(--ha-font-size-l, 20px);
    font-weight: var(--ha-font-weight-normal, 400);
  }

  .nc-platform-summary {
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
    line-height: 1.4;
  }

  .card-header > ha-switch {
    flex: none;
    margin-inline-start: auto;
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

  .nc-heading > .nc-help {
    flex: none;
  }

  .nc-help {
    --mdc-icon-button-size: 32px;
    --mdc-icon-size: 20px;
    color: var(--secondary-text-color);
  }

  .nc-info-dialog {
    --ha-dialog-width-sm: 420px;
    --ha-dialog-width-full: calc(100vw - 32px);
    --ha-dialog-min-height: auto;
    --ha-dialog-max-height: calc(100dvh - 48px);
  }

  .nc-native-selector {
    display: grid;
    gap: var(--ha-space-2, 8px);
    min-width: 0;
  }

  .nc-native-label {
    font-size: var(--ha-font-size-m, 16px);
    font-weight: var(--ha-font-weight-medium, 500);
    color: var(--secondary-text-color);
  }

  .nc-field-help {
    display: flex;
    align-items: flex-start;
    gap: var(--ha-space-2, 8px);
    min-width: 0;
  }

  .nc-field-help > ha-form {
    flex: 1;
  }

  .nc-field-help > .nc-help {
    flex: none;
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
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ha-space-2, 8px);
    min-width: 0;
  }

  .nc-option > .nc-heading {
    flex: 0 1 auto;
  }

  .nc-option > ha-switch {
    flex: none;
    margin-inline-start: auto;
  }

  .nc-option-input {
    display: flex;
    align-items: center;
    flex: 1 1 240px;
    min-width: 0;
    gap: var(--ha-space-2, 8px);
  }

  .nc-option-input.nc-field-input {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--nc-help-width);
    flex: 0 1 calc(var(--nc-field-width) + var(--nc-help-width) + var(--ha-space-2, 8px));
    width: 100%;
    max-width: calc(var(--nc-field-width) + var(--nc-help-width) + var(--ha-space-2, 8px));
  }

  .nc-option-input.nc-color-input {
    flex: none;
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
  users: { value: string; label: string }[];
  onSave: (alert: Alert) => Promise<Alert | void>;
  onClosed?: () => void;
  onValidateAlert: (alert: Alert) => Promise<unknown>;
}

interface HelpEntry {
  title?: string;
  text: string;
}

type EditorDialog =
  | { type: "help"; title: string; entries: HelpEntry[] }
  | { type: "yaml"; alert: Alert }
  | { type: "discard" }
  | null;

type PlatformDetection =
  | { status: "loading" }
  | { status: "ready"; platforms: ("android" | "ios")[]; unknown: boolean }
  | { status: "error" };

const TAG = "ha-notifications-alert-editor";

function isNativeSelector(field: { selector?: Record<string, unknown> }): boolean {
  return ["trigger", "condition", "action"].some(type => type in (field.selector ?? {}));
}

function isScalarField(field: SchemaField): boolean {
  return field.name !== "sound" && (
    ["text", "icon", "number", "duration"].some(type => type in field.selector)
    || ("select" in field.selector && !(field.selector.select as { multiple?: boolean }).multiple)
  );
}

function isCompactField(field: SchemaField): boolean {
  return isScalarField(field) && ["number", "duration", "select"].some(type => type in field.selector);
}

class AlertEditor extends LitElement {
  static styles = [uiStyles, styles];
  static properties = {
    platformDetection: { state: true },
    saving: { state: true },
    dialog: { state: true },
  };

  private layout = new NarrowController(this);
  private options!: OpenEditorOptions;
  private state!: EditorState;
  private active = editorSections[0];
  private localSelections = new Map<string, string>();
  private dirty = false;
  declare private saving: boolean;
  declare private dialog: EditorDialog;
  declare private platformDetection: PlatformDetection;
  // ha-form re-creates its fields when the schema identity changes; keep it stable.
  private schemas = new Map<string, { key: string; schema: SchemaField[] }>();

  constructor() {
    super();
    this.platformDetection = { status: "loading" };
    this.saving = false;
    this.dialog = null;
  }

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

  protected render(): TemplateResult {
    const { localize: t, alert } = this.state;
    const section = this.localSections().find(item => item.key === this.localSelections.get(this.active.key)) ?? this.active;

    return html`<ha-top-app-bar-fixed .narrow=${this.layout.narrow}>
        <ha-icon-button
          slot="navigationIcon"
          .label=${t("editor.common.cancel")}
          .path=${mdiClose}
          @click=${() => this.close()}
        ></ha-icon-button>
        <div slot="title">${alert.name.trim() || t("editor.common.new_alert")}</div>
        ${this.renderActions()}
        <div class="nc-layout ${this.layout.narrow ? "narrow" : ""}">
          ${this.layout.narrow ? this.renderNavigation(section) : nothing}
          <ha-card>
            <section>
              <section data-section=${section.key}>
                ${this.renderSectionHeader(section)}
                ${this.renderSectionContent(section)}
              </section>
            </section>
          </ha-card>
          ${this.layout.narrow ? nothing : this.renderNavigation(section)}
        </div>
      </ha-top-app-bar-fixed>
      ${this.dialogs()}`;
  }

  private renderNavigation(section: EditorSection): TemplateResult {
    const t = this.state.localize;
    return navMenu(
      this.navigationSections().map((item) => ({
        key: item.key,
        label: t(item.parent ? item.localTitle ?? item.title : item.title),
        child: Boolean(item.parent),
        status: sectionStatus(item, this.state),
      })),
      section.key,
      this.select,
      this.layout.narrow,
      t("editor.common.alert_sections"),
      { on: t("alert.enabled"), off: t("alert.disabled") },
    );
  }

  private renderActions(): TemplateResult {
    const t = this.state.localize;
    return html`<span slot="actionItems" class="nc-dirty">${this.dirty ? t("editor.common.unsaved_changes") : ""}</span>
      <div slot="actionItems">${actions([
        { label: t("editor.common.view_yaml"), path: mdiCodeBraces, action: this.showYaml },
      ], this.layout.narrow)}</div>
      ${haButton(t("editor.common.save_alert"), this.save, { disabled: this.saving, slot: "actionItems" })}`;
  }

  private renderSectionHeader(section: EditorSection): TemplateResult {
    return html`<div class="card-header">${toolbar(
      this.renderSectionTitle(section), this.validationActions(section), this.layout.narrow, html`${this.sectionToggle(section)}`,
    )}</div>`;
  }

  private validationActions(section: EditorSection): Action[] {
    const sectionActions: Action[] = [];
    if (section.validate) {
      sectionActions.push({
        label: this.state.localize(section.validate.label),
        path: mdiCheckDecagramOutline,
        action: () => this.validate(section),
      });
    }
    return sectionActions;
  }

  private renderSectionTitle(section: EditorSection): TemplateResult {
    return html`<div class="nc-title-group">
      <div class="nc-title-row">${this.labelWithHelp(this.state.localize(section.title), this.sectionHelp(section), true)}</div>
      ${section.key === "recipients" ? this.recipientPlatformSummary() : nothing}
    </div>`;
  }

  private renderSectionContent(section: EditorSection): TemplateResult {
    return html`<div class="card-content">${this.form(section)}${editorSections
      .filter(item => item.embedded && item.parent === section.key)
      .map(item => this.renderEmbeddedSection(item))}</div>`;
  }

  private renderEmbeddedSection(section: EditorSection): TemplateResult {
    return html`<div class="nc-embedded" data-embedded-section=${section.key}>
      <div class="nc-embedded-title">${this.labelWithHelp(this.state.localize(section.title), this.sectionHelp(section))}</div>
      ${this.form(section)}
    </div>`;
  }

  private fieldHelp(section: EditorSection, field: SchemaField, label = this.state.localize(section.labels[field.name])): TemplateResult | typeof nothing {
    const helperKey = section.helpers?.[field.name];
    if (!helperKey) return nothing;
    const helper = this.state.localize(helperKey);
    if (!helper || helper === helperKey) return nothing;
    return this.helpButton(label, helper);
  }

  private renderOptionalField(section: EditorSection, field: SchemaField, disabled: boolean): TemplateResult {
    const s = this.state;
    const label = s.localize(section.labels[field.name]);
    if ("boolean" in field.selector) {
      return html`<div class="nc-option nc-option-inline">
        ${this.labelWithHelp(label, this.fieldHelp(section, field))}
        <ha-switch .checked=${Boolean(section.read(s)[field.name])} .disabled=${disabled}
          aria-label=${label} @change=${(event: Event) => this.applyOptionalBooleanChange(section, field, disabled, event)}></ha-switch>
      </div>`;
    }
    const enabled = section.optional!.enabled(s, field.name);
    const color = ["color", "ledColor", "notification_icon_color"].includes(field.name);
    return html`<div class="nc-option nc-option-inline">
      ${this.renderOptionalInput(section, field, disabled, enabled)}
      ${color ? this.labelWithHelp(label, this.fieldHelp(section, field)) : nothing}
      <ha-switch .checked=${enabled} .disabled=${disabled} aria-label=${`${s.localize(enabled ? "alert.disable" : "alert.enable")} ${label}`}
        @change=${(event: Event) => this.applyOptionalToggle(section, field, disabled, event)}></ha-switch>
    </div>`;
  }

  private applyOptionalBooleanChange(section: EditorSection, field: SchemaField, disabled: boolean, event: Event): void {
    if (disabled) return;
    section.write(this.state, { [field.name]: (event.currentTarget as HTMLInputElement).checked });
    this.changed();
  }

  private applyOptionalToggle(section: EditorSection, field: SchemaField, disabled: boolean, event: Event): void {
    if (disabled) return;
    const checked = (event.currentTarget as HTMLInputElement).checked;
    section.optional!.set(this.state, field.name, checked);
    if (checked && ["color", "ledColor", "notification_icon_color"].includes(field.name) && !section.read(this.state)[field.name]) {
      const primaryColor = this.themePrimaryColor();
      if (primaryColor) section.write(this.state, { [field.name]: primaryColor });
    }
    this.changed();
  }

  private renderOptionalInput(section: EditorSection, field: SchemaField, disabled: boolean, enabled: boolean): TemplateResult {
    if (["color", "ledColor", "notification_icon_color"].includes(field.name)) {
      return html`<div class="nc-option-input nc-color-input">${this.renderColorInput(section, field, disabled || !enabled)}</div>`;
    }
    return html`<div class=${classMap({
      "nc-option-input": true,
      "nc-field-input": isScalarField(field),
      "nc-compact": isCompactField(field),
    })}>${this.form(section, field)}${this.fieldHelp(section, field)}</div>`;
  }

  private renderColorInput(section: EditorSection, field: SchemaField, disabled: boolean): TemplateResult {
    return html`<input type="color" ?disabled=${disabled}
      aria-label=${`${this.state.localize(section.labels[field.name])} ${this.state.localize("editor.mobile.picker")}`}
      .value=${this.colorValue(section, field)}
      @input=${(event: Event) => this.applyColorChange(section, field, disabled, event)}>`;
  }

  private colorValue(section: EditorSection, field: SchemaField): string {
    const group = section.key === "mobile" ? "general" : section.key as "android" | "ios";
    const value = String(section.read(this.state)[field.name] ?? this.state.mobileDrafts?.[group]?.fields?.[field.name]?.value);
    return /^#[0-9a-f]{6}$/i.test(value) ? value : this.themePrimaryColor();
  }

  private applyColorChange(section: EditorSection, field: SchemaField, disabled: boolean, event: Event): void {
    if (disabled) return;
    section.write(this.state, { [field.name]: (event.currentTarget as HTMLInputElement).value });
    this.changed();
  }

  private form(section: EditorSection, field?: SchemaField): TemplateResult {
    const s = this.state;
    if (this.platformUnavailable(section)) return html``;
    const disabled = this.sectionDisabled(section);
    const fields = field ? [field] : section.schema(s);
    if (section.optional && !field) {
      return html`${fields.map(item => this.renderOptionalField(section, item, disabled))}`;
    }
    if (!field && fields.length > 1 && (section.helperIcons?.length || fields.some(item =>
      isScalarField(item) || isNativeSelector(item) || "template" in item.selector || "object" in item.selector))) {
      return html`${fields.map(item => this.form(section, item))}`;
    }
    const helperField = fields.length === 1 && section.helperIcons?.includes(fields[0].name) ? fields[0] : undefined;
    if (helperField && "boolean" in helperField.selector) {
      return this.renderBooleanField(section, helperField, disabled);
    }
    return this.renderFormControl(section, fields, field);
  }

  private renderBooleanField(section: EditorSection, field: SchemaField, disabled: boolean): TemplateResult {
    const s = this.state;
    const label = s.localize(section.labels[field.name] ?? field.name);
    const controlDisabled = disabled || Boolean(field.disabled);
    return html`<div class="nc-option nc-option-inline" data-editor-field=${field.name}>
      ${this.labelWithHelp(label, this.fieldHelp(section, field, label))}
      <ha-switch .checked=${Boolean(section.read(s)[field.name])} .disabled=${controlDisabled}
        aria-label=${label} @change=${(event: Event) => this.applyBooleanChange(section, field, controlDisabled, event)}></ha-switch>
    </div>`;
  }

  private applyBooleanChange(section: EditorSection, field: SchemaField, disabled: boolean, event: Event): void {
    if (disabled) return;
    section.write(this.state, { ...section.read(this.state), [field.name]: (event.currentTarget as HTMLInputElement).checked });
    this.changed();
  }

  private renderFormControl(section: EditorSection, fields: SchemaField[], field?: SchemaField): TemplateResult {
    const nativeField = fields.length === 1 && isNativeSelector(fields[0]) ? fields[0] : undefined;
    if (nativeField) return html`<div class="nc-native-selector">
      <div class="nc-native-label" role="heading" aria-level="3">${this.state.localize(section.labels[nativeField.name] ?? nativeField.name)}</div>
      ${this.renderHaForm(section, fields, field)}
    </div>`;
    if (field && section.helperIcons?.includes(field.name)) {
      return html`<div class="nc-field-help">${this.renderHaForm(section, fields, field)}${this.fieldHelp(section, field)}</div>`;
    }
    return this.renderHaForm(section, fields, field);
  }

  private renderHaForm(section: EditorSection, fields: SchemaField[], field?: SchemaField): TemplateResult {
    return html`<ha-form
      data-editor-section=${section.key}
      class=${classMap({
        "nc-field-form": fields.length === 1 && isScalarField(fields[0]),
        "nc-compact": fields.length === 1 && isCompactField(fields[0]),
        "nc-code-form": fields.length === 1 && !isNativeSelector(fields[0])
          && ("template" in fields[0].selector || "object" in fields[0].selector),
        "nc-message-form": fields.length === 1 && section.key === "notification"
          && fields[0].name === "message" && "template" in fields[0].selector,
      })}
      aria-label=${this.formAriaLabel(section, fields)}
      .hass=${this.state.hass}
      .narrow=${this.layout.narrow}
      .schema=${this.schema(section, field)}
      .data=${this.formValues(section, field)}
      .computeLabel=${(item: SchemaField) => this.formLabel(section, fields, item)}
      .computeHelper=${(item: SchemaField) => this.formHelper(section, fields, item)}
      @value-changed=${(event: CustomEvent<{ value: Record<string, unknown> }>) => this.applyFormChange(section, field, event)}
    ></ha-form>`;
  }

  private formAriaLabel(section: EditorSection, fields: SchemaField[]): string | typeof nothing {
    if (fields.length === 1 && isNativeSelector(fields[0])) {
      return this.state.localize(section.labels[fields[0].name] ?? fields[0].name);
    }
    if (fields.length === 1 && fields[0].hideLabel) {
      return this.state.localize(section.labels[fields[0].name]);
    }
    return nothing;
  }

  private formValues(section: EditorSection, field?: SchemaField): Record<string, unknown> {
    const s = this.state;
    const values = section.read(s);
    if (field && section.optional && !section.optional.enabled(s, field.name)) {
      const group = section.key === "mobile" ? "general" : section.key as "android" | "ios";
      const retained = s.mobileDrafts?.[group]?.fields?.[field.name]?.value;
      if (retained !== undefined) values[field.name] = retained;
    }
    return values;
  }

  private formLabel(section: EditorSection, fields: SchemaField[], field: SchemaField): string {
    if (isNativeSelector(field) || fields.find(item => item.name === field.name)?.hideLabel) return "";
    return this.state.localize(section.labels[field.name] ?? field.name);
  }

  private formHelper(section: EditorSection, fields: SchemaField[], field: SchemaField): string | undefined {
    if (section.optional || section.helperIcons?.includes(field.name)
      || fields.find(item => item.name === field.name)?.hideLabel) return undefined;
    const key = section.helpers?.[field.name];
    if (!key) return undefined;
    const helper = this.state.localize(key);
    return helper === key ? undefined : helper;
  }

  private applyFormChange(section: EditorSection, field: SchemaField | undefined, event: CustomEvent<{ value: Record<string, unknown> }>): void {
    const s = this.state;
    if (this.sectionDisabled(section)) return;
    if (field && section.optional && !("boolean" in field.selector) && !section.optional.enabled(s, field.name)) return;
    let values = event.detail.value;
    if (field) {
      values = {};
      if (!section.optional) values = { ...section.read(s) };
      values[field.name] = event.detail.value[field.name];
    }
    section.write(s, values);
    if (section.key === "recipients") void this.loadPlatforms();
    this.changed();
  }

  private async loadPlatforms(): Promise<void> {
    const pending: PlatformDetection = { status: "loading" };
    this.platformDetection = pending;
    let detection: PlatformDetection;
    try {
      const result = await request<{ platforms: ("android" | "ios")[]; unknown: boolean }>(
        this.state.hass, "mobile_platforms", { target: this.state.alert.notification.target },
      );
      detection = { status: "ready", ...result };
    } catch {
      detection = { status: "error" };
    }
    if (this.platformDetection !== pending || !this.isConnected) return;
    this.platformDetection = detection;
  }

  private navigationSections(): EditorSection[] {
    return editorSections.filter(section => !section.parent).flatMap(root => [
      root, ...editorSections.filter(section => section.parent === root.key && !section.embedded),
    ]).filter(section => !this.platformUnavailable(section));
  }

  private localSections(): EditorSection[] {
    return [this.active, ...editorSections.filter(section => section.parent === this.active.key && !section.embedded)]
      .filter(section => !this.platformUnavailable(section));
  }

  private helpButton(title: string, content: string | HelpEntry[]): TemplateResult {
    const label = `${this.state.localize("editor.common.more_info")}: ${title}`;
    return html`<ha-icon-button class="nc-help" .path=${mdiInformationOutline} .label=${label} title=${label}
      @click=${() => {
        this.dialog = {
          type: "help", title,
          entries: typeof content === "string" ? [{ text: content }] : content,
        };
      }}></ha-icon-button>`;
  }

  private labelWithHelp(label: string, content: TemplateResult | typeof nothing, sectionHeading = false): TemplateResult {
    return sectionHeading
      ? html`<div class="nc-heading"><h2>${label}</h2>${content}</div>`
      : html`<span class="nc-heading"><span>${label}</span>${content}</span>`;
  }

  private sectionHelp(section: EditorSection): TemplateResult | typeof nothing {
    const t = this.state.localize;
    const entries = Object.entries(section.optional ? {} : section.helpers ?? {}).flatMap(([name, key]) => {
      if (section.helperIcons?.includes(name)) return [];
      const text = t(key);
      return text === key ? [] : [{ title: t(section.labels[name]), text }];
    });
    if (section.toggle?.help) entries.unshift({ title: "", text: t(section.toggle.help) });
    return entries.length ? this.helpButton(t(section.title), entries) : nothing;
  }

  private themePrimaryColor(): string {
    const color = getComputedStyle(this).getPropertyValue("--primary-color").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : "";
  }

  private recipientPlatformSummary(): TemplateResult {
    const t = this.state.localize;
    if (this.platformDetection.status === "loading") {
      return html`<span class="nc-platform-summary" role="status">${t("editor.mobile.detecting")}</span>`;
    }
    if (this.platformDetection.status === "error") {
      return html`<span class="nc-platform-summary" role="status">${t("editor.mobile.unknown")}</span>`;
    }
    const labels = this.platformDetection.platforms.map(platform => t(`editor.mobile.${platform}`));
    if (this.platformDetection.unknown) labels.push(t("editor.mobile.unknown"));
    return html`<span class="nc-platform-summary" role="status">${labels.length ? labels.join(", ") : t("editor.mobile.no_platforms")}</span>`;
  }

  private platformUnavailable(section: EditorSection): boolean {
    return (section.key === "android" || section.key === "ios")
      && this.platformDetection.status === "ready"
      && !this.platformDetection.unknown
      && !this.platformDetection.platforms.includes(section.key)
      && !section.toggle?.get(this.state)
      && !Object.values(section.read(this.state)).some(value => value !== undefined && value !== null && value !== "")
      && !Object.values(this.state.mobileDrafts?.[section.key]?.fields ?? {}).some(field => field.value !== undefined);
  }

  private schema(section: EditorSection, field?: SchemaField): SchemaField[] {
    const globallyDisabled = this.sectionDisabled(section);
    const fields = field ? [field] : section.schema(this.state);
    const schema = fields.map(({ hideLabel, ...item }) => {
      const disabled = globallyDisabled || Boolean(section.optional && !("boolean" in item.selector)
        && !section.optional.enabled(this.state, item.name));
      return disabled ? { ...item, disabled: true } : item;
    });
    const cacheKey = field ? `${section.key}.${field.name}` : section.key;
    const key = JSON.stringify(schema);
    const cached = this.schemas.get(cacheKey);
    if (cached?.key === key) return cached.schema;
    this.schemas.set(cacheKey, { key, schema });
    return schema;
  }

  private sectionDisabled(section: EditorSection): boolean {
    return Boolean(section.toggle && !section.toggle.get(this.state));
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
    if (this.dialog?.type === "help") return this.renderHelpDialog(this.dialog);
    if (this.dialog?.type === "discard") return this.renderDiscardDialog();
    if (this.dialog?.type === "yaml") return this.renderYamlDialog(this.dialog.alert);
    return nothing;
  }

  private renderHelpDialog(dialog: Extract<EditorDialog, { type: "help" }>): TemplateResult {
    const t = this.state.localize;
    return html`<ha-dialog class="nc-info-dialog" open type="alert" width="small" .headerTitle=${dialog.title} @closed=${this.closeDialog}>
      <div class="nc-help-content">${dialog.entries.map(entry => html`<section class="nc-help-topic">
          ${entry.title ? html`<h3>${entry.title}</h3>` : nothing}
          <p>${entry.text}</p>
        </section>`)}</div>
        <div slot="footer">${haButton(t("editor.common.close"), this.closeDialog)}</div>
      </ha-dialog>`;
  }

  private renderDiscardDialog(): TemplateResult {
    const t = this.state.localize;
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

  private renderYamlDialog(alert: Alert): TemplateResult {
    return html`<ha-dialog open width="large" .headerTitle=${this.state.localize("editor.common.alert_yaml")} @closed=${this.closeDialog}>
        <ha-yaml-editor class="nc-yaml-preview ${this.layout.narrow ? "narrow" : ""}"
          .hass=${this.state.hass} .defaultValue=${alert} read-only></ha-yaml-editor>
      </ha-dialog>`;
  }

  private changed(): void {
    this.dirty = true;
    this.requestUpdate();
  }

  private select = (key: string): void => {
    const root = rootSection(key);
    if (!root) return;
    this.active = root;
    this.localSelections.set(root.key, key);
    this.requestUpdate();
  };

  private closeDialog = (): void => {
    this.dialog = null;
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
      this.dialog = { type: "yaml", alert: this.payload(false) };
    } catch (error) {
      notify(this, errorMessage(error));
    }
  };

  private save = async (): Promise<void> => {
    if (this.saving) return;
    try {
      const payload = this.payload();
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
