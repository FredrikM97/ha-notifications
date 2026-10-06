import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { mdiCheckDecagramOutline, mdiClose, mdiCodeBraces, mdiInformationOutline } from "@mdi/js";
import { errorMessage, getMobilePlatforms } from "../api.js";
import type { Alert, Hass } from "../types.js";
import { createLocalizer } from "../localize.js";
import { actions, haButton, NarrowController, navMenu, notify, toolbar, uiStyles, type Action } from "../ui.js";
import { editableAlert, finalizeAlert } from "./alert-model.js";
import { editorSections, rootSection, sectionStatus, type EditorSection, type EditorState, type SchemaField } from "./sections.js";

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
const NATIVE_AUTOMATION_CONTROLS = new Set([
  "ha-selector-trigger", "ha-selector-condition", "ha-selector-action",
]);

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

function* sizingElements(
  root: ParentNode,
  inspectNative?: (element: HTMLElement) => void,
): Generator<HTMLElement> {
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => {
      if (NATIVE_AUTOMATION_CONTROLS.has((node as Element).localName)) {
        inspectNative?.(node as HTMLElement);
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let element: Node | null;
  while ((element = walker.nextNode())) yield element as HTMLElement;
}

interface HelpEntry {
  title?: string;
  text: string;
}

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

class AlertEditor extends LitElement {
  static styles = [uiStyles, styles];

  private layout = new NarrowController(this);
  private options!: OpenEditorOptions;
  private state!: EditorState;
  private active = editorSections[0];
  private localSelections = new Map<string, string>();
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
    const observe = (root: ParentNode): void => {
      if (!observed.has(root)) {
        observed.add(root);
        this.editorObserver!.observe(root, { childList: true, subtree: true });
      }
    };
    const inspectNativeTrigger = (root: ParentNode): void => {
      observe(root);
      for (const element of root.querySelectorAll<HTMLElement>("*")) {
        if (!element.shadowRoot) continue;
        if (element.localName === "ha-automation-trigger-editor" &&
          !element.shadowRoot.querySelector("style[data-nc-trigger-inset]")) {
          const style = document.createElement("style");
          style.dataset.ncTriggerInset = "";
          style.textContent = ".card-content.card:not(.yaml) { padding: var(--ha-space-4, 16px); }";
          element.shadowRoot.append(style);
        }
        inspectNativeTrigger(element.shadowRoot);
      }
      if (root instanceof HTMLElement && root.shadowRoot) inspectNativeTrigger(root.shadowRoot);
    };
    const inspect = (root: ParentNode): void => {
      observe(root);
      for (const element of sizingElements(root, boundary => {
        if (boundary.localName === "ha-selector-trigger") inspectNativeTrigger(boundary);
      })) {
        if (element.localName === "ha-code-editor") {
          const view = (element as HTMLElement & {
            codemirror?: { dom: HTMLElement; scrollDOM?: HTMLElement; contentDOM?: HTMLElement };
          }).codemirror;
          if (view) {
            let owner: Element | null = element;
            while (owner && owner.localName !== "ha-form") {
              const parent = owner.parentElement;
              const ownerRoot = owner.getRootNode();
              owner = parent ?? (ownerRoot instanceof ShadowRoot ? ownerRoot.host : null);
            }
            const messageEditor = owner?.getAttribute("data-editor-section") === "notification" && this.dialog === null;
            const minimumHeight = messageEditor ? 320 : this.layout.narrow ? 320 : 420;
            const contentHeight = `${minimumHeight - 40}px`;
            view.dom.style.minHeight = `${minimumHeight}px`;
            if (view.scrollDOM) {
              view.scrollDOM.style.minHeight = contentHeight;
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
            for (const element of sizingElements(root)) {
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
    const root = this.active;
    const sections = this.localSections();
    const section = sections.find(item => item.key === this.localSelections.get(root.key)) ?? root;
    const menu: Action[] = [
      { label: t("editor.common.view_yaml"), path: mdiCodeBraces, action: this.showYaml },
    ];
    const nav = navMenu(
      this.navigationSections().map((item) => ({
        key: item.key,
        label: t(item.parent ? item.localTitle ?? item.title : item.title),
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
            <section>
              <section data-section=${section.key}>
                <div class="card-header">${toolbar(html`<div class="nc-title-group">
                  <div class="nc-title-row">${this.labelWithHelp(t(section.title), this.sectionHelp(section), true)}</div>
                  ${section.key === "recipients" ? this.recipientPlatformSummary() : nothing}
                </div>`, section.validate ? [{ label: t(section.validate.label), path: mdiCheckDecagramOutline, action: () => this.validate(section) }] : [],
                narrow, html`${this.sectionToggle(section)}`)}</div>
                <div class="card-content">${this.form(section)}${editorSections.filter(item => item.embedded && item.parent === section.key).map(item => html`
                  <div class="nc-embedded" data-embedded-section=${item.key}>
                    <div class="nc-embedded-title">${this.labelWithHelp(t(item.title), this.sectionHelp(item))}</div>
                    ${this.form(item)}
                  </div>`)}</div>
              </section>
            </section>
          </ha-card>
          ${narrow ? nothing : nav}
        </div>
      </ha-top-app-bar-fixed>
      ${this.dialogs()}`;
  }

  private form(section: EditorSection, field?: SchemaField): TemplateResult {
    const s = this.state;
    if (this.platformUnavailable(section)) return html``;
    const disabled = this.sectionDisabled(section);
    const fields = field ? [field] : section.schema(s);
    if (section.optional && !field) {
      return html`${fields.map(item => {
        const enabled = section.optional!.enabled(s, item.name);
        const label = s.localize(section.labels[item.name]);
        const helperKey = section.helpers?.[item.name];
        const helper = helperKey ? s.localize(helperKey) : undefined;
        if ("boolean" in item.selector) return html`<div class="nc-option nc-option-inline">
          ${this.labelWithHelp(label, helper && helper !== helperKey ? this.helpButton(label, helper) : nothing)}
          <ha-switch .checked=${Boolean(section.read(s)[item.name])} .disabled=${disabled}
            aria-label=${label} @change=${(event: Event) => {
              if (disabled) return;
              section.write(s, { [item.name]: (event.currentTarget as HTMLInputElement).checked });
              this.changed();
            }}></ha-switch>
        </div>`;
        const color = ["color", "ledColor", "notification_icon_color"].includes(item.name);
        const group = section.key === "mobile" ? "general" : section.key as "android" | "ios";
        const colorValue = section.read(s)[item.name] ?? s.mobileDrafts?.[group]?.fields?.[item.name]?.value;
        return html`<div class="nc-option nc-option-inline">
          <div class="nc-option-input ${color ? "nc-color-input" : isScalarField(item) ? `nc-field-input${isCompactField(item) ? " nc-compact" : ""}` : ""}">${color
            ? html`<input type="color" ?disabled=${disabled || !enabled} aria-label=${`${label} ${s.localize("editor.mobile.picker")}`}
                .value=${/^#[0-9a-f]{6}$/i.test(String(colorValue))
                  ? String(colorValue)
                  : this.themePrimaryColor()}
                @input=${(event: Event) => {
                  if (disabled || !enabled) return;
                  section.write(s, { [item.name]: (event.currentTarget as HTMLInputElement).value });
                  this.changed();
                }}>` : this.form(section, item)}${!color && helper && helper !== helperKey ? this.helpButton(label, helper) : nothing}</div>
              ${color ? this.labelWithHelp(label, helper && helper !== helperKey ? this.helpButton(label, helper) : nothing) : nothing}
            <ha-switch .checked=${enabled} .disabled=${disabled} aria-label=${`${s.localize(enabled ? "alert.disable" : "alert.enable")} ${label}`}
              @change=${(event: Event) => {
                if (disabled) return;
                const checked = (event.currentTarget as HTMLInputElement).checked;
                section.optional!.set(s, item.name, checked);
                if (checked && ["color", "ledColor", "notification_icon_color"].includes(item.name)
                  && !section.read(s)[item.name]) {
                  const color = this.themePrimaryColor();
                  if (color) section.write(s, { [item.name]: color });
                }
                this.changed();
              }}></ha-switch>
        </div>`;
      })}`;
    }
    if (!field && fields.length > 1 && (section.helperIcons?.length || fields.some(item => isScalarField(item) || isNativeSelector(item)))) {
      return html`${fields.map(item => this.form(section, item))}`;
    }
    const helperField = fields.length === 1 && section.helperIcons?.includes(fields[0].name) ? fields[0] : undefined;
    if (helperField && "boolean" in helperField.selector) {
      const label = s.localize(section.labels[helperField.name] ?? helperField.name);
      const helperKey = section.helpers?.[helperField.name];
      const helper = helperKey ? s.localize(helperKey) : undefined;
      const controlDisabled = disabled || Boolean(helperField.disabled);
      return html`<div class="nc-option nc-option-inline" data-editor-field=${helperField.name}>
        ${this.labelWithHelp(label, helper && helper !== helperKey ? this.helpButton(label, helper) : nothing)}
        <ha-switch .checked=${Boolean(section.read(s)[helperField.name])} .disabled=${controlDisabled}
          aria-label=${label} @change=${(event: Event) => {
            if (controlDisabled) return;
            section.write(s, { ...section.read(s), [helperField.name]: (event.currentTarget as HTMLInputElement).checked });
            this.changed();
          }}></ha-switch>
      </div>`;
    }
    const scalar = fields.length === 1 && isScalarField(fields[0]);
    const nativeField = fields.length === 1 && isNativeSelector(fields[0]) ? fields[0] : undefined;
    const label = nativeField ? s.localize(section.labels[nativeField.name] ?? nativeField.name) : undefined;
    const values = section.read(s);
    if (field && section.optional && !section.optional.enabled(s, field.name)) {
      const group = section.key === "mobile" ? "general" : section.key as "android" | "ios";
      const retained = s.mobileDrafts?.[group]?.fields?.[field.name]?.value;
      if (retained !== undefined) values[field.name] = retained;
    }
    const form = html`<ha-form
      data-editor-section=${section.key}
      class=${scalar ? `nc-field-form${isCompactField(fields[0]) ? " nc-compact" : ""}` : ""}
      aria-label=${label ?? (fields.length === 1 && fields[0].hideLabel ? s.localize(section.labels[fields[0].name]) : nothing)}
      .hass=${s.hass}
      .narrow=${this.layout.narrow}
      .schema=${this.schema(section, field)}
      .data=${values}
      .computeLabel=${(item: SchemaField) => isNativeSelector(item) || fields.find(candidate => candidate.name === item.name)?.hideLabel
        ? "" : s.localize(section.labels[item.name] ?? item.name)}
      .computeHelper=${(field: SchemaField) => {
        if (section.optional || section.helperIcons?.includes(field.name)
          || fields.find(item => item.name === field.name)?.hideLabel) return undefined;
        const key = section.helpers?.[field.name];
        if (!key) return undefined;
        const helper = s.localize(key);
        return helper === key ? undefined : helper;
      }}
      @value-changed=${(event: CustomEvent<{ value: Record<string, unknown> }>) => {
        if (this.sectionDisabled(section)) return;
        if (field && section.optional && !("boolean" in field.selector) && !section.optional.enabled(s, field.name)) return;
        section.write(s, field
          ? { ...(section.optional ? {} : section.read(s)), [field.name]: event.detail.value[field.name] }
          : event.detail.value);
        if (section.key === "recipients") void this.loadPlatforms();
        this.changed();
      }}
    ></ha-form>`;
    if (nativeField) return html`<div class="nc-native-selector">
      <div class="nc-native-label" role="heading" aria-level="3">${label}</div>
      ${form}
    </div>`;
    if (field && section.helperIcons?.includes(field.name)) {
      const helperKey = section.helpers?.[field.name];
      const helper = helperKey ? s.localize(helperKey) : undefined;
      const help = helper && helper !== helperKey ? this.helpButton(s.localize(section.labels[field.name]), helper) : nothing;
      return html`<div class="nc-field-help">${form}${help}</div>`;
    }
    return form;
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
        this.helpTitle = title;
        this.helpEntries = typeof content === "string" ? [{ text: content }] : content;
        this.dialog = "help";
        this.requestUpdate();
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
    if (this.platformLoading) {
      return html`<span class="nc-platform-summary" role="status">${t("editor.mobile.detecting")}</span>`;
    }
    const labels = this.platforms.map(platform => t(`editor.mobile.${platform}`));
    if (this.platformUnknown) labels.push(t("editor.mobile.unknown"));
    return html`<span class="nc-platform-summary" role="status">${labels.length ? labels.join(", ") : t("editor.mobile.no_platforms")}</span>`;
  }

  private platformUnavailable(section: EditorSection): boolean {
    return (section.key === "android" || section.key === "ios")
      && !this.platformLoading
      && !this.platformUnknown
      && !this.platforms.includes(section.key)
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
    const t = this.state.localize;
    if (this.dialog === "help") {
      return html`<ha-dialog class="nc-info-dialog" open type="alert" width="small" .headerTitle=${this.helpTitle} @closed=${this.closeDialog}>
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
        <ha-yaml-editor .hass=${this.state.hass} .defaultValue=${this.yaml} read-only></ha-yaml-editor>
      </ha-dialog>`;
    }
    return nothing;
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
