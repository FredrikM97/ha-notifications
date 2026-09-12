import {
  deleteAlert,
  getAlerts,
  getHistory,
  getYaml,
  loadRegistries,
  saveAlert,
  saveYaml,
  testAlert,
  validateYaml,
} from "./api.js";

import {
  openEditor,
} from "./editor.js";

import {
  renderHistory,
} from "./history.js";

import {
  styles,
} from "./styles.js";

class NotificationCenterPanel
  extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({
      mode: "open",
    });

    this._hass = null;
    this.alerts = [];
    this.history = [];
    this.tab = "alerts";
    this.loading = false;
    this._registries = null;
    this._registriesPromise = null;
  }

  set hass(value) {
    this._hass = value;

    if (
      this.isConnected &&
      !this._initialized
    ) {
      this._initialized = true;
      this.refresh();
    }
  }

  get hass() {
    return this._hass;
  }

  async getRegistries() {
    if (this._registries) {
      return this._registries;
    }

    if (!this._registriesPromise) {
      this._registriesPromise = loadRegistries(
        this._hass,
      ).then((registries) => {
        this._registries = registries;
        return registries;
      });
    }

    return this._registriesPromise;
  }

  connectedCallback() {
    this.render();

    if (this._hass) {
      this._initialized =
        true;

      this.refresh();
    }
  }

  async refresh() {
    if (!this._hass) {
      return;
    }

    this.loading = true;

    try {
      [
        this.alerts,
        this.history,
      ] = await Promise.all([
        getAlerts(this._hass),
        getHistory(
          this._hass,
          null,
          150,
        ),
      ]);
    } catch (err) {
      this.showToast(
        err?.message ||
          String(err),
        true,
      );
    } finally {
      this.loading = false;
      this.render();
    }
  }

  render() {
    if (!this.shadowRoot) {
      return;
    }

    this.shadowRoot.replaceChildren();

    const style =
      document.createElement(
        "style",
      );

    style.textContent =
      styles;

    this.shadowRoot.append(
      style,
    );

    const page =
      document.createElement(
        "div",
      );

    page.className =
      "nc-page";

    // -------------------------------------------------------
    // Header
    // -------------------------------------------------------

    const header =
      document.createElement(
        "div",
      );

    header.className =
      "nc-header";

    const title =
      document.createElement(
        "div",
      );

    title.className =
      "nc-title";

    title.innerHTML = `
      <div class="nc-title-icon">🔔</div>
      <div>
        <h1>Notification Center</h1>
        <p>
          Manage alerts, notifications and debug history.
        </p>
      </div>
    `;

    const actions =
      document.createElement(
        "div",
      );

    actions.className =
      "nc-actions";

    const add =
      document.createElement(
        "button",
      );

    add.className =
      "nc-button";

    add.textContent =
      "+ Add alert";

    add.addEventListener(
      "click",
      () => this.addAlert(),
    );

    actions.append(
      add,
    );

    header.append(
      title,
      actions,
    );

    page.append(
      header,
    );

    // -------------------------------------------------------
    // Tabs
    // -------------------------------------------------------

    const tabs =
      document.createElement(
        "div",
      );

    tabs.className =
      "nc-tabs";

    for (const item of [
      ["alerts", "Alerts"],
      ["history", "History"],
      ["yaml", "YAML"],
    ]) {
      const button =
        document.createElement(
          "button",
        );

      button.className =
        `nc-tab${
          this.tab === item[0]
            ? " active"
            : ""
        }`;

      button.textContent =
        item[1];

      button.addEventListener(
        "click",
        () => {
          this.tab =
            item[0];

          this.render();

          if (
            this.tab ===
            "yaml"
          ) {
            this.loadYaml();
          }
        },
      );

      tabs.appendChild(
        button,
      );
    }

    page.append(
      tabs,
    );

    // -------------------------------------------------------
    // Content
    // -------------------------------------------------------

    const content =
      document.createElement(
        "div",
      );

    if (
      this.tab ===
      "alerts"
    ) {
      this.renderAlerts(
        content,
      );
    } else if (
      this.tab ===
      "history"
    ) {
      renderHistory(
        content,
        this.history,
      );
    } else {
      this.renderYaml(
        content,
      );
    }

    page.append(
      content,
    );

    this.shadowRoot.append(
      page,
    );
  }

  renderAlerts(container) {
    const list =
      document.createElement(
        "div",
      );

    list.className =
      "nc-alerts";

    if (!this.alerts.length) {
      const empty =
        document.createElement(
          "div",
        );

      empty.className =
        "nc-card nc-empty";

      empty.innerHTML = `
        <h2>No alerts yet</h2>
        <p>
          Create your first alert. You can trigger it
          from condition changes, an interval, or both.
        </p>
      `;

      const button =
        document.createElement(
          "button",
        );

      button.className =
        "nc-button";

      button.textContent =
        "Create alert";

      button.addEventListener(
        "click",
        () => this.addAlert(),
      );

      empty.appendChild(
        button,
      );

      list.appendChild(
        empty,
      );

      container.appendChild(
        list,
      );

      return;
    }

    for (const alert of this.alerts) {
      list.appendChild(
        this.createAlertCard(
          alert,
        ),
      );
    }

    container.appendChild(
      list,
    );
  }

  createAlertCard(alert) {
    const card =
      document.createElement(
        "div",
      );

    card.className =
      "nc-card nc-alert";

    const icon =
      document.createElement(
        "div",
      );

    icon.className =
      "nc-alert-icon";

    icon.textContent =
      "🔔";

    const main =
      document.createElement(
        "div",
      );

    main.className =
      "nc-alert-main";

    const name =
      document.createElement(
        "div",
      );

    name.className =
      "nc-alert-name";

    name.textContent =
      alert.name;

    const runtime =
      alert.runtime || {};

    const status =
      document.createElement(
        "span",
      );

    status.className =
      runtime.active
        ? "nc-status active"
        : alert.enabled
          ? "nc-status ok"
          : "nc-status disabled";

    status.textContent =
      runtime.active
        ? "Active"
        : alert.enabled
          ? "Ready"
          : "Disabled";

    const meta =
      document.createElement(
        "div",
      );

    meta.className =
      "nc-alert-meta";

    const monitor = [];

    if (
      alert.monitor?.on_change
    ) {
      monitor.push(
        "condition changes",
      );
    }

    if (
      alert.monitor?.interval
    ) {
      monitor.push(
        `every ${alert.monitor.interval}`,
      );
    }

    const targets =
      this.targetSummary(
        alert.notification?.target,
      );

    meta.textContent =
      `${monitor.join(
        " + ",
      ) || "No trigger"} · ${targets}`;

    const last =
      document.createElement(
        "div",
      );

    last.className =
      "nc-alert-meta";

    if (
      runtime.last_notified
    ) {
      last.textContent =
        `Last notification: ${this.formatTime(
          runtime.last_notified,
        )}`;
    } else {
      last.textContent =
        "No notification sent yet";
    }

    main.append(
      name,
      status,
      meta,
      last,
    );

    const actions =
      document.createElement(
        "div",
      );

    actions.className =
      "nc-alert-actions";

    const test =
      document.createElement(
        "button",
      );

    test.className =
      "nc-button secondary";

    test.textContent =
      "Test";

    test.addEventListener(
      "click",
      async () => {
        try {
          await testAlert(
            this._hass,
            alert.id,
          );

          this.showToast(
            "Test notification sent.",
          );

          await this.refresh();

        } catch (err) {
          this.showToast(
            err?.message ||
              String(err),
            true,
          );
        }
      },
    );

    const toggle =
      document.createElement(
        "button",
      );

    toggle.className =
      "nc-button secondary";

    toggle.textContent =
      alert.enabled
        ? "Disable"
        : "Enable";

    toggle.addEventListener(
      "click",
      async () => {
        try {
          await saveAlert(
            this._hass,
            {
              ...alert,
              enabled:
                !alert.enabled,
            },
          );

          this.showToast(
            alert.enabled
              ? "Alert disabled."
              : "Alert enabled.",
          );

          await this.refresh();

        } catch (err) {
          this.showToast(
            err?.message ||
              String(err),
            true,
          );
        }
      },
    );

    const edit =
      document.createElement(
        "button",
      );

    edit.className =
      "nc-button secondary";

    edit.textContent =
      "Edit";

    edit.addEventListener(
      "click",
      () =>
        this.editAlert(
          alert,
        ),
    );

    const remove =
      document.createElement(
        "button",
      );

    remove.className =
      "nc-button danger";

    remove.textContent =
      "Delete";

    remove.addEventListener(
      "click",
      () =>
        this.removeAlert(
          alert,
        ),
    );

    actions.append(
      test,
      toggle,
      edit,
      remove,
    );

    card.append(
      icon,
      main,
      actions,
    );

    return card;
  }

  targetSummary(target = {}) {
    const parts = [];

    for (
      const [key, label]
      of [
        ["device_id", "devices"],
        ["area_id", "areas"],
        ["floor_id", "floors"],
        ["label_id", "labels"],
        ["entity_id", "entities"],
      ]
    ) {
      const count =
        target[key]?.length ||
        0;

      if (count) {
        parts.push(
          `${count} ${label}`,
        );
      }
    }

    return (
      parts.join(", ") ||
      "No target"
    );
  }

  async addAlert() {
    const registries =
      await this.getRegistries();

    openEditor({
      root: this.shadowRoot,
      alert: null,
      registries,
      onSave: async (
        alert,
      ) => {
        await saveAlert(
          this._hass,
          alert,
        );

        this.showToast(
          "Alert created.",
        );

        await this.refresh();
      },
    });
  }

  async editAlert(alert) {
    const registries =
      await this.getRegistries();

    openEditor({
      root: this.shadowRoot,
      alert,
      registries,
      onSave: async (
        updated,
      ) => {
        await saveAlert(
          this._hass,
          updated,
        );

        this.showToast(
          "Alert saved.",
        );

        await this.refresh();
      },
    });
  }

  async removeAlert(alert) {
    if (
      !window.confirm(
        `Delete "${alert.name}"?`,
      )
    ) {
      return;
    }

    try {
      await deleteAlert(
        this._hass,
        alert.id,
      );

      this.showToast(
        "Alert deleted.",
      );

      await this.refresh();

    } catch (err) {
      this.showToast(
        err?.message ||
          String(err),
        true,
      );
    }
  }

  renderYaml(container) {
    const wrapper =
      document.createElement(
        "div",
      );

    wrapper.className =
      "nc-card nc-yaml";

    const toolbar =
      document.createElement(
        "div",
      );

    toolbar.className =
      "nc-toolbar";

    const description =
      document.createElement(
        "div",
      );

    description.textContent =
      "Advanced editor. Copy this YAML to another system, " +
      "paste YAML from an existing configuration, or edit " +
      "the file directly at /config/notification_center.yaml.";

    const buttons =
      document.createElement(
        "div",
      );

    buttons.className =
      "nc-actions";

    const copy =
      document.createElement(
        "button",
      );

    copy.className =
      "nc-button secondary";

    copy.textContent =
      "Copy";

    const paste =
      document.createElement(
        "button",
      );

    paste.className =
      "nc-button secondary";

    paste.textContent =
      "Paste";

    const validate =
      document.createElement(
        "button",
      );

    validate.className =
      "nc-button secondary";

    validate.textContent =
      "Validate";

    const reload =
      document.createElement(
        "button",
      );

    reload.className =
      "nc-button secondary";

    reload.textContent =
      "Reload";

    const save =
      document.createElement(
        "button",
      );

    save.className =
      "nc-button";

    save.textContent =
      "Save YAML";

    buttons.append(
      copy,
      paste,
      validate,
      reload,
      save,
    );

    toolbar.append(
      description,
      buttons,
    );

    const textarea =
      document.createElement(
        "textarea",
      );

    textarea.id =
      "nc-yaml-editor";

    textarea.placeholder =
      "version: 1\\nalerts: []";

    wrapper.append(
      toolbar,
      textarea,
    );

    copy.addEventListener(
      "click",
      async () => {
        try {
          await navigator.clipboard.writeText(
            textarea.value,
          );
          this.showToast(
            "YAML copied to clipboard.",
          );
        } catch (err) {
          this.showToast(
            err?.message || String(err),
            true,
          );
        }
      },
    );

    paste.addEventListener(
      "click",
      async () => {
        try {
          const text =
            await navigator.clipboard.readText();
          textarea.value = text;
          this.showToast(
            "YAML pasted from clipboard.",
          );
        } catch (err) {
          this.showToast(
            err?.message || String(err),
            true,
          );
        }
      },
    );

    validate.addEventListener(
      "click",
      async () => {
        try {
          validate.disabled = true;
          await validateYaml(
            this._hass,
            textarea.value,
          );
          this.showToast(
            "YAML is valid.",
          );
        } catch (err) {
          this.showToast(
            err?.message || String(err),
            true,
          );
        } finally {
          validate.disabled = false;
        }
      },
    );

    reload.addEventListener(
      "click",
      () =>
        this.loadYaml(
          textarea,
        ),
    );

    save.addEventListener(
      "click",
      async () => {
        try {
          save.disabled =
            true;

          await saveYaml(
            this._hass,
            textarea.value,
          );

          this.showToast(
            "YAML saved and configuration reloaded.",
          );

          await this.refresh();

        } catch (err) {
          this.showToast(
            err?.message ||
              String(err),
            true,
          );
        } finally {
          save.disabled =
            false;
        }
      },
    );

    container.appendChild(
      wrapper,
    );

    this._yamlTextarea =
      textarea;

    this.loadYaml(
      textarea,
    );
  }

  async loadYaml(
    textarea = null,
  ) {
    if (!this._hass) {
      return;
    }

    const target =
      textarea ||
      this._yamlTextarea;

    if (!target) {
      return;
    }

    try {
      const result =
        await getYaml(
          this._hass,
        );

      target.value =
        result.yaml || "";

    } catch (err) {
      this.showToast(
        err?.message ||
          String(err),
        true,
      );
    }
  }

  formatTime(value) {
    if (!value) {
      return "—";
    }

    try {
      return new Intl.DateTimeFormat(
        undefined,
        {
          dateStyle: "short",
          timeStyle: "short",
        },
      ).format(
        new Date(value),
      );
    } catch (_err) {
      return value;
    }
  }

  showToast(
    message,
    error = false,
  ) {
    const toast =
      document.createElement(
        "div",
      );

    toast.className =
      "nc-toast";

    toast.textContent =
      message;

    if (error) {
      toast.style.background =
        "var(--error-color)";
      toast.style.color =
        "white";
    }

    this.shadowRoot.appendChild(
      toast,
    );

    setTimeout(
      () => toast.remove(),
      3500,
    );
  }
}

if (
  !customElements.get(
    "notification-center-panel",
  )
) {
  customElements.define(
    "notification-center-panel",
    NotificationCenterPanel,
  );
}