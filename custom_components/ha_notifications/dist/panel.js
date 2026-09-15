// frontend/api.ts
var DOMAIN = "ha_notifications";
function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const value = error;
    const nestedError = value.error;
    const details = value.details;
    return String(
      nestedError?.message || details?.message || value.message || error
    );
  }
  return String(error);
}
async function call(hass, command, data = {}) {
  try {
    return await hass.connection.sendMessagePromise({
      type: `${DOMAIN}/${command}`,
      ...data
    });
  } catch (error) {
    throw new Error(`${DOMAIN}/${command}: ${errorMessage(error)}`);
  }
}
async function callRegistry(hass, type) {
  const result = await hass.connection.sendMessagePromise({ type });
  if (Array.isArray(result)) {
    return result;
  }
  return [];
}
async function loadRegistries(hass) {
  const [entities, states, devices, areas, labels, floors, users] = await Promise.all([
    callRegistry(hass, "config/entity_registry/list"),
    callRegistry(hass, "get_states"),
    callRegistry(hass, "config/device_registry/list"),
    callRegistry(hass, "config/area_registry/list"),
    callRegistry(hass, "config/label_registry/list"),
    callRegistry(hass, "config/floor_registry/list"),
    callRegistry(hass, "config/auth/list")
  ]);
  const friendlyNames = new Map(
    states.map((state) => [state.entity_id, state.attributes?.friendly_name])
  );
  return {
    entities: entities.map((entity) => ({
      ...entity,
      friendly_name: friendlyNames.get(entity.entity_id) || entity.friendly_name
    })),
    devices,
    areas,
    labels,
    floors,
    users
  };
}
async function getAlerts(hass) {
  const alerts = await call(hass, "list");
  if (!Array.isArray(alerts)) {
    throw new Error("ha_notifications/list: expected an alert list.");
  }
  return alerts;
}
async function saveAlert(hass, alert) {
  if (!alert.id || typeof alert.id !== "string") {
    throw new Error("ha_notifications/save: alert.id is required.");
  }
  return call(hass, "save", {
    alert
  });
}
async function deleteAlert(hass, alertId) {
  return call(hass, "delete", {
    alert_id: alertId
  });
}
async function testAlert(hass, alertId) {
  if (!alertId) {
    throw new Error("Select an alert before testing it.");
  }
  return call(hass, "test", {
    alert_id: alertId
  });
}
async function testAlertPayload(hass, alert) {
  return call(hass, "test_payload", { alert });
}
async function validateConditions(hass, alert) {
  return call(hass, "validate_conditions", { alert });
}
async function discardDraftTestPayload(hass, sessionId) {
  return call(hass, "discard_test_payload", { session_id: sessionId });
}
async function getHistory(hass, alertId = null, limit = 100) {
  const data = {
    limit
  };
  if (alertId) {
    data.alert_id = alertId;
  }
  return call(hass, "history", data);
}
async function getYaml(hass) {
  return call(hass, "get_yaml");
}
async function validateYaml(hass, yaml) {
  return call(hass, "validate_yaml", {
    yaml
  });
}
async function saveYaml(hass, yaml) {
  return call(
    hass,
    "save_yaml",
    {
      yaml
    }
  );
}
async function reload(hass) {
  return call(hass, "reload");
}

// frontend/alert-payload.ts
function cloneAlert(alert) {
  return JSON.parse(JSON.stringify(alert));
}
function durationToSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string") {
    const parts = value.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return void 0;
    if (parts.length === 2) parts.unshift(0);
    if (parts.length !== 3) return void 0;
    return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  if (value && typeof value === "object") {
    return Math.max(
      0,
      (Number(value.hours) || 0) * 3600 + (Number(value.minutes) || 0) * 60 + (Number(value.seconds) || 0)
    );
  }
  return void 0;
}
function serializeDurations(result) {
  const monitorInterval = durationToSeconds(result.monitor.interval);
  if (monitorInterval !== void 0) result.monitor.interval = monitorInterval;
  result.conditions = result.conditions.map((condition) => ({
    ...condition,
    ...durationToSeconds(condition.for) !== void 0 ? { for: durationToSeconds(condition.for) } : {}
  }));
  const resendInterval = durationToSeconds(
    result.confirmation?.reminders.interval
  );
  if (resendInterval !== void 0 && result.confirmation) {
    result.confirmation.reminders.interval = resendInterval;
  }
}
function hasRecipients(target) {
  return Object.values(target).some(
    (values) => Array.isArray(values) && values.length > 0
  );
}
function buildAlertPayload(original, values) {
  const result = cloneAlert(original);
  if (!hasRecipients(values.notification.target)) {
    throw new Error(
      "Select at least one device, area, label, or notification entity in Recipients."
    );
  }
  if (values.confirmation.enabled && !hasRecipients(values.notification.target)) {
    throw new Error(
      "Confirmation requires at least one notification recipient."
    );
  }
  result.name = values.identity.name.trim();
  result.description = values.identity.description;
  result.conditions = values.monitor.conditions;
  result.monitor = {
    on_change: values.monitor.onChange,
    startup: values.monitor.startup
  };
  if (values.monitor.interval) {
    result.monitor.interval = values.monitor.interval;
  }
  result.notification = {
    target: values.notification.target,
    title: values.notification.title,
    message: values.notification.message
  };
  result.confirmation = values.confirmation;
  if (original.notification?.data) {
    result.notification.data = original.notification.data;
  }
  if (values.post_send_actions.actions?.length) {
    result.post_send_actions = {
      enabled: values.post_send_actions.postSendActionsEnabled,
      actions: values.post_send_actions.actions
    };
  } else if (values.post_send_actions.postSendActionsEnabled) {
    result.post_send_actions = { enabled: true };
  }
  serializeDurations(result);
  return result;
}

// node_modules/@lit/reactive-element/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = /* @__PURE__ */ Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t3, e4, o5) {
    if (this._$cssResult$ = true, o5 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t3, this.t = e4;
  }
  get styleSheet() {
    let t3 = this.o;
    const s4 = this.t;
    if (e && void 0 === t3) {
      const e4 = void 0 !== s4 && 1 === s4.length;
      e4 && (t3 = o.get(s4)), void 0 === t3 && ((this.o = t3 = new CSSStyleSheet()).replaceSync(this.cssText), e4 && o.set(s4, t3));
    }
    return t3;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t3) => new n("string" == typeof t3 ? t3 : t3 + "", void 0, s);
var S = (s4, o5) => {
  if (e) s4.adoptedStyleSheets = o5.map((t3) => t3 instanceof CSSStyleSheet ? t3 : t3.styleSheet);
  else for (const e4 of o5) {
    const o6 = document.createElement("style"), n4 = t.litNonce;
    void 0 !== n4 && o6.setAttribute("nonce", n4), o6.textContent = e4.cssText, s4.appendChild(o6);
  }
};
var c = e ? (t3) => t3 : (t3) => t3 instanceof CSSStyleSheet ? ((t4) => {
  let e4 = "";
  for (const s4 of t4.cssRules) e4 += s4.cssText;
  return r(e4);
})(t3) : t3;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t3, s4) => t3;
var u = { toAttribute(t3, s4) {
  switch (s4) {
    case Boolean:
      t3 = t3 ? l : null;
      break;
    case Object:
    case Array:
      t3 = null == t3 ? t3 : JSON.stringify(t3);
  }
  return t3;
}, fromAttribute(t3, s4) {
  let i5 = t3;
  switch (s4) {
    case Boolean:
      i5 = null !== t3;
      break;
    case Number:
      i5 = null === t3 ? null : Number(t3);
      break;
    case Object:
    case Array:
      try {
        i5 = JSON.parse(t3);
      } catch (t4) {
        i5 = null;
      }
  }
  return i5;
} };
var f = (t3, s4) => !i2(t3, s4);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ??= /* @__PURE__ */ Symbol("metadata"), a.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y = class extends HTMLElement {
  static addInitializer(t3) {
    this._$Ei(), (this.l ??= []).push(t3);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t3, s4 = b) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t3) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t3, s4), !s4.noAccessor) {
      const i5 = /* @__PURE__ */ Symbol(), h3 = this.getPropertyDescriptor(t3, i5, s4);
      void 0 !== h3 && e2(this.prototype, t3, h3);
    }
  }
  static getPropertyDescriptor(t3, s4, i5) {
    const { get: e4, set: r4 } = h(this.prototype, t3) ?? { get() {
      return this[s4];
    }, set(t4) {
      this[s4] = t4;
    } };
    return { get: e4, set(s5) {
      const h3 = e4?.call(this);
      r4?.call(this, s5), this.requestUpdate(t3, h3, i5);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t3) {
    return this.elementProperties.get(t3) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t3 = n2(this);
    t3.finalize(), void 0 !== t3.l && (this.l = [...t3.l]), this.elementProperties = new Map(t3.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t4 = this.properties, s4 = [...r2(t4), ...o2(t4)];
      for (const i5 of s4) this.createProperty(i5, t4[i5]);
    }
    const t3 = this[Symbol.metadata];
    if (null !== t3) {
      const s4 = litPropertyMetadata.get(t3);
      if (void 0 !== s4) for (const [t4, i5] of s4) this.elementProperties.set(t4, i5);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t4, s4] of this.elementProperties) {
      const i5 = this._$Eu(t4, s4);
      void 0 !== i5 && this._$Eh.set(i5, t4);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i5 = [];
    if (Array.isArray(s4)) {
      const e4 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e4) i5.unshift(c(s5));
    } else void 0 !== s4 && i5.push(c(s4));
    return i5;
  }
  static _$Eu(t3, s4) {
    const i5 = s4.attribute;
    return false === i5 ? void 0 : "string" == typeof i5 ? i5 : "string" == typeof t3 ? t3.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t3) => this.enableUpdating = t3), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t3) => t3(this));
  }
  addController(t3) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t3), void 0 !== this.renderRoot && this.isConnected && t3.hostConnected?.();
  }
  removeController(t3) {
    this._$EO?.delete(t3);
  }
  _$E_() {
    const t3 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i5 of s4.keys()) this.hasOwnProperty(i5) && (t3.set(i5, this[i5]), delete this[i5]);
    t3.size > 0 && (this._$Ep = t3);
  }
  createRenderRoot() {
    const t3 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t3, this.constructor.elementStyles), t3;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t3) => t3.hostConnected?.());
  }
  enableUpdating(t3) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t3) => t3.hostDisconnected?.());
  }
  attributeChangedCallback(t3, s4, i5) {
    this._$AK(t3, i5);
  }
  _$ET(t3, s4) {
    const i5 = this.constructor.elementProperties.get(t3), e4 = this.constructor._$Eu(t3, i5);
    if (void 0 !== e4 && true === i5.reflect) {
      const h3 = (void 0 !== i5.converter?.toAttribute ? i5.converter : u).toAttribute(s4, i5.type);
      this._$Em = t3, null == h3 ? this.removeAttribute(e4) : this.setAttribute(e4, h3), this._$Em = null;
    }
  }
  _$AK(t3, s4) {
    const i5 = this.constructor, e4 = i5._$Eh.get(t3);
    if (void 0 !== e4 && this._$Em !== e4) {
      const t4 = i5.getPropertyOptions(e4), h3 = "function" == typeof t4.converter ? { fromAttribute: t4.converter } : void 0 !== t4.converter?.fromAttribute ? t4.converter : u;
      this._$Em = e4;
      const r4 = h3.fromAttribute(s4, t4.type);
      this[e4] = r4 ?? this._$Ej?.get(e4) ?? r4, this._$Em = null;
    }
  }
  requestUpdate(t3, s4, i5, e4 = false, h3) {
    if (void 0 !== t3) {
      const r4 = this.constructor;
      if (false === e4 && (h3 = this[t3]), i5 ??= r4.getPropertyOptions(t3), !((i5.hasChanged ?? f)(h3, s4) || i5.useDefault && i5.reflect && h3 === this._$Ej?.get(t3) && !this.hasAttribute(r4._$Eu(t3, i5)))) return;
      this.C(t3, s4, i5);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t3, s4, { useDefault: i5, reflect: e4, wrapped: h3 }, r4) {
    i5 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t3) && (this._$Ej.set(t3, r4 ?? s4 ?? this[t3]), true !== h3 || void 0 !== r4) || (this._$AL.has(t3) || (this.hasUpdated || i5 || (s4 = void 0), this._$AL.set(t3, s4)), true === e4 && this._$Em !== t3 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t3));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t4) {
      Promise.reject(t4);
    }
    const t3 = this.scheduleUpdate();
    return null != t3 && await t3, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t5, s5] of this._$Ep) this[t5] = s5;
        this._$Ep = void 0;
      }
      const t4 = this.constructor.elementProperties;
      if (t4.size > 0) for (const [s5, i5] of t4) {
        const { wrapped: t5 } = i5, e4 = this[s5];
        true !== t5 || this._$AL.has(s5) || void 0 === e4 || this.C(s5, void 0, i5, e4);
      }
    }
    let t3 = false;
    const s4 = this._$AL;
    try {
      t3 = this.shouldUpdate(s4), t3 ? (this.willUpdate(s4), this._$EO?.forEach((t4) => t4.hostUpdate?.()), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t3 = false, this._$EM(), s5;
    }
    t3 && this._$AE(s4);
  }
  willUpdate(t3) {
  }
  _$AE(t3) {
    this._$EO?.forEach((t4) => t4.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t3)), this.updated(t3);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t3) {
    return true;
  }
  update(t3) {
    this._$Eq &&= this._$Eq.forEach((t4) => this._$ET(t4, this[t4])), this._$EM();
  }
  updated(t3) {
  }
  firstUpdated(t3) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ??= []).push("2.1.2");

// node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = (t3) => t3;
var s2 = t2.trustedTypes;
var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t3) => t3 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t3) => null === t3 || "object" != typeof t3 && "function" != typeof t3;
var u2 = Array.isArray;
var d2 = (t3) => u2(t3) || "function" == typeof t3?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t3) => (i5, ...s4) => ({ _$litType$: t3, strings: i5, values: s4 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = /* @__PURE__ */ Symbol.for("lit-noChange");
var A = /* @__PURE__ */ Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t3, i5) {
  if (!u2(t3) || !t3.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e3 ? e3.createHTML(i5) : i5;
}
var N = (t3, i5) => {
  const s4 = t3.length - 1, e4 = [];
  let n4, l3 = 2 === i5 ? "<svg>" : 3 === i5 ? "<math>" : "", c4 = v;
  for (let i6 = 0; i6 < s4; i6++) {
    const s5 = t3[i6];
    let a3, u3, d3 = -1, f3 = 0;
    for (; f3 < s5.length && (c4.lastIndex = f3, u3 = c4.exec(s5), null !== u3); ) f3 = c4.lastIndex, c4 === v ? "!--" === u3[1] ? c4 = _ : void 0 !== u3[1] ? c4 = m : void 0 !== u3[2] ? (y2.test(u3[2]) && (n4 = RegExp("</" + u3[2], "g")), c4 = p2) : void 0 !== u3[3] && (c4 = p2) : c4 === p2 ? ">" === u3[0] ? (c4 = n4 ?? v, d3 = -1) : void 0 === u3[1] ? d3 = -2 : (d3 = c4.lastIndex - u3[2].length, a3 = u3[1], c4 = void 0 === u3[3] ? p2 : '"' === u3[3] ? $ : g) : c4 === $ || c4 === g ? c4 = p2 : c4 === _ || c4 === m ? c4 = v : (c4 = p2, n4 = void 0);
    const x2 = c4 === p2 && t3[i6 + 1].startsWith("/>") ? " " : "";
    l3 += c4 === v ? s5 + r3 : d3 >= 0 ? (e4.push(a3), s5.slice(0, d3) + h2 + s5.slice(d3) + o3 + x2) : s5 + o3 + (-2 === d3 ? i6 : x2);
  }
  return [V(t3, l3 + (t3[s4] || "<?>") + (2 === i5 ? "</svg>" : 3 === i5 ? "</math>" : "")), e4];
};
var S2 = class _S {
  constructor({ strings: t3, _$litType$: i5 }, e4) {
    let r4;
    this.parts = [];
    let l3 = 0, a3 = 0;
    const u3 = t3.length - 1, d3 = this.parts, [f3, v2] = N(t3, i5);
    if (this.el = _S.createElement(f3, e4), P.currentNode = this.el.content, 2 === i5 || 3 === i5) {
      const t4 = this.el.content.firstChild;
      t4.replaceWith(...t4.childNodes);
    }
    for (; null !== (r4 = P.nextNode()) && d3.length < u3; ) {
      if (1 === r4.nodeType) {
        if (r4.hasAttributes()) for (const t4 of r4.getAttributeNames()) if (t4.endsWith(h2)) {
          const i6 = v2[a3++], s4 = r4.getAttribute(t4).split(o3), e5 = /([.?@])?(.*)/.exec(i6);
          d3.push({ type: 1, index: l3, name: e5[2], strings: s4, ctor: "." === e5[1] ? I : "?" === e5[1] ? L : "@" === e5[1] ? z : H }), r4.removeAttribute(t4);
        } else t4.startsWith(o3) && (d3.push({ type: 6, index: l3 }), r4.removeAttribute(t4));
        if (y2.test(r4.tagName)) {
          const t4 = r4.textContent.split(o3), i6 = t4.length - 1;
          if (i6 > 0) {
            r4.textContent = s2 ? s2.emptyScript : "";
            for (let s4 = 0; s4 < i6; s4++) r4.append(t4[s4], c3()), P.nextNode(), d3.push({ type: 2, index: ++l3 });
            r4.append(t4[i6], c3());
          }
        }
      } else if (8 === r4.nodeType) if (r4.data === n3) d3.push({ type: 2, index: l3 });
      else {
        let t4 = -1;
        for (; -1 !== (t4 = r4.data.indexOf(o3, t4 + 1)); ) d3.push({ type: 7, index: l3 }), t4 += o3.length - 1;
      }
      l3++;
    }
  }
  static createElement(t3, i5) {
    const s4 = l2.createElement("template");
    return s4.innerHTML = t3, s4;
  }
};
function M(t3, i5, s4 = t3, e4) {
  if (i5 === E) return i5;
  let h3 = void 0 !== e4 ? s4._$Co?.[e4] : s4._$Cl;
  const o5 = a2(i5) ? void 0 : i5._$litDirective$;
  return h3?.constructor !== o5 && (h3?._$AO?.(false), void 0 === o5 ? h3 = void 0 : (h3 = new o5(t3), h3._$AT(t3, s4, e4)), void 0 !== e4 ? (s4._$Co ??= [])[e4] = h3 : s4._$Cl = h3), void 0 !== h3 && (i5 = M(t3, h3._$AS(t3, i5.values), h3, e4)), i5;
}
var R = class {
  constructor(t3, i5) {
    this._$AV = [], this._$AN = void 0, this._$AD = t3, this._$AM = i5;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t3) {
    const { el: { content: i5 }, parts: s4 } = this._$AD, e4 = (t3?.creationScope ?? l2).importNode(i5, true);
    P.currentNode = e4;
    let h3 = P.nextNode(), o5 = 0, n4 = 0, r4 = s4[0];
    for (; void 0 !== r4; ) {
      if (o5 === r4.index) {
        let i6;
        2 === r4.type ? i6 = new k(h3, h3.nextSibling, this, t3) : 1 === r4.type ? i6 = new r4.ctor(h3, r4.name, r4.strings, this, t3) : 6 === r4.type && (i6 = new Z(h3, this, t3)), this._$AV.push(i6), r4 = s4[++n4];
      }
      o5 !== r4?.index && (h3 = P.nextNode(), o5++);
    }
    return P.currentNode = l2, e4;
  }
  p(t3) {
    let i5 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t3, s4, i5), i5 += s4.strings.length - 2) : s4._$AI(t3[i5])), i5++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t3, i5, s4, e4) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t3, this._$AB = i5, this._$AM = s4, this.options = e4, this._$Cv = e4?.isConnected ?? true;
  }
  get parentNode() {
    let t3 = this._$AA.parentNode;
    const i5 = this._$AM;
    return void 0 !== i5 && 11 === t3?.nodeType && (t3 = i5.parentNode), t3;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t3, i5 = this) {
    t3 = M(this, t3, i5), a2(t3) ? t3 === A || null == t3 || "" === t3 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t3 !== this._$AH && t3 !== E && this._(t3) : void 0 !== t3._$litType$ ? this.$(t3) : void 0 !== t3.nodeType ? this.T(t3) : d2(t3) ? this.k(t3) : this._(t3);
  }
  O(t3) {
    return this._$AA.parentNode.insertBefore(t3, this._$AB);
  }
  T(t3) {
    this._$AH !== t3 && (this._$AR(), this._$AH = this.O(t3));
  }
  _(t3) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t3 : this.T(l2.createTextNode(t3)), this._$AH = t3;
  }
  $(t3) {
    const { values: i5, _$litType$: s4 } = t3, e4 = "number" == typeof s4 ? this._$AC(t3) : (void 0 === s4.el && (s4.el = S2.createElement(V(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e4) this._$AH.p(i5);
    else {
      const t4 = new R(e4, this), s5 = t4.u(this.options);
      t4.p(i5), this.T(s5), this._$AH = t4;
    }
  }
  _$AC(t3) {
    let i5 = C.get(t3.strings);
    return void 0 === i5 && C.set(t3.strings, i5 = new S2(t3)), i5;
  }
  k(t3) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i5 = this._$AH;
    let s4, e4 = 0;
    for (const h3 of t3) e4 === i5.length ? i5.push(s4 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s4 = i5[e4], s4._$AI(h3), e4++;
    e4 < i5.length && (this._$AR(s4 && s4._$AB.nextSibling, e4), i5.length = e4);
  }
  _$AR(t3 = this._$AA.nextSibling, s4) {
    for (this._$AP?.(false, true, s4); t3 !== this._$AB; ) {
      const s5 = i3(t3).nextSibling;
      i3(t3).remove(), t3 = s5;
    }
  }
  setConnected(t3) {
    void 0 === this._$AM && (this._$Cv = t3, this._$AP?.(t3));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t3, i5, s4, e4, h3) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t3, this.name = i5, this._$AM = e4, this.options = h3, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
  }
  _$AI(t3, i5 = this, s4, e4) {
    const h3 = this.strings;
    let o5 = false;
    if (void 0 === h3) t3 = M(this, t3, i5, 0), o5 = !a2(t3) || t3 !== this._$AH && t3 !== E, o5 && (this._$AH = t3);
    else {
      const e5 = t3;
      let n4, r4;
      for (t3 = h3[0], n4 = 0; n4 < h3.length - 1; n4++) r4 = M(this, e5[s4 + n4], i5, n4), r4 === E && (r4 = this._$AH[n4]), o5 ||= !a2(r4) || r4 !== this._$AH[n4], r4 === A ? t3 = A : t3 !== A && (t3 += (r4 ?? "") + h3[n4 + 1]), this._$AH[n4] = r4;
    }
    o5 && !e4 && this.j(t3);
  }
  j(t3) {
    t3 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t3 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t3) {
    this.element[this.name] = t3 === A ? void 0 : t3;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t3) {
    this.element.toggleAttribute(this.name, !!t3 && t3 !== A);
  }
};
var z = class extends H {
  constructor(t3, i5, s4, e4, h3) {
    super(t3, i5, s4, e4, h3), this.type = 5;
  }
  _$AI(t3, i5 = this) {
    if ((t3 = M(this, t3, i5, 0) ?? A) === E) return;
    const s4 = this._$AH, e4 = t3 === A && s4 !== A || t3.capture !== s4.capture || t3.once !== s4.once || t3.passive !== s4.passive, h3 = t3 !== A && (s4 === A || e4);
    e4 && this.element.removeEventListener(this.name, this, s4), h3 && this.element.addEventListener(this.name, this, t3), this._$AH = t3;
  }
  handleEvent(t3) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t3) : this._$AH.handleEvent(t3);
  }
};
var Z = class {
  constructor(t3, i5, s4) {
    this.element = t3, this.type = 6, this._$AN = void 0, this._$AM = i5, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t3) {
    M(this, t3);
  }
};
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ??= []).push("3.3.3");
var D = (t3, i5, s4) => {
  const e4 = s4?.renderBefore ?? i5;
  let h3 = e4._$litPart$;
  if (void 0 === h3) {
    const t4 = s4?.renderBefore ?? null;
    e4._$litPart$ = h3 = new k(i5.insertBefore(c3(), t4), t4, void 0, s4 ?? {});
  }
  return h3._$AI(t3), h3;
};

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t3 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t3.firstChild, t3;
  }
  update(t3) {
    const r4 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t3), this._$Do = D(r4, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i4 });
(s3.litElementVersions ??= []).push("4.2.2");

// node_modules/yaml/browser/dist/nodes/identity.js
var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
function isCollection(node) {
  if (node && typeof node === "object")
    switch (node[NODE_TYPE]) {
      case MAP:
      case SEQ:
        return true;
    }
  return false;
}
function isNode(node) {
  if (node && typeof node === "object")
    switch (node[NODE_TYPE]) {
      case ALIAS:
      case MAP:
      case SCALAR:
      case SEQ:
        return true;
    }
  return false;
}
var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;

// node_modules/yaml/browser/dist/visit.js
var BREAK = /* @__PURE__ */ Symbol("break visit");
var SKIP = /* @__PURE__ */ Symbol("skip children");
var REMOVE = /* @__PURE__ */ Symbol("remove node");
function visit(node, visitor) {
  const visitor_ = initVisitor(visitor);
  if (isDocument(node)) {
    const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
    if (cd === REMOVE)
      node.contents = null;
  } else
    visit_(null, node, visitor_, Object.freeze([]));
}
visit.BREAK = BREAK;
visit.SKIP = SKIP;
visit.REMOVE = REMOVE;
function visit_(key, node, visitor, path) {
  const ctrl = callVisitor(key, node, visitor, path);
  if (isNode(ctrl) || isPair(ctrl)) {
    replaceNode(key, path, ctrl);
    return visit_(key, ctrl, visitor, path);
  }
  if (typeof ctrl !== "symbol") {
    if (isCollection(node)) {
      path = Object.freeze(path.concat(node));
      for (let i5 = 0; i5 < node.items.length; ++i5) {
        const ci = visit_(i5, node.items[i5], visitor, path);
        if (typeof ci === "number")
          i5 = ci - 1;
        else if (ci === BREAK)
          return BREAK;
        else if (ci === REMOVE) {
          node.items.splice(i5, 1);
          i5 -= 1;
        }
      }
    } else if (isPair(node)) {
      path = Object.freeze(path.concat(node));
      const ck = visit_("key", node.key, visitor, path);
      if (ck === BREAK)
        return BREAK;
      else if (ck === REMOVE)
        node.key = null;
      const cv = visit_("value", node.value, visitor, path);
      if (cv === BREAK)
        return BREAK;
      else if (cv === REMOVE)
        node.value = null;
    }
  }
  return ctrl;
}
async function visitAsync(node, visitor) {
  const visitor_ = initVisitor(visitor);
  if (isDocument(node)) {
    const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
    if (cd === REMOVE)
      node.contents = null;
  } else
    await visitAsync_(null, node, visitor_, Object.freeze([]));
}
visitAsync.BREAK = BREAK;
visitAsync.SKIP = SKIP;
visitAsync.REMOVE = REMOVE;
async function visitAsync_(key, node, visitor, path) {
  const ctrl = await callVisitor(key, node, visitor, path);
  if (isNode(ctrl) || isPair(ctrl)) {
    replaceNode(key, path, ctrl);
    return visitAsync_(key, ctrl, visitor, path);
  }
  if (typeof ctrl !== "symbol") {
    if (isCollection(node)) {
      path = Object.freeze(path.concat(node));
      for (let i5 = 0; i5 < node.items.length; ++i5) {
        const ci = await visitAsync_(i5, node.items[i5], visitor, path);
        if (typeof ci === "number")
          i5 = ci - 1;
        else if (ci === BREAK)
          return BREAK;
        else if (ci === REMOVE) {
          node.items.splice(i5, 1);
          i5 -= 1;
        }
      }
    } else if (isPair(node)) {
      path = Object.freeze(path.concat(node));
      const ck = await visitAsync_("key", node.key, visitor, path);
      if (ck === BREAK)
        return BREAK;
      else if (ck === REMOVE)
        node.key = null;
      const cv = await visitAsync_("value", node.value, visitor, path);
      if (cv === BREAK)
        return BREAK;
      else if (cv === REMOVE)
        node.value = null;
    }
  }
  return ctrl;
}
function initVisitor(visitor) {
  if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
    return Object.assign({
      Alias: visitor.Node,
      Map: visitor.Node,
      Scalar: visitor.Node,
      Seq: visitor.Node
    }, visitor.Value && {
      Map: visitor.Value,
      Scalar: visitor.Value,
      Seq: visitor.Value
    }, visitor.Collection && {
      Map: visitor.Collection,
      Seq: visitor.Collection
    }, visitor);
  }
  return visitor;
}
function callVisitor(key, node, visitor, path) {
  if (typeof visitor === "function")
    return visitor(key, node, path);
  if (isMap(node))
    return visitor.Map?.(key, node, path);
  if (isSeq(node))
    return visitor.Seq?.(key, node, path);
  if (isPair(node))
    return visitor.Pair?.(key, node, path);
  if (isScalar(node))
    return visitor.Scalar?.(key, node, path);
  if (isAlias(node))
    return visitor.Alias?.(key, node, path);
  return void 0;
}
function replaceNode(key, path, node) {
  const parent = path[path.length - 1];
  if (isCollection(parent)) {
    parent.items[key] = node;
  } else if (isPair(parent)) {
    if (key === "key")
      parent.key = node;
    else
      parent.value = node;
  } else if (isDocument(parent)) {
    parent.contents = node;
  } else {
    const pt = isAlias(parent) ? "alias" : "scalar";
    throw new Error(`Cannot replace node with ${pt} parent`);
  }
}

// node_modules/yaml/browser/dist/doc/directives.js
var escapeChars = {
  "!": "%21",
  ",": "%2C",
  "[": "%5B",
  "]": "%5D",
  "{": "%7B",
  "}": "%7D"
};
var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
var Directives = class _Directives {
  constructor(yaml, tags) {
    this.docStart = null;
    this.docEnd = false;
    this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
    this.tags = Object.assign({}, _Directives.defaultTags, tags);
  }
  clone() {
    const copy = new _Directives(this.yaml, this.tags);
    copy.docStart = this.docStart;
    return copy;
  }
  /**
   * During parsing, get a Directives instance for the current document and
   * update the stream state according to the current version's spec.
   */
  atDocument() {
    const res = new _Directives(this.yaml, this.tags);
    switch (this.yaml.version) {
      case "1.1":
        this.atNextDocument = true;
        break;
      case "1.2":
        this.atNextDocument = false;
        this.yaml = {
          explicit: _Directives.defaultYaml.explicit,
          version: "1.2"
        };
        this.tags = Object.assign({}, _Directives.defaultTags);
        break;
    }
    return res;
  }
  /**
   * @param onError - May be called even if the action was successful
   * @returns `true` on success
   */
  add(line, onError) {
    if (this.atNextDocument) {
      this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
      this.tags = Object.assign({}, _Directives.defaultTags);
      this.atNextDocument = false;
    }
    const parts = line.trim().split(/[ \t]+/);
    const name = parts.shift();
    switch (name) {
      case "%TAG": {
        if (parts.length !== 2) {
          onError(0, "%TAG directive should contain exactly two parts");
          if (parts.length < 2)
            return false;
        }
        const [handle, prefix] = parts;
        this.tags[handle] = prefix;
        return true;
      }
      case "%YAML": {
        this.yaml.explicit = true;
        if (parts.length !== 1) {
          onError(0, "%YAML directive should contain exactly one part");
          return false;
        }
        const [version] = parts;
        if (version === "1.1" || version === "1.2") {
          this.yaml.version = version;
          return true;
        } else {
          const isValid = /^\d+\.\d+$/.test(version);
          onError(6, `Unsupported YAML version ${version}`, isValid);
          return false;
        }
      }
      default:
        onError(0, `Unknown directive ${name}`, true);
        return false;
    }
  }
  /**
   * Resolves a tag, matching handles to those defined in %TAG directives.
   *
   * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
   *   `'!local'` tag, or `null` if unresolvable.
   */
  tagName(source, onError) {
    if (source === "!")
      return "!";
    if (source[0] !== "!") {
      onError(`Not a valid tag: ${source}`);
      return null;
    }
    if (source[1] === "<") {
      const verbatim = source.slice(2, -1);
      if (verbatim === "!" || verbatim === "!!") {
        onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
        return null;
      }
      if (source[source.length - 1] !== ">")
        onError("Verbatim tags must end with a >");
      return verbatim;
    }
    const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
    if (!suffix)
      onError(`The ${source} tag has no suffix`);
    const prefix = this.tags[handle];
    if (prefix) {
      try {
        return prefix + decodeURIComponent(suffix);
      } catch (error) {
        onError(String(error));
        return null;
      }
    }
    if (handle === "!")
      return source;
    onError(`Could not resolve tag: ${source}`);
    return null;
  }
  /**
   * Given a fully resolved tag, returns its printable string form,
   * taking into account current tag prefixes and defaults.
   */
  tagString(tag) {
    for (const [handle, prefix] of Object.entries(this.tags)) {
      if (tag.startsWith(prefix))
        return handle + escapeTagName(tag.substring(prefix.length));
    }
    return tag[0] === "!" ? tag : `!<${tag}>`;
  }
  toString(doc) {
    const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
    const tagEntries = Object.entries(this.tags);
    let tagNames;
    if (doc && tagEntries.length > 0 && isNode(doc.contents)) {
      const tags = {};
      visit(doc.contents, (_key, node) => {
        if (isNode(node) && node.tag)
          tags[node.tag] = true;
      });
      tagNames = Object.keys(tags);
    } else
      tagNames = [];
    for (const [handle, prefix] of tagEntries) {
      if (handle === "!!" && prefix === "tag:yaml.org,2002:")
        continue;
      if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
        lines.push(`%TAG ${handle} ${prefix}`);
    }
    return lines.join("\n");
  }
};
Directives.defaultYaml = { explicit: false, version: "1.2" };
Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };

// node_modules/yaml/browser/dist/doc/anchors.js
function anchorIsValid(anchor) {
  if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
    const sa = JSON.stringify(anchor);
    const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
    throw new Error(msg);
  }
  return true;
}
function anchorNames(root) {
  const anchors = /* @__PURE__ */ new Set();
  visit(root, {
    Value(_key, node) {
      if (node.anchor)
        anchors.add(node.anchor);
    }
  });
  return anchors;
}
function findNewAnchor(prefix, exclude) {
  for (let i5 = 1; true; ++i5) {
    const name = `${prefix}${i5}`;
    if (!exclude.has(name))
      return name;
  }
}
function createNodeAnchors(doc, prefix) {
  const aliasObjects = [];
  const sourceObjects = /* @__PURE__ */ new Map();
  let prevAnchors = null;
  return {
    onAnchor: (source) => {
      aliasObjects.push(source);
      prevAnchors ?? (prevAnchors = anchorNames(doc));
      const anchor = findNewAnchor(prefix, prevAnchors);
      prevAnchors.add(anchor);
      return anchor;
    },
    /**
     * With circular references, the source node is only resolved after all
     * of its child nodes are. This is why anchors are set only after all of
     * the nodes have been created.
     */
    setAnchors: () => {
      for (const source of aliasObjects) {
        const ref = sourceObjects.get(source);
        if (typeof ref === "object" && ref.anchor && (isScalar(ref.node) || isCollection(ref.node))) {
          ref.node.anchor = ref.anchor;
        } else {
          const error = new Error("Failed to resolve repeated object (this should not happen)");
          error.source = source;
          throw error;
        }
      }
    },
    sourceObjects
  };
}

// node_modules/yaml/browser/dist/doc/applyReviver.js
function applyReviver(reviver, obj, key, val) {
  if (val && typeof val === "object") {
    if (Array.isArray(val)) {
      for (let i5 = 0, len = val.length; i5 < len; ++i5) {
        const v0 = val[i5];
        const v1 = applyReviver(reviver, val, String(i5), v0);
        if (v1 === void 0)
          delete val[i5];
        else if (v1 !== v0)
          val[i5] = v1;
      }
    } else if (val instanceof Map) {
      for (const k2 of Array.from(val.keys())) {
        const v0 = val.get(k2);
        const v1 = applyReviver(reviver, val, k2, v0);
        if (v1 === void 0)
          val.delete(k2);
        else if (v1 !== v0)
          val.set(k2, v1);
      }
    } else if (val instanceof Set) {
      for (const v0 of Array.from(val)) {
        const v1 = applyReviver(reviver, val, v0, v0);
        if (v1 === void 0)
          val.delete(v0);
        else if (v1 !== v0) {
          val.delete(v0);
          val.add(v1);
        }
      }
    } else {
      for (const [k2, v0] of Object.entries(val)) {
        const v1 = applyReviver(reviver, val, k2, v0);
        if (v1 === void 0)
          delete val[k2];
        else if (v1 !== v0)
          val[k2] = v1;
      }
    }
  }
  return reviver.call(obj, key, val);
}

// node_modules/yaml/browser/dist/nodes/toJS.js
function toJS(value, arg, ctx) {
  if (Array.isArray(value))
    return value.map((v2, i5) => toJS(v2, String(i5), ctx));
  if (value && typeof value.toJSON === "function") {
    if (!ctx || !hasAnchor(value))
      return value.toJSON(arg, ctx);
    const data = { aliasCount: 0, count: 1, res: void 0 };
    ctx.anchors.set(value, data);
    ctx.onCreate = (res2) => {
      data.res = res2;
      delete ctx.onCreate;
    };
    const res = value.toJSON(arg, ctx);
    if (ctx.onCreate)
      ctx.onCreate(res);
    return res;
  }
  if (typeof value === "bigint" && !ctx?.keep)
    return Number(value);
  return value;
}

// node_modules/yaml/browser/dist/nodes/Node.js
var NodeBase = class {
  constructor(type) {
    Object.defineProperty(this, NODE_TYPE, { value: type });
  }
  /** Create a copy of this node.  */
  clone() {
    const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
    if (this.range)
      copy.range = this.range.slice();
    return copy;
  }
  /** A plain JavaScript representation of this node. */
  toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
    if (!isDocument(doc))
      throw new TypeError("A document argument is required");
    const ctx = {
      anchors: /* @__PURE__ */ new Map(),
      doc,
      keep: true,
      mapAsMap: mapAsMap === true,
      mapKeyWarned: false,
      maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
    };
    const res = toJS(this, "", ctx);
    if (typeof onAnchor === "function")
      for (const { count, res: res2 } of ctx.anchors.values())
        onAnchor(res2, count);
    return typeof reviver === "function" ? applyReviver(reviver, { "": res }, "", res) : res;
  }
};

// node_modules/yaml/browser/dist/nodes/Alias.js
var Alias = class extends NodeBase {
  constructor(source) {
    super(ALIAS);
    this.source = source;
    Object.defineProperty(this, "tag", {
      set() {
        throw new Error("Alias nodes cannot have tags");
      }
    });
  }
  /**
   * Resolve the value of this alias within `doc`, finding the last
   * instance of the `source` anchor before this node.
   */
  resolve(doc, ctx) {
    if (ctx?.maxAliasCount === 0)
      throw new ReferenceError("Alias resolution is disabled");
    let nodes;
    if (ctx?.aliasResolveCache) {
      nodes = ctx.aliasResolveCache;
    } else {
      nodes = [];
      visit(doc, {
        Node: (_key, node) => {
          if (isAlias(node) || hasAnchor(node))
            nodes.push(node);
        }
      });
      if (ctx)
        ctx.aliasResolveCache = nodes;
    }
    let found = void 0;
    for (const node of nodes) {
      if (node === this)
        break;
      if (node.anchor === this.source)
        found = node;
    }
    if (found && ctx) {
      const { anchors, doc: doc2, maxAliasCount } = ctx;
      let data = anchors.get(found);
      if (!data) {
        toJS(found, null, ctx);
        data = anchors.get(found);
      }
      if (data?.res === void 0) {
        const msg = "This should not happen: Alias anchor was not resolved?";
        throw new ReferenceError(msg);
      }
      if (maxAliasCount >= 0) {
        data.count += 1;
        if (data.aliasCount === 0)
          data.aliasCount = getAliasCount(doc2, found, anchors);
        if (data.count * data.aliasCount > maxAliasCount) {
          const msg = "Excessive alias count indicates a resource exhaustion attack";
          throw new ReferenceError(msg);
        }
      }
    }
    return found;
  }
  toJSON(_arg, ctx) {
    if (!ctx)
      return { source: this.source };
    const source = this.resolve(ctx.doc, ctx);
    if (!source) {
      const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
      throw new ReferenceError(msg);
    }
    return ctx.anchors.get(source).res;
  }
  toString(ctx, _onComment, _onChompKeep) {
    const src = `*${this.source}`;
    if (ctx) {
      anchorIsValid(this.source);
      if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
        const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
        throw new Error(msg);
      }
      if (ctx.implicitKey)
        return `${src} `;
    }
    return src;
  }
};
function getAliasCount(doc, node, anchors) {
  if (isAlias(node)) {
    const source = node.resolve(doc);
    const anchor = anchors && source && anchors.get(source);
    return anchor ? anchor.count * anchor.aliasCount : 0;
  } else if (isCollection(node)) {
    let count = 0;
    for (const item of node.items) {
      const c4 = getAliasCount(doc, item, anchors);
      if (c4 > count)
        count = c4;
    }
    return count;
  } else if (isPair(node)) {
    const kc = getAliasCount(doc, node.key, anchors);
    const vc = getAliasCount(doc, node.value, anchors);
    return Math.max(kc, vc);
  }
  return 1;
}

// node_modules/yaml/browser/dist/nodes/Scalar.js
var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
var Scalar = class extends NodeBase {
  constructor(value) {
    super(SCALAR);
    this.value = value;
  }
  toJSON(arg, ctx) {
    return ctx?.keep ? this.value : toJS(this.value, arg, ctx);
  }
  toString() {
    return String(this.value);
  }
};
Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
Scalar.PLAIN = "PLAIN";
Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";

// node_modules/yaml/browser/dist/doc/createNode.js
var defaultTagPrefix = "tag:yaml.org,2002:";
function findTagObject(value, tagName, tags) {
  if (tagName) {
    const match = tags.filter((t3) => t3.tag === tagName);
    const tagObj = match.find((t3) => !t3.format) ?? match[0];
    if (!tagObj)
      throw new Error(`Tag ${tagName} not found`);
    return tagObj;
  }
  return tags.find((t3) => t3.identify?.(value) && !t3.format);
}
function createNode(value, tagName, ctx) {
  if (isDocument(value))
    value = value.contents;
  if (isNode(value))
    return value;
  if (isPair(value)) {
    const map2 = ctx.schema[MAP].createNode?.(ctx.schema, null, ctx);
    map2.items.push(value);
    return map2;
  }
  if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
    value = value.valueOf();
  }
  const { aliasDuplicateObjects, onAnchor, onTagObj, schema: schema4, sourceObjects } = ctx;
  let ref = void 0;
  if (aliasDuplicateObjects && value && typeof value === "object") {
    ref = sourceObjects.get(value);
    if (ref) {
      ref.anchor ?? (ref.anchor = onAnchor(value));
      return new Alias(ref.anchor);
    } else {
      ref = { anchor: null, node: null };
      sourceObjects.set(value, ref);
    }
  }
  if (tagName?.startsWith("!!"))
    tagName = defaultTagPrefix + tagName.slice(2);
  let tagObj = findTagObject(value, tagName, schema4.tags);
  if (!tagObj) {
    if (value && typeof value.toJSON === "function") {
      value = value.toJSON();
    }
    if (!value || typeof value !== "object") {
      const node2 = new Scalar(value);
      if (ref)
        ref.node = node2;
      return node2;
    }
    tagObj = value instanceof Map ? schema4[MAP] : Symbol.iterator in Object(value) ? schema4[SEQ] : schema4[MAP];
  }
  if (onTagObj) {
    onTagObj(tagObj);
    delete ctx.onTagObj;
  }
  const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar(value);
  if (tagName)
    node.tag = tagName;
  else if (!tagObj.default)
    node.tag = tagObj.tag;
  if (ref)
    ref.node = node;
  return node;
}

// node_modules/yaml/browser/dist/nodes/Collection.js
function collectionFromPath(schema4, path, value) {
  let v2 = value;
  for (let i5 = path.length - 1; i5 >= 0; --i5) {
    const k2 = path[i5];
    if (typeof k2 === "number" && Number.isInteger(k2) && k2 >= 0) {
      const a3 = [];
      a3[k2] = v2;
      v2 = a3;
    } else {
      v2 = /* @__PURE__ */ new Map([[k2, v2]]);
    }
  }
  return createNode(v2, void 0, {
    aliasDuplicateObjects: false,
    keepUndefined: false,
    onAnchor: () => {
      throw new Error("This should not happen, please report a bug.");
    },
    schema: schema4,
    sourceObjects: /* @__PURE__ */ new Map()
  });
}
var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
var Collection = class extends NodeBase {
  constructor(type, schema4) {
    super(type);
    Object.defineProperty(this, "schema", {
      value: schema4,
      configurable: true,
      enumerable: false,
      writable: true
    });
  }
  /**
   * Create a copy of this collection.
   *
   * @param schema - If defined, overwrites the original's schema
   */
  clone(schema4) {
    const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
    if (schema4)
      copy.schema = schema4;
    copy.items = copy.items.map((it) => isNode(it) || isPair(it) ? it.clone(schema4) : it);
    if (this.range)
      copy.range = this.range.slice();
    return copy;
  }
  /**
   * Adds a value to the collection. For `!!map` and `!!omap` the value must
   * be a Pair instance or a `{ key, value }` object, which may not have a key
   * that already exists in the map.
   */
  addIn(path, value) {
    if (isEmptyPath(path))
      this.add(value);
    else {
      const [key, ...rest] = path;
      const node = this.get(key, true);
      if (isCollection(node))
        node.addIn(rest, value);
      else if (node === void 0 && this.schema)
        this.set(key, collectionFromPath(this.schema, rest, value));
      else
        throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
    }
  }
  /**
   * Removes a value from the collection.
   * @returns `true` if the item was found and removed.
   */
  deleteIn(path) {
    const [key, ...rest] = path;
    if (rest.length === 0)
      return this.delete(key);
    const node = this.get(key, true);
    if (isCollection(node))
      return node.deleteIn(rest);
    else
      throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
  }
  /**
   * Returns item at `key`, or `undefined` if not found. By default unwraps
   * scalar values from their surrounding node; to disable set `keepScalar` to
   * `true` (collections are always returned intact).
   */
  getIn(path, keepScalar) {
    const [key, ...rest] = path;
    const node = this.get(key, true);
    if (rest.length === 0)
      return !keepScalar && isScalar(node) ? node.value : node;
    else
      return isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
  }
  hasAllNullValues(allowScalar) {
    return this.items.every((node) => {
      if (!isPair(node))
        return false;
      const n4 = node.value;
      return n4 == null || allowScalar && isScalar(n4) && n4.value == null && !n4.commentBefore && !n4.comment && !n4.tag;
    });
  }
  /**
   * Checks if the collection includes a value with the key `key`.
   */
  hasIn(path) {
    const [key, ...rest] = path;
    if (rest.length === 0)
      return this.has(key);
    const node = this.get(key, true);
    return isCollection(node) ? node.hasIn(rest) : false;
  }
  /**
   * Sets a value in this collection. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   */
  setIn(path, value) {
    const [key, ...rest] = path;
    if (rest.length === 0) {
      this.set(key, value);
    } else {
      const node = this.get(key, true);
      if (isCollection(node))
        node.setIn(rest, value);
      else if (node === void 0 && this.schema)
        this.set(key, collectionFromPath(this.schema, rest, value));
      else
        throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
    }
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyComment.js
var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
function indentComment(comment, indent) {
  if (/^\n+$/.test(comment))
    return comment.substring(1);
  return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
}
var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;

// node_modules/yaml/browser/dist/stringify/foldFlowLines.js
var FOLD_FLOW = "flow";
var FOLD_BLOCK = "block";
var FOLD_QUOTED = "quoted";
function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
  if (!lineWidth || lineWidth < 0)
    return text;
  if (lineWidth < minContentWidth)
    minContentWidth = 0;
  const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
  if (text.length <= endStep)
    return text;
  const folds = [];
  const escapedFolds = {};
  let end = lineWidth - indent.length;
  if (typeof indentAtStart === "number") {
    if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
      folds.push(0);
    else
      end = lineWidth - indentAtStart;
  }
  let split = void 0;
  let prev = void 0;
  let overflow = false;
  let i5 = -1;
  let escStart = -1;
  let escEnd = -1;
  if (mode === FOLD_BLOCK) {
    i5 = consumeMoreIndentedLines(text, i5, indent.length);
    if (i5 !== -1)
      end = i5 + endStep;
  }
  for (let ch; ch = text[i5 += 1]; ) {
    if (mode === FOLD_QUOTED && ch === "\\") {
      escStart = i5;
      switch (text[i5 + 1]) {
        case "x":
          i5 += 3;
          break;
        case "u":
          i5 += 5;
          break;
        case "U":
          i5 += 9;
          break;
        default:
          i5 += 1;
      }
      escEnd = i5;
    }
    if (ch === "\n") {
      if (mode === FOLD_BLOCK)
        i5 = consumeMoreIndentedLines(text, i5, indent.length);
      end = i5 + indent.length + endStep;
      split = void 0;
    } else {
      if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
        const next = text[i5 + 1];
        if (next && next !== " " && next !== "\n" && next !== "	")
          split = i5;
      }
      if (i5 >= end) {
        if (split) {
          folds.push(split);
          end = split + endStep;
          split = void 0;
        } else if (mode === FOLD_QUOTED) {
          while (prev === " " || prev === "	") {
            prev = ch;
            ch = text[i5 += 1];
            overflow = true;
          }
          const j = i5 > escEnd + 1 ? i5 - 2 : escStart - 1;
          if (escapedFolds[j])
            return text;
          folds.push(j);
          escapedFolds[j] = true;
          end = j + endStep;
          split = void 0;
        } else {
          overflow = true;
        }
      }
    }
    prev = ch;
  }
  if (overflow && onOverflow)
    onOverflow();
  if (folds.length === 0)
    return text;
  if (onFold)
    onFold();
  let res = text.slice(0, folds[0]);
  for (let i6 = 0; i6 < folds.length; ++i6) {
    const fold = folds[i6];
    const end2 = folds[i6 + 1] || text.length;
    if (fold === 0)
      res = `
${indent}${text.slice(0, end2)}`;
    else {
      if (mode === FOLD_QUOTED && escapedFolds[fold])
        res += `${text[fold]}\\`;
      res += `
${indent}${text.slice(fold + 1, end2)}`;
    }
  }
  return res;
}
function consumeMoreIndentedLines(text, i5, indent) {
  let end = i5;
  let start = i5 + 1;
  let ch = text[start];
  while (ch === " " || ch === "	") {
    if (i5 < start + indent) {
      ch = text[++i5];
    } else {
      do {
        ch = text[++i5];
      } while (ch && ch !== "\n");
      end = i5;
      start = i5 + 1;
      ch = text[start];
    }
  }
  return end;
}

// node_modules/yaml/browser/dist/stringify/stringifyString.js
var getFoldOptions = (ctx, isBlock2) => ({
  indentAtStart: isBlock2 ? ctx.indent.length : ctx.indentAtStart,
  lineWidth: ctx.options.lineWidth,
  minContentWidth: ctx.options.minContentWidth
});
var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
function lineLengthOverLimit(str, lineWidth, indentLength) {
  if (!lineWidth || lineWidth < 0)
    return false;
  const limit = lineWidth - indentLength;
  const strLen = str.length;
  if (strLen <= limit)
    return false;
  for (let i5 = 0, start = 0; i5 < strLen; ++i5) {
    if (str[i5] === "\n") {
      if (i5 - start > limit)
        return true;
      start = i5 + 1;
      if (strLen - start <= limit)
        return false;
    }
  }
  return true;
}
function doubleQuotedString(value, ctx) {
  const json = JSON.stringify(value);
  if (ctx.options.doubleQuotedAsJSON)
    return json;
  const { implicitKey } = ctx;
  const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
  const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
  let str = "";
  let start = 0;
  for (let i5 = 0, ch = json[i5]; ch; ch = json[++i5]) {
    if (ch === " " && json[i5 + 1] === "\\" && json[i5 + 2] === "n") {
      str += json.slice(start, i5) + "\\ ";
      i5 += 1;
      start = i5;
      ch = "\\";
    }
    if (ch === "\\")
      switch (json[i5 + 1]) {
        case "u":
          {
            str += json.slice(start, i5);
            const code = json.substr(i5 + 2, 4);
            switch (code) {
              case "0000":
                str += "\\0";
                break;
              case "0007":
                str += "\\a";
                break;
              case "000b":
                str += "\\v";
                break;
              case "001b":
                str += "\\e";
                break;
              case "0085":
                str += "\\N";
                break;
              case "00a0":
                str += "\\_";
                break;
              case "2028":
                str += "\\L";
                break;
              case "2029":
                str += "\\P";
                break;
              default:
                if (code.substr(0, 2) === "00")
                  str += "\\x" + code.substr(2);
                else
                  str += json.substr(i5, 6);
            }
            i5 += 5;
            start = i5 + 1;
          }
          break;
        case "n":
          if (implicitKey || json[i5 + 2] === '"' || json.length < minMultiLineLength) {
            i5 += 1;
          } else {
            str += json.slice(start, i5) + "\n\n";
            while (json[i5 + 2] === "\\" && json[i5 + 3] === "n" && json[i5 + 4] !== '"') {
              str += "\n";
              i5 += 2;
            }
            str += indent;
            if (json[i5 + 2] === " ")
              str += "\\";
            i5 += 1;
            start = i5 + 1;
          }
          break;
        default:
          i5 += 1;
      }
  }
  str = start ? str + json.slice(start) : json;
  return implicitKey ? str : foldFlowLines(str, indent, FOLD_QUOTED, getFoldOptions(ctx, false));
}
function singleQuotedString(value, ctx) {
  if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
    return doubleQuotedString(value, ctx);
  const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
  const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
  return ctx.implicitKey ? res : foldFlowLines(res, indent, FOLD_FLOW, getFoldOptions(ctx, false));
}
function quotedString(value, ctx) {
  const { singleQuote } = ctx.options;
  let qs;
  if (singleQuote === false)
    qs = doubleQuotedString;
  else {
    const hasDouble = value.includes('"');
    const hasSingle = value.includes("'");
    if (hasDouble && !hasSingle)
      qs = singleQuotedString;
    else if (hasSingle && !hasDouble)
      qs = doubleQuotedString;
    else
      qs = singleQuote ? singleQuotedString : doubleQuotedString;
  }
  return qs(value, ctx);
}
var blockEndNewlines;
try {
  blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
} catch {
  blockEndNewlines = /\n+(?!\n|$)/g;
}
function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
  const { blockQuote, commentString, lineWidth } = ctx.options;
  if (!blockQuote || /\n[\t ]+$/.test(value)) {
    return quotedString(value, ctx);
  }
  const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
  const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.BLOCK_FOLDED ? false : type === Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
  if (!value)
    return literal ? "|\n" : ">\n";
  let chomp;
  let endStart;
  for (endStart = value.length; endStart > 0; --endStart) {
    const ch = value[endStart - 1];
    if (ch !== "\n" && ch !== "	" && ch !== " ")
      break;
  }
  let end = value.substring(endStart);
  const endNlPos = end.indexOf("\n");
  if (endNlPos === -1) {
    chomp = "-";
  } else if (value === end || endNlPos !== end.length - 1) {
    chomp = "+";
    if (onChompKeep)
      onChompKeep();
  } else {
    chomp = "";
  }
  if (end) {
    value = value.slice(0, -end.length);
    if (end[end.length - 1] === "\n")
      end = end.slice(0, -1);
    end = end.replace(blockEndNewlines, `$&${indent}`);
  }
  let startWithSpace = false;
  let startEnd;
  let startNlPos = -1;
  for (startEnd = 0; startEnd < value.length; ++startEnd) {
    const ch = value[startEnd];
    if (ch === " ")
      startWithSpace = true;
    else if (ch === "\n")
      startNlPos = startEnd;
    else
      break;
  }
  let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
  if (start) {
    value = value.substring(start.length);
    start = start.replace(/\n+/g, `$&${indent}`);
  }
  const indentSize = indent ? "2" : "1";
  let header = (startWithSpace ? indentSize : "") + chomp;
  if (comment) {
    header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
    if (onComment)
      onComment();
  }
  if (!literal) {
    const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
    let literalFallback = false;
    const foldOptions = getFoldOptions(ctx, true);
    if (blockQuote !== "folded" && type !== Scalar.BLOCK_FOLDED) {
      foldOptions.onOverflow = () => {
        literalFallback = true;
      };
    }
    const body = foldFlowLines(`${start}${foldedValue}${end}`, indent, FOLD_BLOCK, foldOptions);
    if (!literalFallback)
      return `>${header}
${indent}${body}`;
  }
  value = value.replace(/\n+/g, `$&${indent}`);
  return `|${header}
${indent}${start}${value}${end}`;
}
function plainString(item, ctx, onComment, onChompKeep) {
  const { type, value } = item;
  const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
  if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
    return quotedString(value, ctx);
  }
  if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
    return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
  }
  if (!implicitKey && !inFlow && type !== Scalar.PLAIN && value.includes("\n")) {
    return blockString(item, ctx, onComment, onChompKeep);
  }
  if (containsDocumentMarker(value)) {
    if (indent === "") {
      ctx.forceBlockIndent = true;
      return blockString(item, ctx, onComment, onChompKeep);
    } else if (implicitKey && indent === indentStep) {
      return quotedString(value, ctx);
    }
  }
  const str = value.replace(/\n+/g, `$&
${indent}`);
  if (actualString) {
    const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
    const { compat, tags } = ctx.doc.schema;
    if (tags.some(test) || compat?.some(test))
      return quotedString(value, ctx);
  }
  return implicitKey ? str : foldFlowLines(str, indent, FOLD_FLOW, getFoldOptions(ctx, false));
}
function stringifyString(item, ctx, onComment, onChompKeep) {
  const { implicitKey, inFlow } = ctx;
  const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
  let { type } = item;
  if (type !== Scalar.QUOTE_DOUBLE) {
    if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
      type = Scalar.QUOTE_DOUBLE;
  }
  const _stringify = (_type) => {
    switch (_type) {
      case Scalar.BLOCK_FOLDED:
      case Scalar.BLOCK_LITERAL:
        return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
      case Scalar.QUOTE_DOUBLE:
        return doubleQuotedString(ss.value, ctx);
      case Scalar.QUOTE_SINGLE:
        return singleQuotedString(ss.value, ctx);
      case Scalar.PLAIN:
        return plainString(ss, ctx, onComment, onChompKeep);
      default:
        return null;
    }
  };
  let res = _stringify(type);
  if (res === null) {
    const { defaultKeyType, defaultStringType } = ctx.options;
    const t3 = implicitKey && defaultKeyType || defaultStringType;
    res = _stringify(t3);
    if (res === null)
      throw new Error(`Unsupported default string type ${t3}`);
  }
  return res;
}

// node_modules/yaml/browser/dist/stringify/stringify.js
function createStringifyContext(doc, options) {
  const opt = Object.assign({
    blockQuote: true,
    commentString: stringifyComment,
    defaultKeyType: null,
    defaultStringType: "PLAIN",
    directives: null,
    doubleQuotedAsJSON: false,
    doubleQuotedMinMultiLineLength: 40,
    falseStr: "false",
    flowCollectionPadding: true,
    indentSeq: true,
    lineWidth: 80,
    minContentWidth: 20,
    nullStr: "null",
    simpleKeys: false,
    singleQuote: null,
    trailingComma: false,
    trueStr: "true",
    verifyAliasOrder: true
  }, doc.schema.toStringOptions, options);
  let inFlow;
  switch (opt.collectionStyle) {
    case "block":
      inFlow = false;
      break;
    case "flow":
      inFlow = true;
      break;
    default:
      inFlow = null;
  }
  return {
    anchors: /* @__PURE__ */ new Set(),
    doc,
    flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
    indent: "",
    indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
    inFlow,
    options: opt
  };
}
function getTagObject(tags, item) {
  if (item.tag) {
    const match = tags.filter((t3) => t3.tag === item.tag);
    if (match.length > 0)
      return match.find((t3) => t3.format === item.format) ?? match[0];
  }
  let tagObj = void 0;
  let obj;
  if (isScalar(item)) {
    obj = item.value;
    let match = tags.filter((t3) => t3.identify?.(obj));
    if (match.length > 1) {
      const testMatch = match.filter((t3) => t3.test);
      if (testMatch.length > 0)
        match = testMatch;
    }
    tagObj = match.find((t3) => t3.format === item.format) ?? match.find((t3) => !t3.format);
  } else {
    obj = item;
    tagObj = tags.find((t3) => t3.nodeClass && obj instanceof t3.nodeClass);
  }
  if (!tagObj) {
    const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
    throw new Error(`Tag not resolved for ${name} value`);
  }
  return tagObj;
}
function stringifyProps(node, tagObj, { anchors, doc }) {
  if (!doc.directives)
    return "";
  const props = [];
  const anchor = (isScalar(node) || isCollection(node)) && node.anchor;
  if (anchor && anchorIsValid(anchor)) {
    anchors.add(anchor);
    props.push(`&${anchor}`);
  }
  const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
  if (tag)
    props.push(doc.directives.tagString(tag));
  return props.join(" ");
}
function stringify(item, ctx, onComment, onChompKeep) {
  if (isPair(item))
    return item.toString(ctx, onComment, onChompKeep);
  if (isAlias(item)) {
    if (ctx.doc.directives)
      return item.toString(ctx);
    if (ctx.resolvedAliases?.has(item)) {
      throw new TypeError(`Cannot stringify circular structure without alias nodes`);
    } else {
      if (ctx.resolvedAliases)
        ctx.resolvedAliases.add(item);
      else
        ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
      item = item.resolve(ctx.doc);
    }
  }
  let tagObj = void 0;
  const node = isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o5) => tagObj = o5 });
  tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
  const props = stringifyProps(node, tagObj, ctx);
  if (props.length > 0)
    ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
  const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : isScalar(node) ? stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
  if (!props)
    return str;
  return isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
}

// node_modules/yaml/browser/dist/stringify/stringifyPair.js
function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
  const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
  let keyComment = isNode(key) && key.comment || null;
  if (simpleKeys) {
    if (keyComment) {
      throw new Error("With simple keys, key nodes cannot have comments");
    }
    if (isCollection(key) || !isNode(key) && typeof key === "object") {
      const msg = "With simple keys, collection cannot be used as a key value";
      throw new Error(msg);
    }
  }
  let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || isCollection(key) || (isScalar(key) ? key.type === Scalar.BLOCK_FOLDED || key.type === Scalar.BLOCK_LITERAL : typeof key === "object"));
  ctx = Object.assign({}, ctx, {
    allNullValues: false,
    implicitKey: !explicitKey && (simpleKeys || !allNullValues),
    indent: indent + indentStep
  });
  let keyCommentDone = false;
  let chompKeep = false;
  let str = stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
  if (!explicitKey && !ctx.inFlow && str.length > 1024) {
    if (simpleKeys)
      throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
    explicitKey = true;
  }
  if (ctx.inFlow) {
    if (allNullValues || value == null) {
      if (keyCommentDone && onComment)
        onComment();
      return str === "" ? "?" : explicitKey ? `? ${str}` : str;
    }
  } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
    str = `? ${str}`;
    if (keyComment && !keyCommentDone) {
      str += lineComment(str, ctx.indent, commentString(keyComment));
    } else if (chompKeep && onChompKeep)
      onChompKeep();
    return str;
  }
  if (keyCommentDone)
    keyComment = null;
  if (explicitKey) {
    if (keyComment)
      str += lineComment(str, ctx.indent, commentString(keyComment));
    str = `? ${str}
${indent}:`;
  } else {
    str = `${str}:`;
    if (keyComment)
      str += lineComment(str, ctx.indent, commentString(keyComment));
  }
  let vsb, vcb, valueComment;
  if (isNode(value)) {
    vsb = !!value.spaceBefore;
    vcb = value.commentBefore;
    valueComment = value.comment;
  } else {
    vsb = false;
    vcb = null;
    valueComment = null;
    if (value && typeof value === "object")
      value = doc.createNode(value);
  }
  ctx.implicitKey = false;
  if (!explicitKey && !keyComment && isScalar(value))
    ctx.indentAtStart = str.length + 1;
  chompKeep = false;
  if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && isSeq(value) && !value.flow && !value.tag && !value.anchor) {
    ctx.indent = ctx.indent.substring(2);
  }
  let valueCommentDone = false;
  const valueStr = stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
  let ws = " ";
  if (keyComment || vsb || vcb) {
    ws = vsb ? "\n" : "";
    if (vcb) {
      const cs = commentString(vcb);
      ws += `
${indentComment(cs, ctx.indent)}`;
    }
    if (valueStr === "" && !ctx.inFlow) {
      if (ws === "\n" && valueComment)
        ws = "\n\n";
    } else {
      ws += `
${ctx.indent}`;
    }
  } else if (!explicitKey && isCollection(value)) {
    const vs0 = valueStr[0];
    const nl0 = valueStr.indexOf("\n");
    const hasNewline = nl0 !== -1;
    const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
    if (hasNewline || !flow) {
      let hasPropsLine = false;
      if (hasNewline && (vs0 === "&" || vs0 === "!")) {
        let sp0 = valueStr.indexOf(" ");
        if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
          sp0 = valueStr.indexOf(" ", sp0 + 1);
        }
        if (sp0 === -1 || nl0 < sp0)
          hasPropsLine = true;
      }
      if (!hasPropsLine)
        ws = `
${ctx.indent}`;
    }
  } else if (valueStr === "" || valueStr[0] === "\n") {
    ws = "";
  }
  str += ws + valueStr;
  if (ctx.inFlow) {
    if (valueCommentDone && onComment)
      onComment();
  } else if (valueComment && !valueCommentDone) {
    str += lineComment(str, ctx.indent, commentString(valueComment));
  } else if (chompKeep && onChompKeep) {
    onChompKeep();
  }
  return str;
}

// node_modules/yaml/browser/dist/log.js
function warn(logLevel, warning) {
  if (logLevel === "debug" || logLevel === "warn") {
    console.warn(warning);
  }
}

// node_modules/yaml/browser/dist/schema/yaml-1.1/merge.js
var MERGE_KEY = "<<";
var merge = {
  identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
  default: "key",
  tag: "tag:yaml.org,2002:merge",
  test: /^<<$/,
  resolve: () => Object.assign(new Scalar(Symbol(MERGE_KEY)), {
    addToJSMap: addMergeToJSMap
  }),
  stringify: () => MERGE_KEY
};
var isMergeKey = (ctx, key) => (merge.identify(key) || isScalar(key) && (!key.type || key.type === Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
function addMergeToJSMap(ctx, map2, value) {
  const source = resolveAliasValue(ctx, value);
  if (isSeq(source))
    for (const it of source.items)
      mergeValue(ctx, map2, it);
  else if (Array.isArray(source))
    for (const it of source)
      mergeValue(ctx, map2, it);
  else
    mergeValue(ctx, map2, source);
}
function mergeValue(ctx, map2, value) {
  const source = resolveAliasValue(ctx, value);
  if (!isMap(source))
    throw new Error("Merge sources must be maps or map aliases");
  const srcMap = source.toJSON(null, ctx, Map);
  for (const [key, value2] of srcMap) {
    if (map2 instanceof Map) {
      if (!map2.has(key))
        map2.set(key, value2);
    } else if (map2 instanceof Set) {
      map2.add(key);
    } else if (!Object.prototype.hasOwnProperty.call(map2, key)) {
      Object.defineProperty(map2, key, {
        value: value2,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  }
  return map2;
}
function resolveAliasValue(ctx, value) {
  return ctx && isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
}

// node_modules/yaml/browser/dist/nodes/addPairToJSMap.js
function addPairToJSMap(ctx, map2, { key, value }) {
  if (isNode(key) && key.addToJSMap)
    key.addToJSMap(ctx, map2, value);
  else if (isMergeKey(ctx, key))
    addMergeToJSMap(ctx, map2, value);
  else {
    const jsKey = toJS(key, "", ctx);
    if (map2 instanceof Map) {
      map2.set(jsKey, toJS(value, jsKey, ctx));
    } else if (map2 instanceof Set) {
      map2.add(jsKey);
    } else {
      const stringKey = stringifyKey(key, jsKey, ctx);
      const jsValue = toJS(value, stringKey, ctx);
      if (stringKey in map2)
        Object.defineProperty(map2, stringKey, {
          value: jsValue,
          writable: true,
          enumerable: true,
          configurable: true
        });
      else
        map2[stringKey] = jsValue;
    }
  }
  return map2;
}
function stringifyKey(key, jsKey, ctx) {
  if (jsKey === null)
    return "";
  if (typeof jsKey !== "object")
    return String(jsKey);
  if (isNode(key) && ctx?.doc) {
    const strCtx = createStringifyContext(ctx.doc, {});
    strCtx.anchors = /* @__PURE__ */ new Set();
    for (const node of ctx.anchors.keys())
      strCtx.anchors.add(node.anchor);
    strCtx.inFlow = true;
    strCtx.inStringifyKey = true;
    const strKey = key.toString(strCtx);
    if (!ctx.mapKeyWarned) {
      let jsonStr = JSON.stringify(strKey);
      if (jsonStr.length > 40)
        jsonStr = jsonStr.substring(0, 36) + '..."';
      warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
      ctx.mapKeyWarned = true;
    }
    return strKey;
  }
  return JSON.stringify(jsKey);
}

// node_modules/yaml/browser/dist/nodes/Pair.js
function createPair(key, value, ctx) {
  const k2 = createNode(key, void 0, ctx);
  const v2 = createNode(value, void 0, ctx);
  return new Pair(k2, v2);
}
var Pair = class _Pair {
  constructor(key, value = null) {
    Object.defineProperty(this, NODE_TYPE, { value: PAIR });
    this.key = key;
    this.value = value;
  }
  clone(schema4) {
    let { key, value } = this;
    if (isNode(key))
      key = key.clone(schema4);
    if (isNode(value))
      value = value.clone(schema4);
    return new _Pair(key, value);
  }
  toJSON(_2, ctx) {
    const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
    return addPairToJSMap(ctx, pair, this);
  }
  toString(ctx, onComment, onChompKeep) {
    return ctx?.doc ? stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyCollection.js
function stringifyCollection(collection, ctx, options) {
  const flow = ctx.inFlow ?? collection.flow;
  const stringify4 = flow ? stringifyFlowCollection : stringifyBlockCollection;
  return stringify4(collection, ctx, options);
}
function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
  const { indent, options: { commentString } } = ctx;
  const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
  let chompKeep = false;
  const lines = [];
  for (let i5 = 0; i5 < items.length; ++i5) {
    const item = items[i5];
    let comment2 = null;
    if (isNode(item)) {
      if (!chompKeep && item.spaceBefore)
        lines.push("");
      addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
      if (item.comment)
        comment2 = item.comment;
    } else if (isPair(item)) {
      const ik = isNode(item.key) ? item.key : null;
      if (ik) {
        if (!chompKeep && ik.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
      }
    }
    chompKeep = false;
    let str2 = stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
    if (comment2)
      str2 += lineComment(str2, itemIndent, commentString(comment2));
    if (chompKeep && comment2)
      chompKeep = false;
    lines.push(blockItemPrefix + str2);
  }
  let str;
  if (lines.length === 0) {
    str = flowChars.start + flowChars.end;
  } else {
    str = lines[0];
    for (let i5 = 1; i5 < lines.length; ++i5) {
      const line = lines[i5];
      str += line ? `
${indent}${line}` : "\n";
    }
  }
  if (comment) {
    str += "\n" + indentComment(commentString(comment), indent);
    if (onComment)
      onComment();
  } else if (chompKeep && onChompKeep)
    onChompKeep();
  return str;
}
function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
  const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
  itemIndent += indentStep;
  const itemCtx = Object.assign({}, ctx, {
    indent: itemIndent,
    inFlow: true,
    type: null
  });
  let reqNewline = false;
  let linesAtValue = 0;
  const lines = [];
  for (let i5 = 0; i5 < items.length; ++i5) {
    const item = items[i5];
    let comment = null;
    if (isNode(item)) {
      if (item.spaceBefore)
        lines.push("");
      addCommentBefore(ctx, lines, item.commentBefore, false);
      if (item.comment)
        comment = item.comment;
    } else if (isPair(item)) {
      const ik = isNode(item.key) ? item.key : null;
      if (ik) {
        if (ik.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, ik.commentBefore, false);
        if (ik.comment)
          reqNewline = true;
      }
      const iv = isNode(item.value) ? item.value : null;
      if (iv) {
        if (iv.comment)
          comment = iv.comment;
        if (iv.commentBefore)
          reqNewline = true;
      } else if (item.value == null && ik?.comment) {
        comment = ik.comment;
      }
    }
    if (comment)
      reqNewline = true;
    let str = stringify(item, itemCtx, () => comment = null);
    reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
    if (i5 < items.length - 1) {
      str += ",";
    } else if (ctx.options.trailingComma) {
      if (ctx.options.lineWidth > 0) {
        reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
      }
      if (reqNewline) {
        str += ",";
      }
    }
    if (comment)
      str += lineComment(str, itemIndent, commentString(comment));
    lines.push(str);
    linesAtValue = lines.length;
  }
  const { start, end } = flowChars;
  if (lines.length === 0) {
    return start + end;
  } else {
    if (!reqNewline) {
      const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
      reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
    }
    if (reqNewline) {
      let str = start;
      for (const line of lines)
        str += line ? `
${indentStep}${indent}${line}` : "\n";
      return `${str}
${indent}${end}`;
    } else {
      return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
    }
  }
}
function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
  if (comment && chompKeep)
    comment = comment.replace(/^\n+/, "");
  if (comment) {
    const ic = indentComment(commentString(comment), indent);
    lines.push(ic.trimStart());
  }
}

// node_modules/yaml/browser/dist/nodes/YAMLMap.js
function findPair(items, key) {
  const k2 = isScalar(key) ? key.value : key;
  for (const it of items) {
    if (isPair(it)) {
      if (it.key === key || it.key === k2)
        return it;
      if (isScalar(it.key) && it.key.value === k2)
        return it;
    }
  }
  return void 0;
}
var YAMLMap = class extends Collection {
  static get tagName() {
    return "tag:yaml.org,2002:map";
  }
  constructor(schema4) {
    super(MAP, schema4);
    this.items = [];
  }
  /**
   * A generic collection parsing method that can be extended
   * to other node classes that inherit from YAMLMap
   */
  static from(schema4, obj, ctx) {
    const { keepUndefined, replacer } = ctx;
    const map2 = new this(schema4);
    const add = (key, value) => {
      if (typeof replacer === "function")
        value = replacer.call(obj, key, value);
      else if (Array.isArray(replacer) && !replacer.includes(key))
        return;
      if (value !== void 0 || keepUndefined)
        map2.items.push(createPair(key, value, ctx));
    };
    if (obj instanceof Map) {
      for (const [key, value] of obj)
        add(key, value);
    } else if (obj && typeof obj === "object") {
      for (const key of Object.keys(obj))
        add(key, obj[key]);
    }
    if (typeof schema4.sortMapEntries === "function") {
      map2.items.sort(schema4.sortMapEntries);
    }
    return map2;
  }
  /**
   * Adds a value to the collection.
   *
   * @param overwrite - If not set `true`, using a key that is already in the
   *   collection will throw. Otherwise, overwrites the previous value.
   */
  add(pair, overwrite) {
    let _pair;
    if (isPair(pair))
      _pair = pair;
    else if (!pair || typeof pair !== "object" || !("key" in pair)) {
      _pair = new Pair(pair, pair?.value);
    } else
      _pair = new Pair(pair.key, pair.value);
    const prev = findPair(this.items, _pair.key);
    const sortEntries = this.schema?.sortMapEntries;
    if (prev) {
      if (!overwrite)
        throw new Error(`Key ${_pair.key} already set`);
      if (isScalar(prev.value) && isScalarValue(_pair.value))
        prev.value.value = _pair.value;
      else
        prev.value = _pair.value;
    } else if (sortEntries) {
      const i5 = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
      if (i5 === -1)
        this.items.push(_pair);
      else
        this.items.splice(i5, 0, _pair);
    } else {
      this.items.push(_pair);
    }
  }
  delete(key) {
    const it = findPair(this.items, key);
    if (!it)
      return false;
    const del = this.items.splice(this.items.indexOf(it), 1);
    return del.length > 0;
  }
  get(key, keepScalar) {
    const it = findPair(this.items, key);
    const node = it?.value;
    return (!keepScalar && isScalar(node) ? node.value : node) ?? void 0;
  }
  has(key) {
    return !!findPair(this.items, key);
  }
  set(key, value) {
    this.add(new Pair(key, value), true);
  }
  /**
   * @param ctx - Conversion context, originally set in Document#toJS()
   * @param {Class} Type - If set, forces the returned collection type
   * @returns Instance of Type, Map, or Object
   */
  toJSON(_2, ctx, Type) {
    const map2 = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
    if (ctx?.onCreate)
      ctx.onCreate(map2);
    for (const item of this.items)
      addPairToJSMap(ctx, map2, item);
    return map2;
  }
  toString(ctx, onComment, onChompKeep) {
    if (!ctx)
      return JSON.stringify(this);
    for (const item of this.items) {
      if (!isPair(item))
        throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
    }
    if (!ctx.allNullValues && this.hasAllNullValues(false))
      ctx = Object.assign({}, ctx, { allNullValues: true });
    return stringifyCollection(this, ctx, {
      blockItemPrefix: "",
      flowChars: { start: "{", end: "}" },
      itemIndent: ctx.indent || "",
      onChompKeep,
      onComment
    });
  }
};

// node_modules/yaml/browser/dist/schema/common/map.js
var map = {
  collection: "map",
  default: true,
  nodeClass: YAMLMap,
  tag: "tag:yaml.org,2002:map",
  resolve(map2, onError) {
    if (!isMap(map2))
      onError("Expected a mapping for this tag");
    return map2;
  },
  createNode: (schema4, obj, ctx) => YAMLMap.from(schema4, obj, ctx)
};

// node_modules/yaml/browser/dist/nodes/YAMLSeq.js
var YAMLSeq = class extends Collection {
  static get tagName() {
    return "tag:yaml.org,2002:seq";
  }
  constructor(schema4) {
    super(SEQ, schema4);
    this.items = [];
  }
  add(value) {
    this.items.push(value);
  }
  /**
   * Removes a value from the collection.
   *
   * `key` must contain a representation of an integer for this to succeed.
   * It may be wrapped in a `Scalar`.
   *
   * @returns `true` if the item was found and removed.
   */
  delete(key) {
    const idx = asItemIndex(key);
    if (typeof idx !== "number")
      return false;
    const del = this.items.splice(idx, 1);
    return del.length > 0;
  }
  get(key, keepScalar) {
    const idx = asItemIndex(key);
    if (typeof idx !== "number")
      return void 0;
    const it = this.items[idx];
    return !keepScalar && isScalar(it) ? it.value : it;
  }
  /**
   * Checks if the collection includes a value with the key `key`.
   *
   * `key` must contain a representation of an integer for this to succeed.
   * It may be wrapped in a `Scalar`.
   */
  has(key) {
    const idx = asItemIndex(key);
    return typeof idx === "number" && idx < this.items.length;
  }
  /**
   * Sets a value in this collection. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   *
   * If `key` does not contain a representation of an integer, this will throw.
   * It may be wrapped in a `Scalar`.
   */
  set(key, value) {
    const idx = asItemIndex(key);
    if (typeof idx !== "number")
      throw new Error(`Expected a valid index, not ${key}.`);
    const prev = this.items[idx];
    if (isScalar(prev) && isScalarValue(value))
      prev.value = value;
    else
      this.items[idx] = value;
  }
  toJSON(_2, ctx) {
    const seq2 = [];
    if (ctx?.onCreate)
      ctx.onCreate(seq2);
    let i5 = 0;
    for (const item of this.items)
      seq2.push(toJS(item, String(i5++), ctx));
    return seq2;
  }
  toString(ctx, onComment, onChompKeep) {
    if (!ctx)
      return JSON.stringify(this);
    return stringifyCollection(this, ctx, {
      blockItemPrefix: "- ",
      flowChars: { start: "[", end: "]" },
      itemIndent: (ctx.indent || "") + "  ",
      onChompKeep,
      onComment
    });
  }
  static from(schema4, obj, ctx) {
    const { replacer } = ctx;
    const seq2 = new this(schema4);
    if (obj && Symbol.iterator in Object(obj)) {
      let i5 = 0;
      for (let it of obj) {
        if (typeof replacer === "function") {
          const key = obj instanceof Set ? it : String(i5++);
          it = replacer.call(obj, key, it);
        }
        seq2.items.push(createNode(it, void 0, ctx));
      }
    }
    return seq2;
  }
};
function asItemIndex(key) {
  let idx = isScalar(key) ? key.value : key;
  if (idx && typeof idx === "string")
    idx = Number(idx);
  return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
}

// node_modules/yaml/browser/dist/schema/common/seq.js
var seq = {
  collection: "seq",
  default: true,
  nodeClass: YAMLSeq,
  tag: "tag:yaml.org,2002:seq",
  resolve(seq2, onError) {
    if (!isSeq(seq2))
      onError("Expected a sequence for this tag");
    return seq2;
  },
  createNode: (schema4, obj, ctx) => YAMLSeq.from(schema4, obj, ctx)
};

// node_modules/yaml/browser/dist/schema/common/string.js
var string = {
  identify: (value) => typeof value === "string",
  default: true,
  tag: "tag:yaml.org,2002:str",
  resolve: (str) => str,
  stringify(item, ctx, onComment, onChompKeep) {
    ctx = Object.assign({ actualString: true }, ctx);
    return stringifyString(item, ctx, onComment, onChompKeep);
  }
};

// node_modules/yaml/browser/dist/schema/common/null.js
var nullTag = {
  identify: (value) => value == null,
  createNode: () => new Scalar(null),
  default: true,
  tag: "tag:yaml.org,2002:null",
  test: /^(?:~|[Nn]ull|NULL)?$/,
  resolve: () => new Scalar(null),
  stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
};

// node_modules/yaml/browser/dist/schema/core/bool.js
var boolTag = {
  identify: (value) => typeof value === "boolean",
  default: true,
  tag: "tag:yaml.org,2002:bool",
  test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
  resolve: (str) => new Scalar(str[0] === "t" || str[0] === "T"),
  stringify({ source, value }, ctx) {
    if (source && boolTag.test.test(source)) {
      const sv = source[0] === "t" || source[0] === "T";
      if (value === sv)
        return source;
    }
    return value ? ctx.options.trueStr : ctx.options.falseStr;
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyNumber.js
function stringifyNumber({ format, minFractionDigits, tag, value }) {
  if (typeof value === "bigint")
    return String(value);
  const num = typeof value === "number" ? value : Number(value);
  if (!isFinite(num))
    return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
  let n4 = Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n4) && !n4.includes("e")) {
    let i5 = n4.indexOf(".");
    if (i5 < 0) {
      i5 = n4.length;
      n4 += ".";
    }
    let d3 = minFractionDigits - (n4.length - i5 - 1);
    while (d3-- > 0)
      n4 += "0";
  }
  return n4;
}

// node_modules/yaml/browser/dist/schema/core/float.js
var floatNaN = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
  resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
  stringify: stringifyNumber
};
var floatExp = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  format: "EXP",
  test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
  resolve: (str) => parseFloat(str),
  stringify(node) {
    const num = Number(node.value);
    return isFinite(num) ? num.toExponential() : stringifyNumber(node);
  }
};
var float = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
  resolve(str) {
    const node = new Scalar(parseFloat(str));
    const dot = str.indexOf(".");
    if (dot !== -1 && str[str.length - 1] === "0")
      node.minFractionDigits = str.length - dot - 1;
    return node;
  },
  stringify: stringifyNumber
};

// node_modules/yaml/browser/dist/schema/core/int.js
var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
function intStringify(node, radix, prefix) {
  const { value } = node;
  if (intIdentify(value) && value >= 0)
    return prefix + value.toString(radix);
  return stringifyNumber(node);
}
var intOct = {
  identify: (value) => intIdentify(value) && value >= 0,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "OCT",
  test: /^0o[0-7]+$/,
  resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
  stringify: (node) => intStringify(node, 8, "0o")
};
var int = {
  identify: intIdentify,
  default: true,
  tag: "tag:yaml.org,2002:int",
  test: /^[-+]?[0-9]+$/,
  resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
  stringify: stringifyNumber
};
var intHex = {
  identify: (value) => intIdentify(value) && value >= 0,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "HEX",
  test: /^0x[0-9a-fA-F]+$/,
  resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
  stringify: (node) => intStringify(node, 16, "0x")
};

// node_modules/yaml/browser/dist/schema/core/schema.js
var schema = [
  map,
  seq,
  string,
  nullTag,
  boolTag,
  intOct,
  int,
  intHex,
  floatNaN,
  floatExp,
  float
];

// node_modules/yaml/browser/dist/schema/json/schema.js
function intIdentify2(value) {
  return typeof value === "bigint" || Number.isInteger(value);
}
var stringifyJSON = ({ value }) => JSON.stringify(value);
var jsonScalars = [
  {
    identify: (value) => typeof value === "string",
    default: true,
    tag: "tag:yaml.org,2002:str",
    resolve: (str) => str,
    stringify: stringifyJSON
  },
  {
    identify: (value) => value == null,
    createNode: () => new Scalar(null),
    default: true,
    tag: "tag:yaml.org,2002:null",
    test: /^null$/,
    resolve: () => null,
    stringify: stringifyJSON
  },
  {
    identify: (value) => typeof value === "boolean",
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^true$|^false$/,
    resolve: (str) => str === "true",
    stringify: stringifyJSON
  },
  {
    identify: intIdentify2,
    default: true,
    tag: "tag:yaml.org,2002:int",
    test: /^-?(?:0|[1-9][0-9]*)$/,
    resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
    stringify: ({ value }) => intIdentify2(value) ? value.toString() : JSON.stringify(value)
  },
  {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
    resolve: (str) => parseFloat(str),
    stringify: stringifyJSON
  }
];
var jsonError = {
  default: true,
  tag: "",
  test: /^/,
  resolve(str, onError) {
    onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
    return str;
  }
};
var schema2 = [map, seq].concat(jsonScalars, jsonError);

// node_modules/yaml/browser/dist/schema/yaml-1.1/binary.js
var binary = {
  identify: (value) => value instanceof Uint8Array,
  // Buffer inherits from Uint8Array
  default: false,
  tag: "tag:yaml.org,2002:binary",
  /**
   * Returns a Buffer in node and an Uint8Array in browsers
   *
   * To use the resulting buffer as an image, you'll want to do something like:
   *
   *   const blob = new Blob([buffer], { type: 'image/jpeg' })
   *   document.querySelector('#photo').src = URL.createObjectURL(blob)
   */
  resolve(src, onError) {
    if (typeof atob === "function") {
      const str = atob(src.replace(/[\n\r]/g, ""));
      const buffer = new Uint8Array(str.length);
      for (let i5 = 0; i5 < str.length; ++i5)
        buffer[i5] = str.charCodeAt(i5);
      return buffer;
    } else {
      onError("This environment does not support reading binary tags; either Buffer or atob is required");
      return src;
    }
  },
  stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
    if (!value)
      return "";
    const buf = value;
    let str;
    if (typeof btoa === "function") {
      let s4 = "";
      for (let i5 = 0; i5 < buf.length; ++i5)
        s4 += String.fromCharCode(buf[i5]);
      str = btoa(s4);
    } else {
      throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
    }
    type ?? (type = Scalar.BLOCK_LITERAL);
    if (type !== Scalar.QUOTE_DOUBLE) {
      const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
      const n4 = Math.ceil(str.length / lineWidth);
      const lines = new Array(n4);
      for (let i5 = 0, o5 = 0; i5 < n4; ++i5, o5 += lineWidth) {
        lines[i5] = str.substr(o5, lineWidth);
      }
      str = lines.join(type === Scalar.BLOCK_LITERAL ? "\n" : " ");
    }
    return stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
  }
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/pairs.js
function resolvePairs(seq2, onError) {
  if (isSeq(seq2)) {
    for (let i5 = 0; i5 < seq2.items.length; ++i5) {
      let item = seq2.items[i5];
      if (isPair(item))
        continue;
      else if (isMap(item)) {
        if (item.items.length > 1)
          onError("Each pair must have its own sequence indicator");
        const pair = item.items[0] || new Pair(new Scalar(null));
        if (item.commentBefore)
          pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
        if (item.comment) {
          const cn = pair.value ?? pair.key;
          cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
        }
        item = pair;
      }
      seq2.items[i5] = isPair(item) ? item : new Pair(item);
    }
  } else
    onError("Expected a sequence for this tag");
  return seq2;
}
function createPairs(schema4, iterable, ctx) {
  const { replacer } = ctx;
  const pairs2 = new YAMLSeq(schema4);
  pairs2.tag = "tag:yaml.org,2002:pairs";
  let i5 = 0;
  if (iterable && Symbol.iterator in Object(iterable))
    for (let it of iterable) {
      if (typeof replacer === "function")
        it = replacer.call(iterable, String(i5++), it);
      let key, value;
      if (Array.isArray(it)) {
        if (it.length === 2) {
          key = it[0];
          value = it[1];
        } else
          throw new TypeError(`Expected [key, value] tuple: ${it}`);
      } else if (it && it instanceof Object) {
        const keys = Object.keys(it);
        if (keys.length === 1) {
          key = keys[0];
          value = it[key];
        } else {
          throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
        }
      } else {
        key = it;
      }
      pairs2.items.push(createPair(key, value, ctx));
    }
  return pairs2;
}
var pairs = {
  collection: "seq",
  default: false,
  tag: "tag:yaml.org,2002:pairs",
  resolve: resolvePairs,
  createNode: createPairs
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/omap.js
var YAMLOMap = class _YAMLOMap extends YAMLSeq {
  constructor() {
    super();
    this.add = YAMLMap.prototype.add.bind(this);
    this.delete = YAMLMap.prototype.delete.bind(this);
    this.get = YAMLMap.prototype.get.bind(this);
    this.has = YAMLMap.prototype.has.bind(this);
    this.set = YAMLMap.prototype.set.bind(this);
    this.tag = _YAMLOMap.tag;
  }
  /**
   * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
   * but TypeScript won't allow widening the signature of a child method.
   */
  toJSON(_2, ctx) {
    if (!ctx)
      return super.toJSON(_2);
    const map2 = /* @__PURE__ */ new Map();
    if (ctx?.onCreate)
      ctx.onCreate(map2);
    for (const pair of this.items) {
      let key, value;
      if (isPair(pair)) {
        key = toJS(pair.key, "", ctx);
        value = toJS(pair.value, key, ctx);
      } else {
        key = toJS(pair, "", ctx);
      }
      if (map2.has(key))
        throw new Error("Ordered maps must not include duplicate keys");
      map2.set(key, value);
    }
    return map2;
  }
  static from(schema4, iterable, ctx) {
    const pairs2 = createPairs(schema4, iterable, ctx);
    const omap2 = new this();
    omap2.items = pairs2.items;
    return omap2;
  }
};
YAMLOMap.tag = "tag:yaml.org,2002:omap";
var omap = {
  collection: "seq",
  identify: (value) => value instanceof Map,
  nodeClass: YAMLOMap,
  default: false,
  tag: "tag:yaml.org,2002:omap",
  resolve(seq2, onError) {
    const pairs2 = resolvePairs(seq2, onError);
    const seenKeys = [];
    for (const { key } of pairs2.items) {
      if (isScalar(key)) {
        if (seenKeys.includes(key.value)) {
          onError(`Ordered maps must not include duplicate keys: ${key.value}`);
        } else {
          seenKeys.push(key.value);
        }
      }
    }
    return Object.assign(new YAMLOMap(), pairs2);
  },
  createNode: (schema4, iterable, ctx) => YAMLOMap.from(schema4, iterable, ctx)
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/bool.js
function boolStringify({ value, source }, ctx) {
  const boolObj = value ? trueTag : falseTag;
  if (source && boolObj.test.test(source))
    return source;
  return value ? ctx.options.trueStr : ctx.options.falseStr;
}
var trueTag = {
  identify: (value) => value === true,
  default: true,
  tag: "tag:yaml.org,2002:bool",
  test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
  resolve: () => new Scalar(true),
  stringify: boolStringify
};
var falseTag = {
  identify: (value) => value === false,
  default: true,
  tag: "tag:yaml.org,2002:bool",
  test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
  resolve: () => new Scalar(false),
  stringify: boolStringify
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/float.js
var floatNaN2 = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
  resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
  stringify: stringifyNumber
};
var floatExp2 = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  format: "EXP",
  test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
  resolve: (str) => parseFloat(str.replace(/_/g, "")),
  stringify(node) {
    const num = Number(node.value);
    return isFinite(num) ? num.toExponential() : stringifyNumber(node);
  }
};
var float2 = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
  resolve(str) {
    const node = new Scalar(parseFloat(str.replace(/_/g, "")));
    const dot = str.indexOf(".");
    if (dot !== -1) {
      const f3 = str.substring(dot + 1).replace(/_/g, "");
      if (f3[f3.length - 1] === "0")
        node.minFractionDigits = f3.length;
    }
    return node;
  },
  stringify: stringifyNumber
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/int.js
var intIdentify3 = (value) => typeof value === "bigint" || Number.isInteger(value);
function intResolve2(str, offset, radix, { intAsBigInt }) {
  const sign = str[0];
  if (sign === "-" || sign === "+")
    offset += 1;
  str = str.substring(offset).replace(/_/g, "");
  if (intAsBigInt) {
    switch (radix) {
      case 2:
        str = `0b${str}`;
        break;
      case 8:
        str = `0o${str}`;
        break;
      case 16:
        str = `0x${str}`;
        break;
    }
    const n5 = BigInt(str);
    return sign === "-" ? BigInt(-1) * n5 : n5;
  }
  const n4 = parseInt(str, radix);
  return sign === "-" ? -1 * n4 : n4;
}
function intStringify2(node, radix, prefix) {
  const { value } = node;
  if (intIdentify3(value)) {
    const str = value.toString(radix);
    return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
  }
  return stringifyNumber(node);
}
var intBin = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "BIN",
  test: /^[-+]?0b[0-1_]+$/,
  resolve: (str, _onError, opt) => intResolve2(str, 2, 2, opt),
  stringify: (node) => intStringify2(node, 2, "0b")
};
var intOct2 = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "OCT",
  test: /^[-+]?0[0-7_]+$/,
  resolve: (str, _onError, opt) => intResolve2(str, 1, 8, opt),
  stringify: (node) => intStringify2(node, 8, "0")
};
var int2 = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  test: /^[-+]?[0-9][0-9_]*$/,
  resolve: (str, _onError, opt) => intResolve2(str, 0, 10, opt),
  stringify: stringifyNumber
};
var intHex2 = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "HEX",
  test: /^[-+]?0x[0-9a-fA-F_]+$/,
  resolve: (str, _onError, opt) => intResolve2(str, 2, 16, opt),
  stringify: (node) => intStringify2(node, 16, "0x")
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/set.js
var YAMLSet = class _YAMLSet extends YAMLMap {
  constructor(schema4) {
    super(schema4);
    this.tag = _YAMLSet.tag;
  }
  add(key) {
    let pair;
    if (isPair(key))
      pair = key;
    else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
      pair = new Pair(key.key, null);
    else
      pair = new Pair(key, null);
    const prev = findPair(this.items, pair.key);
    if (!prev)
      this.items.push(pair);
  }
  /**
   * If `keepPair` is `true`, returns the Pair matching `key`.
   * Otherwise, returns the value of that Pair's key.
   */
  get(key, keepPair) {
    const pair = findPair(this.items, key);
    return !keepPair && isPair(pair) ? isScalar(pair.key) ? pair.key.value : pair.key : pair;
  }
  set(key, value) {
    if (typeof value !== "boolean")
      throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
    const prev = findPair(this.items, key);
    if (prev && !value) {
      this.items.splice(this.items.indexOf(prev), 1);
    } else if (!prev && value) {
      this.items.push(new Pair(key));
    }
  }
  toJSON(_2, ctx) {
    return super.toJSON(_2, ctx, Set);
  }
  toString(ctx, onComment, onChompKeep) {
    if (!ctx)
      return JSON.stringify(this);
    if (this.hasAllNullValues(true))
      return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
    else
      throw new Error("Set items must all have null values");
  }
  static from(schema4, iterable, ctx) {
    const { replacer } = ctx;
    const set2 = new this(schema4);
    if (iterable && Symbol.iterator in Object(iterable))
      for (let value of iterable) {
        if (typeof replacer === "function")
          value = replacer.call(iterable, value, value);
        set2.items.push(createPair(value, null, ctx));
      }
    return set2;
  }
};
YAMLSet.tag = "tag:yaml.org,2002:set";
var set = {
  collection: "map",
  identify: (value) => value instanceof Set,
  nodeClass: YAMLSet,
  default: false,
  tag: "tag:yaml.org,2002:set",
  createNode: (schema4, iterable, ctx) => YAMLSet.from(schema4, iterable, ctx),
  resolve(map2, onError) {
    if (isMap(map2)) {
      if (map2.hasAllNullValues(true))
        return Object.assign(new YAMLSet(), map2);
      else
        onError("Set items must all have null values");
    } else
      onError("Expected a mapping for this tag");
    return map2;
  }
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/timestamp.js
function parseSexagesimal(str, asBigInt) {
  const sign = str[0];
  const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
  const num = (n4) => asBigInt ? BigInt(n4) : Number(n4);
  const res = parts.replace(/_/g, "").split(":").reduce((res2, p3) => res2 * num(60) + num(p3), num(0));
  return sign === "-" ? num(-1) * res : res;
}
function stringifySexagesimal(node) {
  let { value } = node;
  let num = (n4) => n4;
  if (typeof value === "bigint")
    num = (n4) => BigInt(n4);
  else if (isNaN(value) || !isFinite(value))
    return stringifyNumber(node);
  let sign = "";
  if (value < 0) {
    sign = "-";
    value *= num(-1);
  }
  const _60 = num(60);
  const parts = [value % _60];
  if (value < 60) {
    parts.unshift(0);
  } else {
    value = (value - parts[0]) / _60;
    parts.unshift(value % _60);
    if (value >= 60) {
      value = (value - parts[0]) / _60;
      parts.unshift(value);
    }
  }
  return sign + parts.map((n4) => String(n4).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
}
var intTime = {
  identify: (value) => typeof value === "bigint" || Number.isInteger(value),
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "TIME",
  test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
  resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
  stringify: stringifySexagesimal
};
var floatTime = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  format: "TIME",
  test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
  resolve: (str) => parseSexagesimal(str, false),
  stringify: stringifySexagesimal
};
var timestamp = {
  identify: (value) => value instanceof Date,
  default: true,
  tag: "tag:yaml.org,2002:timestamp",
  // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
  // may be omitted altogether, resulting in a date format. In such a case, the time part is
  // assumed to be 00:00:00Z (start of day, UTC).
  test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
  resolve(str) {
    const match = str.match(timestamp.test);
    if (!match)
      throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
    const [, year, month, day, hour, minute, second] = match.map(Number);
    const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
    let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
    const tz = match[8];
    if (tz && tz !== "Z") {
      let d3 = parseSexagesimal(tz, false);
      if (Math.abs(d3) < 30)
        d3 *= 60;
      date -= 6e4 * d3;
    }
    return new Date(date);
  },
  stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/schema.js
var schema3 = [
  map,
  seq,
  string,
  nullTag,
  trueTag,
  falseTag,
  intBin,
  intOct2,
  int2,
  intHex2,
  floatNaN2,
  floatExp2,
  float2,
  binary,
  merge,
  omap,
  pairs,
  set,
  intTime,
  floatTime,
  timestamp
];

// node_modules/yaml/browser/dist/schema/tags.js
var schemas = /* @__PURE__ */ new Map([
  ["core", schema],
  ["failsafe", [map, seq, string]],
  ["json", schema2],
  ["yaml11", schema3],
  ["yaml-1.1", schema3]
]);
var tagsByName = {
  binary,
  bool: boolTag,
  float,
  floatExp,
  floatNaN,
  floatTime,
  int,
  intHex,
  intOct,
  intTime,
  map,
  merge,
  null: nullTag,
  omap,
  pairs,
  seq,
  set,
  timestamp
};
var coreKnownTags = {
  "tag:yaml.org,2002:binary": binary,
  "tag:yaml.org,2002:merge": merge,
  "tag:yaml.org,2002:omap": omap,
  "tag:yaml.org,2002:pairs": pairs,
  "tag:yaml.org,2002:set": set,
  "tag:yaml.org,2002:timestamp": timestamp
};
function getTags(customTags, schemaName, addMergeTag) {
  const schemaTags = schemas.get(schemaName);
  if (schemaTags && !customTags) {
    return addMergeTag && !schemaTags.includes(merge) ? schemaTags.concat(merge) : schemaTags.slice();
  }
  let tags = schemaTags;
  if (!tags) {
    if (Array.isArray(customTags))
      tags = [];
    else {
      const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
      throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
    }
  }
  if (Array.isArray(customTags)) {
    for (const tag of customTags)
      tags = tags.concat(tag);
  } else if (typeof customTags === "function") {
    tags = customTags(tags.slice());
  }
  if (addMergeTag)
    tags = tags.concat(merge);
  return tags.reduce((tags2, tag) => {
    const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
    if (!tagObj) {
      const tagName = JSON.stringify(tag);
      const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
      throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
    }
    if (!tags2.includes(tagObj))
      tags2.push(tagObj);
    return tags2;
  }, []);
}

// node_modules/yaml/browser/dist/schema/Schema.js
var sortMapEntriesByKey = (a3, b3) => a3.key < b3.key ? -1 : a3.key > b3.key ? 1 : 0;
var Schema = class _Schema {
  constructor({ compat, customTags, merge: merge2, resolveKnownTags, schema: schema4, sortMapEntries, toStringDefaults }) {
    this.compat = Array.isArray(compat) ? getTags(compat, "compat") : compat ? getTags(null, compat) : null;
    this.name = typeof schema4 === "string" && schema4 || "core";
    this.knownTags = resolveKnownTags ? coreKnownTags : {};
    this.tags = getTags(customTags, this.name, merge2);
    this.toStringOptions = toStringDefaults ?? null;
    Object.defineProperty(this, MAP, { value: map });
    Object.defineProperty(this, SCALAR, { value: string });
    Object.defineProperty(this, SEQ, { value: seq });
    this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
  }
  clone() {
    const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
    copy.tags = this.tags.slice();
    return copy;
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyDocument.js
function stringifyDocument(doc, options) {
  const lines = [];
  let hasDirectives = options.directives === true;
  if (options.directives !== false && doc.directives) {
    const dir = doc.directives.toString(doc);
    if (dir) {
      lines.push(dir);
      hasDirectives = true;
    } else if (doc.directives.docStart)
      hasDirectives = true;
  }
  if (hasDirectives)
    lines.push("---");
  const ctx = createStringifyContext(doc, options);
  const { commentString } = ctx.options;
  if (doc.commentBefore) {
    if (lines.length !== 1)
      lines.unshift("");
    const cs = commentString(doc.commentBefore);
    lines.unshift(indentComment(cs, ""));
  }
  let chompKeep = false;
  let contentComment = null;
  if (doc.contents) {
    if (isNode(doc.contents)) {
      if (doc.contents.spaceBefore && hasDirectives)
        lines.push("");
      if (doc.contents.commentBefore) {
        const cs = commentString(doc.contents.commentBefore);
        lines.push(indentComment(cs, ""));
      }
      ctx.forceBlockIndent = !!doc.comment;
      contentComment = doc.contents.comment;
    }
    const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
    let body = stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
    if (contentComment)
      body += lineComment(body, "", commentString(contentComment));
    if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
      lines[lines.length - 1] = `--- ${body}`;
    } else
      lines.push(body);
  } else {
    lines.push(stringify(doc.contents, ctx));
  }
  if (doc.directives?.docEnd) {
    if (doc.comment) {
      const cs = commentString(doc.comment);
      if (cs.includes("\n")) {
        lines.push("...");
        lines.push(indentComment(cs, ""));
      } else {
        lines.push(`... ${cs}`);
      }
    } else {
      lines.push("...");
    }
  } else {
    let dc = doc.comment;
    if (dc && chompKeep)
      dc = dc.replace(/^\n+/, "");
    if (dc) {
      if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
        lines.push("");
      lines.push(indentComment(commentString(dc), ""));
    }
  }
  return lines.join("\n") + "\n";
}

// node_modules/yaml/browser/dist/doc/Document.js
var Document2 = class _Document {
  constructor(value, replacer, options) {
    this.commentBefore = null;
    this.comment = null;
    this.errors = [];
    this.warnings = [];
    Object.defineProperty(this, NODE_TYPE, { value: DOC });
    let _replacer = null;
    if (typeof replacer === "function" || Array.isArray(replacer)) {
      _replacer = replacer;
    } else if (options === void 0 && replacer) {
      options = replacer;
      replacer = void 0;
    }
    const opt = Object.assign({
      intAsBigInt: false,
      keepSourceTokens: false,
      logLevel: "warn",
      prettyErrors: true,
      strict: true,
      stringKeys: false,
      uniqueKeys: true,
      version: "1.2"
    }, options);
    this.options = opt;
    let { version } = opt;
    if (options?._directives) {
      this.directives = options._directives.atDocument();
      if (this.directives.yaml.explicit)
        version = this.directives.yaml.version;
    } else
      this.directives = new Directives({ version });
    this.setSchema(version, options);
    this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
  }
  /**
   * Create a deep copy of this Document and its contents.
   *
   * Custom Node values that inherit from `Object` still refer to their original instances.
   */
  clone() {
    const copy = Object.create(_Document.prototype, {
      [NODE_TYPE]: { value: DOC }
    });
    copy.commentBefore = this.commentBefore;
    copy.comment = this.comment;
    copy.errors = this.errors.slice();
    copy.warnings = this.warnings.slice();
    copy.options = Object.assign({}, this.options);
    if (this.directives)
      copy.directives = this.directives.clone();
    copy.schema = this.schema.clone();
    copy.contents = isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
    if (this.range)
      copy.range = this.range.slice();
    return copy;
  }
  /** Adds a value to the document. */
  add(value) {
    if (assertCollection(this.contents))
      this.contents.add(value);
  }
  /** Adds a value to the document. */
  addIn(path, value) {
    if (assertCollection(this.contents))
      this.contents.addIn(path, value);
  }
  /**
   * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
   *
   * If `node` already has an anchor, `name` is ignored.
   * Otherwise, the `node.anchor` value will be set to `name`,
   * or if an anchor with that name is already present in the document,
   * `name` will be used as a prefix for a new unique anchor.
   * If `name` is undefined, the generated anchor will use 'a' as a prefix.
   */
  createAlias(node, name) {
    if (!node.anchor) {
      const prev = anchorNames(this);
      node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      !name || prev.has(name) ? findNewAnchor(name || "a", prev) : name;
    }
    return new Alias(node.anchor);
  }
  createNode(value, replacer, options) {
    let _replacer = void 0;
    if (typeof replacer === "function") {
      value = replacer.call({ "": value }, "", value);
      _replacer = replacer;
    } else if (Array.isArray(replacer)) {
      const keyToStr = (v2) => typeof v2 === "number" || v2 instanceof String || v2 instanceof Number;
      const asStr = replacer.filter(keyToStr).map(String);
      if (asStr.length > 0)
        replacer = replacer.concat(asStr);
      _replacer = replacer;
    } else if (options === void 0 && replacer) {
      options = replacer;
      replacer = void 0;
    }
    const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
    const { onAnchor, setAnchors, sourceObjects } = createNodeAnchors(
      this,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      anchorPrefix || "a"
    );
    const ctx = {
      aliasDuplicateObjects: aliasDuplicateObjects ?? true,
      keepUndefined: keepUndefined ?? false,
      onAnchor,
      onTagObj,
      replacer: _replacer,
      schema: this.schema,
      sourceObjects
    };
    const node = createNode(value, tag, ctx);
    if (flow && isCollection(node))
      node.flow = true;
    setAnchors();
    return node;
  }
  /**
   * Convert a key and a value into a `Pair` using the current schema,
   * recursively wrapping all values as `Scalar` or `Collection` nodes.
   */
  createPair(key, value, options = {}) {
    const k2 = this.createNode(key, null, options);
    const v2 = this.createNode(value, null, options);
    return new Pair(k2, v2);
  }
  /**
   * Removes a value from the document.
   * @returns `true` if the item was found and removed.
   */
  delete(key) {
    return assertCollection(this.contents) ? this.contents.delete(key) : false;
  }
  /**
   * Removes a value from the document.
   * @returns `true` if the item was found and removed.
   */
  deleteIn(path) {
    if (isEmptyPath(path)) {
      if (this.contents == null)
        return false;
      this.contents = null;
      return true;
    }
    return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
  }
  /**
   * Returns item at `key`, or `undefined` if not found. By default unwraps
   * scalar values from their surrounding node; to disable set `keepScalar` to
   * `true` (collections are always returned intact).
   */
  get(key, keepScalar) {
    return isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
  }
  /**
   * Returns item at `path`, or `undefined` if not found. By default unwraps
   * scalar values from their surrounding node; to disable set `keepScalar` to
   * `true` (collections are always returned intact).
   */
  getIn(path, keepScalar) {
    if (isEmptyPath(path))
      return !keepScalar && isScalar(this.contents) ? this.contents.value : this.contents;
    return isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
  }
  /**
   * Checks if the document includes a value with the key `key`.
   */
  has(key) {
    return isCollection(this.contents) ? this.contents.has(key) : false;
  }
  /**
   * Checks if the document includes a value at `path`.
   */
  hasIn(path) {
    if (isEmptyPath(path))
      return this.contents !== void 0;
    return isCollection(this.contents) ? this.contents.hasIn(path) : false;
  }
  /**
   * Sets a value in this document. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   */
  set(key, value) {
    if (this.contents == null) {
      this.contents = collectionFromPath(this.schema, [key], value);
    } else if (assertCollection(this.contents)) {
      this.contents.set(key, value);
    }
  }
  /**
   * Sets a value in this document. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   */
  setIn(path, value) {
    if (isEmptyPath(path)) {
      this.contents = value;
    } else if (this.contents == null) {
      this.contents = collectionFromPath(this.schema, Array.from(path), value);
    } else if (assertCollection(this.contents)) {
      this.contents.setIn(path, value);
    }
  }
  /**
   * Change the YAML version and schema used by the document.
   * A `null` version disables support for directives, explicit tags, anchors, and aliases.
   * It also requires the `schema` option to be given as a `Schema` instance value.
   *
   * Overrides all previously set schema options.
   */
  setSchema(version, options = {}) {
    if (typeof version === "number")
      version = String(version);
    let opt;
    switch (version) {
      case "1.1":
        if (this.directives)
          this.directives.yaml.version = "1.1";
        else
          this.directives = new Directives({ version: "1.1" });
        opt = { resolveKnownTags: false, schema: "yaml-1.1" };
        break;
      case "1.2":
      case "next":
        if (this.directives)
          this.directives.yaml.version = version;
        else
          this.directives = new Directives({ version });
        opt = { resolveKnownTags: true, schema: "core" };
        break;
      case null:
        if (this.directives)
          delete this.directives;
        opt = null;
        break;
      default: {
        const sv = JSON.stringify(version);
        throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
      }
    }
    if (options.schema instanceof Object)
      this.schema = options.schema;
    else if (opt)
      this.schema = new Schema(Object.assign(opt, options));
    else
      throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
  }
  // json & jsonArg are only used from toJSON()
  toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
    const ctx = {
      anchors: /* @__PURE__ */ new Map(),
      doc: this,
      keep: !json,
      mapAsMap: mapAsMap === true,
      mapKeyWarned: false,
      maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
    };
    const res = toJS(this.contents, jsonArg ?? "", ctx);
    if (typeof onAnchor === "function")
      for (const { count, res: res2 } of ctx.anchors.values())
        onAnchor(res2, count);
    return typeof reviver === "function" ? applyReviver(reviver, { "": res }, "", res) : res;
  }
  /**
   * A JSON representation of the document `contents`.
   *
   * @param jsonArg Used by `JSON.stringify` to indicate the array index or
   *   property name.
   */
  toJSON(jsonArg, onAnchor) {
    return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
  }
  /** A YAML representation of the document. */
  toString(options = {}) {
    if (this.errors.length > 0)
      throw new Error("Document with errors cannot be stringified");
    if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
      const s4 = JSON.stringify(options.indent);
      throw new Error(`"indent" option must be a positive integer, not ${s4}`);
    }
    return stringifyDocument(this, options);
  }
};
function assertCollection(contents) {
  if (isCollection(contents))
    return true;
  throw new Error("Expected a YAML collection as document contents");
}

// node_modules/yaml/browser/dist/errors.js
var YAMLError = class extends Error {
  constructor(name, pos, code, message) {
    super();
    this.name = name;
    this.code = code;
    this.message = message;
    this.pos = pos;
  }
};
var YAMLParseError = class extends YAMLError {
  constructor(pos, code, message) {
    super("YAMLParseError", pos, code, message);
  }
};
var YAMLWarning = class extends YAMLError {
  constructor(pos, code, message) {
    super("YAMLWarning", pos, code, message);
  }
};
var prettifyError = (src, lc) => (error) => {
  if (error.pos[0] === -1)
    return;
  error.linePos = error.pos.map((pos) => lc.linePos(pos));
  const { line, col } = error.linePos[0];
  error.message += ` at line ${line}, column ${col}`;
  let ci = col - 1;
  let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
  if (ci >= 60 && lineStr.length > 80) {
    const trimStart = Math.min(ci - 39, lineStr.length - 79);
    lineStr = "\u2026" + lineStr.substring(trimStart);
    ci -= trimStart - 1;
  }
  if (lineStr.length > 80)
    lineStr = lineStr.substring(0, 79) + "\u2026";
  if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
    let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
    if (prev.length > 80)
      prev = prev.substring(0, 79) + "\u2026\n";
    lineStr = prev + lineStr;
  }
  if (/[^ ]/.test(lineStr)) {
    let count = 1;
    const end = error.linePos[1];
    if (end?.line === line && end.col > col) {
      count = Math.max(1, Math.min(end.col - col, 80 - ci));
    }
    const pointer = " ".repeat(ci) + "^".repeat(count);
    error.message += `:

${lineStr}
${pointer}
`;
  }
};

// node_modules/yaml/browser/dist/compose/resolve-props.js
function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
  let spaceBefore = false;
  let atNewline = startOnNewline;
  let hasSpace = startOnNewline;
  let comment = "";
  let commentSep = "";
  let hasNewline = false;
  let reqSpace = false;
  let tab = null;
  let anchor = null;
  let tag = null;
  let newlineAfterProp = null;
  let comma = null;
  let found = null;
  let start = null;
  for (const token of tokens) {
    if (reqSpace) {
      if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
        onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      reqSpace = false;
    }
    if (tab) {
      if (atNewline && token.type !== "comment" && token.type !== "newline") {
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      }
      tab = null;
    }
    switch (token.type) {
      case "space":
        if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
          tab = token;
        }
        hasSpace = true;
        break;
      case "comment": {
        if (!hasSpace)
          onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
        const cb = token.source.substring(1) || " ";
        if (!comment)
          comment = cb;
        else
          comment += commentSep + cb;
        commentSep = "";
        atNewline = false;
        break;
      }
      case "newline":
        if (atNewline) {
          if (comment)
            comment += token.source;
          else if (!found || indicator !== "seq-item-ind")
            spaceBefore = true;
        } else
          commentSep += token.source;
        atNewline = true;
        hasNewline = true;
        if (anchor || tag)
          newlineAfterProp = token;
        hasSpace = true;
        break;
      case "anchor":
        if (anchor)
          onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
        if (token.source.endsWith(":"))
          onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
        anchor = token;
        start ?? (start = token.offset);
        atNewline = false;
        hasSpace = false;
        reqSpace = true;
        break;
      case "tag": {
        if (tag)
          onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
        tag = token;
        start ?? (start = token.offset);
        atNewline = false;
        hasSpace = false;
        reqSpace = true;
        break;
      }
      case indicator:
        if (anchor || tag)
          onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
        if (found)
          onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
        found = token;
        atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
        hasSpace = false;
        break;
      case "comma":
        if (flow) {
          if (comma)
            onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
          comma = token;
          atNewline = false;
          hasSpace = false;
          break;
        }
      // else fallthrough
      default:
        onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
        atNewline = false;
        hasSpace = false;
    }
  }
  const last = tokens[tokens.length - 1];
  const end = last ? last.offset + last.source.length : offset;
  if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
    onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
  }
  if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
    onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
  return {
    comma,
    found,
    spaceBefore,
    comment,
    hasNewline,
    anchor,
    tag,
    newlineAfterProp,
    end,
    start: start ?? end
  };
}

// node_modules/yaml/browser/dist/compose/util-contains-newline.js
function containsNewline(key) {
  if (!key)
    return null;
  switch (key.type) {
    case "alias":
    case "scalar":
    case "double-quoted-scalar":
    case "single-quoted-scalar":
      if (key.source.includes("\n"))
        return true;
      if (key.end) {
        for (const st of key.end)
          if (st.type === "newline")
            return true;
      }
      return false;
    case "flow-collection":
      for (const it of key.items) {
        for (const st of it.start)
          if (st.type === "newline")
            return true;
        if (it.sep) {
          for (const st of it.sep)
            if (st.type === "newline")
              return true;
        }
        if (containsNewline(it.key) || containsNewline(it.value))
          return true;
      }
      return false;
    default:
      return true;
  }
}

// node_modules/yaml/browser/dist/compose/util-flow-indent-check.js
function flowIndentCheck(indent, fc, onError) {
  if (fc?.type === "flow-collection") {
    const end = fc.end[0];
    if (end.indent === indent && (end.source === "]" || end.source === "}") && containsNewline(fc)) {
      const msg = "Flow end indicator should be more indented than parent";
      onError(end, "BAD_INDENT", msg, true);
    }
  }
}

// node_modules/yaml/browser/dist/compose/util-map-includes.js
function mapIncludes(ctx, items, search) {
  const { uniqueKeys } = ctx.options;
  if (uniqueKeys === false)
    return false;
  const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a3, b3) => a3 === b3 || isScalar(a3) && isScalar(b3) && a3.value === b3.value;
  return items.some((pair) => isEqual(pair.key, search));
}

// node_modules/yaml/browser/dist/compose/resolve-block-map.js
var startColMsg = "All mapping items must start at the same column";
function resolveBlockMap({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, bm, onError, tag) {
  const NodeClass = tag?.nodeClass ?? YAMLMap;
  const map2 = new NodeClass(ctx.schema);
  if (ctx.atRoot)
    ctx.atRoot = false;
  let offset = bm.offset;
  let commentEnd = null;
  for (const collItem of bm.items) {
    const { start, key, sep, value } = collItem;
    const keyProps = resolveProps(start, {
      indicator: "explicit-key-ind",
      next: key ?? sep?.[0],
      offset,
      onError,
      parentIndent: bm.indent,
      startOnNewline: true
    });
    const implicitKey = !keyProps.found;
    if (implicitKey) {
      if (key) {
        if (key.type === "block-seq")
          onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
        else if ("indent" in key && key.indent !== bm.indent)
          onError(offset, "BAD_INDENT", startColMsg);
      }
      if (!keyProps.anchor && !keyProps.tag && !sep) {
        commentEnd = keyProps.end;
        if (keyProps.comment) {
          if (map2.comment)
            map2.comment += "\n" + keyProps.comment;
          else
            map2.comment = keyProps.comment;
        }
        continue;
      }
      if (keyProps.newlineAfterProp || containsNewline(key)) {
        onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
      }
    } else if (keyProps.found?.indent !== bm.indent) {
      onError(offset, "BAD_INDENT", startColMsg);
    }
    ctx.atKey = true;
    const keyStart = keyProps.end;
    const keyNode = key ? composeNode2(ctx, key, keyProps, onError) : composeEmptyNode2(ctx, keyStart, start, null, keyProps, onError);
    if (ctx.schema.compat)
      flowIndentCheck(bm.indent, key, onError);
    ctx.atKey = false;
    if (mapIncludes(ctx, map2.items, keyNode))
      onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
    const valueProps = resolveProps(sep ?? [], {
      indicator: "map-value-ind",
      next: value,
      offset: keyNode.range[2],
      onError,
      parentIndent: bm.indent,
      startOnNewline: !key || key.type === "block-scalar"
    });
    offset = valueProps.end;
    if (valueProps.found) {
      if (implicitKey) {
        if (value?.type === "block-map" && !valueProps.hasNewline)
          onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
        if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
          onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
      }
      const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : composeEmptyNode2(ctx, offset, sep, null, valueProps, onError);
      if (ctx.schema.compat)
        flowIndentCheck(bm.indent, value, onError);
      offset = valueNode.range[2];
      const pair = new Pair(keyNode, valueNode);
      if (ctx.options.keepSourceTokens)
        pair.srcToken = collItem;
      map2.items.push(pair);
    } else {
      if (implicitKey)
        onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
      if (valueProps.comment) {
        if (keyNode.comment)
          keyNode.comment += "\n" + valueProps.comment;
        else
          keyNode.comment = valueProps.comment;
      }
      const pair = new Pair(keyNode);
      if (ctx.options.keepSourceTokens)
        pair.srcToken = collItem;
      map2.items.push(pair);
    }
  }
  if (commentEnd && commentEnd < offset)
    onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
  map2.range = [bm.offset, offset, commentEnd ?? offset];
  return map2;
}

// node_modules/yaml/browser/dist/compose/resolve-block-seq.js
function resolveBlockSeq({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, bs, onError, tag) {
  const NodeClass = tag?.nodeClass ?? YAMLSeq;
  const seq2 = new NodeClass(ctx.schema);
  if (ctx.atRoot)
    ctx.atRoot = false;
  if (ctx.atKey)
    ctx.atKey = false;
  let offset = bs.offset;
  let commentEnd = null;
  for (const { start, value } of bs.items) {
    const props = resolveProps(start, {
      indicator: "seq-item-ind",
      next: value,
      offset,
      onError,
      parentIndent: bs.indent,
      startOnNewline: true
    });
    if (!props.found) {
      if (props.anchor || props.tag || value) {
        if (value?.type === "block-seq")
          onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
        else
          onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
      } else {
        commentEnd = props.end;
        if (props.comment)
          seq2.comment = props.comment;
        continue;
      }
    }
    const node = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode2(ctx, props.end, start, null, props, onError);
    if (ctx.schema.compat)
      flowIndentCheck(bs.indent, value, onError);
    offset = node.range[2];
    seq2.items.push(node);
  }
  seq2.range = [bs.offset, offset, commentEnd ?? offset];
  return seq2;
}

// node_modules/yaml/browser/dist/compose/resolve-end.js
function resolveEnd(end, offset, reqSpace, onError) {
  let comment = "";
  if (end) {
    let hasSpace = false;
    let sep = "";
    for (const token of end) {
      const { source, type } = token;
      switch (type) {
        case "space":
          hasSpace = true;
          break;
        case "comment": {
          if (reqSpace && !hasSpace)
            onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
          const cb = source.substring(1) || " ";
          if (!comment)
            comment = cb;
          else
            comment += sep + cb;
          sep = "";
          break;
        }
        case "newline":
          if (comment)
            sep += source;
          hasSpace = true;
          break;
        default:
          onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
      }
      offset += source.length;
    }
  }
  return { comment, offset };
}

// node_modules/yaml/browser/dist/compose/resolve-flow-collection.js
var blockMsg = "Block collections are not allowed within flow collections";
var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
function resolveFlowCollection({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, fc, onError, tag) {
  const isMap2 = fc.start.source === "{";
  const fcName = isMap2 ? "flow map" : "flow sequence";
  const NodeClass = tag?.nodeClass ?? (isMap2 ? YAMLMap : YAMLSeq);
  const coll = new NodeClass(ctx.schema);
  coll.flow = true;
  const atRoot = ctx.atRoot;
  if (atRoot)
    ctx.atRoot = false;
  if (ctx.atKey)
    ctx.atKey = false;
  let offset = fc.offset + fc.start.source.length;
  for (let i5 = 0; i5 < fc.items.length; ++i5) {
    const collItem = fc.items[i5];
    const { start, key, sep, value } = collItem;
    const props = resolveProps(start, {
      flow: fcName,
      indicator: "explicit-key-ind",
      next: key ?? sep?.[0],
      offset,
      onError,
      parentIndent: fc.indent,
      startOnNewline: false
    });
    if (!props.found) {
      if (!props.anchor && !props.tag && !sep && !value) {
        if (i5 === 0 && props.comma)
          onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        else if (i5 < fc.items.length - 1)
          onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
        if (props.comment) {
          if (coll.comment)
            coll.comment += "\n" + props.comment;
          else
            coll.comment = props.comment;
        }
        offset = props.end;
        continue;
      }
      if (!isMap2 && ctx.options.strict && containsNewline(key))
        onError(
          key,
          // checked by containsNewline()
          "MULTILINE_IMPLICIT_KEY",
          "Implicit keys of flow sequence pairs need to be on a single line"
        );
    }
    if (i5 === 0) {
      if (props.comma)
        onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
    } else {
      if (!props.comma)
        onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
      if (props.comment) {
        let prevItemComment = "";
        loop: for (const st of start) {
          switch (st.type) {
            case "comma":
            case "space":
              break;
            case "comment":
              prevItemComment = st.source.substring(1);
              break loop;
            default:
              break loop;
          }
        }
        if (prevItemComment) {
          let prev = coll.items[coll.items.length - 1];
          if (isPair(prev))
            prev = prev.value ?? prev.key;
          if (prev.comment)
            prev.comment += "\n" + prevItemComment;
          else
            prev.comment = prevItemComment;
          props.comment = props.comment.substring(prevItemComment.length + 1);
        }
      }
    }
    if (!isMap2 && !sep && !props.found) {
      const valueNode = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode2(ctx, props.end, sep, null, props, onError);
      coll.items.push(valueNode);
      offset = valueNode.range[2];
      if (isBlock(value))
        onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
    } else {
      ctx.atKey = true;
      const keyStart = props.end;
      const keyNode = key ? composeNode2(ctx, key, props, onError) : composeEmptyNode2(ctx, keyStart, start, null, props, onError);
      if (isBlock(key))
        onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
      ctx.atKey = false;
      const valueProps = resolveProps(sep ?? [], {
        flow: fcName,
        indicator: "map-value-ind",
        next: value,
        offset: keyNode.range[2],
        onError,
        parentIndent: fc.indent,
        startOnNewline: false
      });
      if (valueProps.found) {
        if (!isMap2 && !props.found && ctx.options.strict) {
          if (sep)
            for (const st of sep) {
              if (st === valueProps.found)
                break;
              if (st.type === "newline") {
                onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                break;
              }
            }
          if (props.start < valueProps.found.offset - 1024)
            onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
        }
      } else if (value) {
        if ("source" in value && value.source?.[0] === ":")
          onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
        else
          onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
      }
      const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode2(ctx, valueProps.end, sep, null, valueProps, onError) : null;
      if (valueNode) {
        if (isBlock(value))
          onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
      } else if (valueProps.comment) {
        if (keyNode.comment)
          keyNode.comment += "\n" + valueProps.comment;
        else
          keyNode.comment = valueProps.comment;
      }
      const pair = new Pair(keyNode, valueNode);
      if (ctx.options.keepSourceTokens)
        pair.srcToken = collItem;
      if (isMap2) {
        const map2 = coll;
        if (mapIncludes(ctx, map2.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        map2.items.push(pair);
      } else {
        const map2 = new YAMLMap(ctx.schema);
        map2.flow = true;
        map2.items.push(pair);
        const endRange = (valueNode ?? keyNode).range;
        map2.range = [keyNode.range[0], endRange[1], endRange[2]];
        coll.items.push(map2);
      }
      offset = valueNode ? valueNode.range[2] : valueProps.end;
    }
  }
  const expectedEnd = isMap2 ? "}" : "]";
  const [ce, ...ee] = fc.end;
  let cePos = offset;
  if (ce?.source === expectedEnd)
    cePos = ce.offset + ce.source.length;
  else {
    const name = fcName[0].toUpperCase() + fcName.substring(1);
    const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
    onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
    if (ce && ce.source.length !== 1)
      ee.unshift(ce);
  }
  if (ee.length > 0) {
    const end = resolveEnd(ee, cePos, ctx.options.strict, onError);
    if (end.comment) {
      if (coll.comment)
        coll.comment += "\n" + end.comment;
      else
        coll.comment = end.comment;
    }
    coll.range = [fc.offset, cePos, end.offset];
  } else {
    coll.range = [fc.offset, cePos, cePos];
  }
  return coll;
}

// node_modules/yaml/browser/dist/compose/compose-collection.js
function resolveCollection(CN2, ctx, token, onError, tagName, tag) {
  const coll = token.type === "block-map" ? resolveBlockMap(CN2, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq(CN2, ctx, token, onError, tag) : resolveFlowCollection(CN2, ctx, token, onError, tag);
  const Coll = coll.constructor;
  if (tagName === "!" || tagName === Coll.tagName) {
    coll.tag = Coll.tagName;
    return coll;
  }
  if (tagName)
    coll.tag = tagName;
  return coll;
}
function composeCollection(CN2, ctx, token, props, onError) {
  const tagToken = props.tag;
  const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
  if (token.type === "block-seq") {
    const { anchor, newlineAfterProp: nl } = props;
    const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
    if (lastProp && (!nl || nl.offset < lastProp.offset)) {
      const message = "Missing newline after block sequence props";
      onError(lastProp, "MISSING_CHAR", message);
    }
  }
  const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
  if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.tagName && expType === "seq") {
    return resolveCollection(CN2, ctx, token, onError, tagName);
  }
  let tag = ctx.schema.tags.find((t3) => t3.tag === tagName && t3.collection === expType);
  if (!tag) {
    const kt = ctx.schema.knownTags[tagName];
    if (kt?.collection === expType) {
      ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
      tag = kt;
    } else {
      if (kt) {
        onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
      } else {
        onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
      }
      return resolveCollection(CN2, ctx, token, onError, tagName);
    }
  }
  const coll = resolveCollection(CN2, ctx, token, onError, tagName, tag);
  const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
  const node = isNode(res) ? res : new Scalar(res);
  node.range = coll.range;
  node.tag = tagName;
  if (tag?.format)
    node.format = tag.format;
  return node;
}

// node_modules/yaml/browser/dist/compose/resolve-block-scalar.js
function resolveBlockScalar(ctx, scalar, onError) {
  const start = scalar.offset;
  const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
  if (!header)
    return { value: "", type: null, comment: "", range: [start, start, start] };
  const type = header.mode === ">" ? Scalar.BLOCK_FOLDED : Scalar.BLOCK_LITERAL;
  const lines = scalar.source ? splitLines(scalar.source) : [];
  let chompStart = lines.length;
  for (let i5 = lines.length - 1; i5 >= 0; --i5) {
    const content = lines[i5][1];
    if (content === "" || content === "\r")
      chompStart = i5;
    else
      break;
  }
  if (chompStart === 0) {
    const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
    let end2 = start + header.length;
    if (scalar.source)
      end2 += scalar.source.length;
    return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
  }
  let trimIndent = scalar.indent + header.indent;
  let offset = scalar.offset + header.length;
  let contentStart = 0;
  for (let i5 = 0; i5 < chompStart; ++i5) {
    const [indent, content] = lines[i5];
    if (content === "" || content === "\r") {
      if (header.indent === 0 && indent.length > trimIndent)
        trimIndent = indent.length;
    } else {
      if (indent.length < trimIndent) {
        const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
        onError(offset + indent.length, "MISSING_CHAR", message);
      }
      if (header.indent === 0)
        trimIndent = indent.length;
      contentStart = i5;
      if (trimIndent === 0 && !ctx.atRoot) {
        const message = "Block scalar values in collections must be indented";
        onError(offset, "BAD_INDENT", message);
      }
      break;
    }
    offset += indent.length + content.length + 1;
  }
  for (let i5 = lines.length - 1; i5 >= chompStart; --i5) {
    if (lines[i5][0].length > trimIndent)
      chompStart = i5 + 1;
  }
  let value = "";
  let sep = "";
  let prevMoreIndented = false;
  for (let i5 = 0; i5 < contentStart; ++i5)
    value += lines[i5][0].slice(trimIndent) + "\n";
  for (let i5 = contentStart; i5 < chompStart; ++i5) {
    let [indent, content] = lines[i5];
    offset += indent.length + content.length + 1;
    const crlf = content[content.length - 1] === "\r";
    if (crlf)
      content = content.slice(0, -1);
    if (content && indent.length < trimIndent) {
      const src = header.indent ? "explicit indentation indicator" : "first line";
      const message = `Block scalar lines must not be less indented than their ${src}`;
      onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
      indent = "";
    }
    if (type === Scalar.BLOCK_LITERAL) {
      value += sep + indent.slice(trimIndent) + content;
      sep = "\n";
    } else if (indent.length > trimIndent || content[0] === "	") {
      if (sep === " ")
        sep = "\n";
      else if (!prevMoreIndented && sep === "\n")
        sep = "\n\n";
      value += sep + indent.slice(trimIndent) + content;
      sep = "\n";
      prevMoreIndented = true;
    } else if (content === "") {
      if (sep === "\n")
        value += "\n";
      else
        sep = "\n";
    } else {
      value += sep + content;
      sep = " ";
      prevMoreIndented = false;
    }
  }
  switch (header.chomp) {
    case "-":
      break;
    case "+":
      for (let i5 = chompStart; i5 < lines.length; ++i5)
        value += "\n" + lines[i5][0].slice(trimIndent);
      if (value[value.length - 1] !== "\n")
        value += "\n";
      break;
    default:
      value += "\n";
  }
  const end = start + header.length + scalar.source.length;
  return { value, type, comment: header.comment, range: [start, end, end] };
}
function parseBlockScalarHeader({ offset, props }, strict, onError) {
  if (props[0].type !== "block-scalar-header") {
    onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
    return null;
  }
  const { source } = props[0];
  const mode = source[0];
  let indent = 0;
  let chomp = "";
  let error = -1;
  for (let i5 = 1; i5 < source.length; ++i5) {
    const ch = source[i5];
    if (!chomp && (ch === "-" || ch === "+"))
      chomp = ch;
    else {
      const n4 = Number(ch);
      if (!indent && n4)
        indent = n4;
      else if (error === -1)
        error = offset + i5;
    }
  }
  if (error !== -1)
    onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
  let hasSpace = false;
  let comment = "";
  let length = source.length;
  for (let i5 = 1; i5 < props.length; ++i5) {
    const token = props[i5];
    switch (token.type) {
      case "space":
        hasSpace = true;
      // fallthrough
      case "newline":
        length += token.source.length;
        break;
      case "comment":
        if (strict && !hasSpace) {
          const message = "Comments must be separated from other tokens by white space characters";
          onError(token, "MISSING_CHAR", message);
        }
        length += token.source.length;
        comment = token.source.substring(1);
        break;
      case "error":
        onError(token, "UNEXPECTED_TOKEN", token.message);
        length += token.source.length;
        break;
      /* istanbul ignore next should not happen */
      default: {
        const message = `Unexpected token in block scalar header: ${token.type}`;
        onError(token, "UNEXPECTED_TOKEN", message);
        const ts = token.source;
        if (ts && typeof ts === "string")
          length += ts.length;
      }
    }
  }
  return { mode, indent, chomp, comment, length };
}
function splitLines(source) {
  const split = source.split(/\n( *)/);
  const first = split[0];
  const m2 = first.match(/^( *)/);
  const line0 = m2?.[1] ? [m2[1], first.slice(m2[1].length)] : ["", first];
  const lines = [line0];
  for (let i5 = 1; i5 < split.length; i5 += 2)
    lines.push([split[i5], split[i5 + 1]]);
  return lines;
}

// node_modules/yaml/browser/dist/compose/resolve-flow-scalar.js
function resolveFlowScalar(scalar, strict, onError) {
  const { offset, type, source, end } = scalar;
  let _type;
  let value;
  const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
  switch (type) {
    case "scalar":
      _type = Scalar.PLAIN;
      value = plainValue(source, _onError);
      break;
    case "single-quoted-scalar":
      _type = Scalar.QUOTE_SINGLE;
      value = singleQuotedValue(source, _onError);
      break;
    case "double-quoted-scalar":
      _type = Scalar.QUOTE_DOUBLE;
      value = doubleQuotedValue(source, _onError);
      break;
    /* istanbul ignore next should not happen */
    default:
      onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
      return {
        value: "",
        type: null,
        comment: "",
        range: [offset, offset + source.length, offset + source.length]
      };
  }
  const valueEnd = offset + source.length;
  const re = resolveEnd(end, valueEnd, strict, onError);
  return {
    value,
    type: _type,
    comment: re.comment,
    range: [offset, valueEnd, re.offset]
  };
}
function plainValue(source, onError) {
  let badChar = "";
  switch (source[0]) {
    /* istanbul ignore next should not happen */
    case "	":
      badChar = "a tab character";
      break;
    case ",":
      badChar = "flow indicator character ,";
      break;
    case "%":
      badChar = "directive indicator character %";
      break;
    case "|":
    case ">": {
      badChar = `block scalar indicator ${source[0]}`;
      break;
    }
    case "@":
    case "`": {
      badChar = `reserved character ${source[0]}`;
      break;
    }
  }
  if (badChar)
    onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
  return unfoldLines(source);
}
function singleQuotedValue(source, onError) {
  if (source[source.length - 1] !== "'" || source.length === 1)
    onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
  return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
}
function unfoldLines(source) {
  const line = /(.*?)\r?\n/sy;
  let match = line.exec(source);
  if (!match)
    return source;
  let trimEnd, trimBoth;
  try {
    trimEnd = new RegExp("(?<![ 	])[ 	]+$");
    trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
  } catch {
    trimEnd = /[ \t]+$/;
    trimBoth = /^[ \t]+|[ \t]+$/g;
  }
  let res = match[1].replace(trimEnd, "");
  let sep = " ";
  let pos = line.lastIndex;
  while (match = line.exec(source)) {
    const lm = match[1].replace(trimBoth, "");
    if (lm === "") {
      if (sep === "\n")
        res += sep;
      else
        sep = "\n";
    } else {
      res += sep + lm;
      sep = " ";
    }
    pos = line.lastIndex;
  }
  const last = /[ \t]*(.*)/sy;
  last.lastIndex = pos;
  match = last.exec(source);
  return res + sep + (match?.[1] ?? "");
}
function doubleQuotedValue(source, onError) {
  let res = "";
  for (let i5 = 1; i5 < source.length - 1; ++i5) {
    const ch = source[i5];
    if (ch === "\r" && source[i5 + 1] === "\n")
      continue;
    if (ch === "\n") {
      const { fold, offset } = foldNewline(source, i5);
      res += fold;
      i5 = offset;
    } else if (ch === "\\") {
      let next = source[++i5];
      const cc = escapeCodes[next];
      if (cc)
        res += cc;
      else if (next === "\n") {
        next = source[i5 + 1];
        while (next === " " || next === "	")
          next = source[++i5 + 1];
      } else if (next === "\r" && source[i5 + 1] === "\n") {
        next = source[++i5 + 1];
        while (next === " " || next === "	")
          next = source[++i5 + 1];
      } else if (next === "x" || next === "u" || next === "U") {
        const length = next === "x" ? 2 : next === "u" ? 4 : 8;
        res += parseCharCode(source, i5 + 1, length, onError);
        i5 += length;
      } else {
        const raw = source.substr(i5 - 1, 2);
        onError(i5 - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        res += raw;
      }
    } else if (ch === " " || ch === "	") {
      const wsStart = i5;
      let next = source[i5 + 1];
      while (next === " " || next === "	")
        next = source[++i5 + 1];
      if (next !== "\n" && !(next === "\r" && source[i5 + 2] === "\n"))
        res += i5 > wsStart ? source.slice(wsStart, i5 + 1) : ch;
    } else {
      res += ch;
    }
  }
  if (source[source.length - 1] !== '"' || source.length === 1)
    onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
  return res;
}
function foldNewline(source, offset) {
  let fold = "";
  let ch = source[offset + 1];
  while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
    if (ch === "\r" && source[offset + 2] !== "\n")
      break;
    if (ch === "\n")
      fold += "\n";
    offset += 1;
    ch = source[offset + 1];
  }
  if (!fold)
    fold = " ";
  return { fold, offset };
}
var escapeCodes = {
  "0": "\0",
  // null character
  a: "\x07",
  // bell character
  b: "\b",
  // backspace
  e: "\x1B",
  // escape character
  f: "\f",
  // form feed
  n: "\n",
  // line feed
  r: "\r",
  // carriage return
  t: "	",
  // horizontal tab
  v: "\v",
  // vertical tab
  N: "\x85",
  // Unicode next line
  _: "\xA0",
  // Unicode non-breaking space
  L: "\u2028",
  // Unicode line separator
  P: "\u2029",
  // Unicode paragraph separator
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  "	": "	"
};
function parseCharCode(source, offset, length, onError) {
  const cc = source.substr(offset, length);
  const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
  const code = ok ? parseInt(cc, 16) : NaN;
  try {
    return String.fromCodePoint(code);
  } catch {
    const raw = source.substr(offset - 2, length + 2);
    onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
    return raw;
  }
}

// node_modules/yaml/browser/dist/compose/compose-scalar.js
function composeScalar(ctx, token, tagToken, onError) {
  const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar(ctx, token, onError) : resolveFlowScalar(token, ctx.options.strict, onError);
  const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
  let tag;
  if (ctx.options.stringKeys && ctx.atKey) {
    tag = ctx.schema[SCALAR];
  } else if (tagName)
    tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
  else if (token.type === "scalar")
    tag = findScalarTagByTest(ctx, value, token, onError);
  else
    tag = ctx.schema[SCALAR];
  let scalar;
  try {
    const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
    scalar = isScalar(res) ? res : new Scalar(res);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
    scalar = new Scalar(value);
  }
  scalar.range = range;
  scalar.source = value;
  if (type)
    scalar.type = type;
  if (tagName)
    scalar.tag = tagName;
  if (tag.format)
    scalar.format = tag.format;
  if (comment)
    scalar.comment = comment;
  return scalar;
}
function findScalarTagByName(schema4, value, tagName, tagToken, onError) {
  if (tagName === "!")
    return schema4[SCALAR];
  const matchWithTest = [];
  for (const tag of schema4.tags) {
    if (!tag.collection && tag.tag === tagName) {
      if (tag.default && tag.test)
        matchWithTest.push(tag);
      else
        return tag;
    }
  }
  for (const tag of matchWithTest)
    if (tag.test?.test(value))
      return tag;
  const kt = schema4.knownTags[tagName];
  if (kt && !kt.collection) {
    schema4.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
    return kt;
  }
  onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
  return schema4[SCALAR];
}
function findScalarTagByTest({ atKey, directives, schema: schema4 }, value, token, onError) {
  const tag = schema4.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema4[SCALAR];
  if (schema4.compat) {
    const compat = schema4.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema4[SCALAR];
    if (tag.tag !== compat.tag) {
      const ts = directives.tagString(tag.tag);
      const cs = directives.tagString(compat.tag);
      const msg = `Value may be parsed as either ${ts} or ${cs}`;
      onError(token, "TAG_RESOLVE_FAILED", msg, true);
    }
  }
  return tag;
}

// node_modules/yaml/browser/dist/compose/util-empty-scalar-position.js
function emptyScalarPosition(offset, before, pos) {
  if (before) {
    pos ?? (pos = before.length);
    for (let i5 = pos - 1; i5 >= 0; --i5) {
      let st = before[i5];
      switch (st.type) {
        case "space":
        case "comment":
        case "newline":
          offset -= st.source.length;
          continue;
      }
      st = before[++i5];
      while (st?.type === "space") {
        offset += st.source.length;
        st = before[++i5];
      }
      break;
    }
  }
  return offset;
}

// node_modules/yaml/browser/dist/compose/compose-node.js
var CN = { composeNode, composeEmptyNode };
function composeNode(ctx, token, props, onError) {
  const atKey = ctx.atKey;
  const { spaceBefore, comment, anchor, tag } = props;
  let node;
  let isSrcToken = true;
  switch (token.type) {
    case "alias":
      node = composeAlias(ctx, token, onError);
      if (anchor || tag)
        onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
      break;
    case "scalar":
    case "single-quoted-scalar":
    case "double-quoted-scalar":
    case "block-scalar":
      node = composeScalar(ctx, token, tag, onError);
      if (anchor)
        node.anchor = anchor.source.substring(1);
      break;
    case "block-map":
    case "block-seq":
    case "flow-collection":
      try {
        node = composeCollection(CN, ctx, token, props, onError);
        if (anchor)
          node.anchor = anchor.source.substring(1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onError(token, "RESOURCE_EXHAUSTION", message);
      }
      break;
    default: {
      const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
      onError(token, "UNEXPECTED_TOKEN", message);
      isSrcToken = false;
    }
  }
  node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
  if (anchor && node.anchor === "")
    onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
  if (atKey && ctx.options.stringKeys && (!isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
    const msg = "With stringKeys, all keys must be strings";
    onError(tag ?? token, "NON_STRING_KEY", msg);
  }
  if (spaceBefore)
    node.spaceBefore = true;
  if (comment) {
    if (token.type === "scalar" && token.source === "")
      node.comment = comment;
    else
      node.commentBefore = comment;
  }
  if (ctx.options.keepSourceTokens && isSrcToken)
    node.srcToken = token;
  return node;
}
function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
  const token = {
    type: "scalar",
    offset: emptyScalarPosition(offset, before, pos),
    indent: -1,
    source: ""
  };
  const node = composeScalar(ctx, token, tag, onError);
  if (anchor) {
    node.anchor = anchor.source.substring(1);
    if (node.anchor === "")
      onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
  }
  if (spaceBefore)
    node.spaceBefore = true;
  if (comment) {
    node.comment = comment;
    node.range[2] = end;
  }
  return node;
}
function composeAlias({ options }, { offset, source, end }, onError) {
  const alias = new Alias(source.substring(1));
  if (alias.source === "")
    onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
  if (alias.source.endsWith(":"))
    onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
  const valueEnd = offset + source.length;
  const re = resolveEnd(end, valueEnd, options.strict, onError);
  alias.range = [offset, valueEnd, re.offset];
  if (re.comment)
    alias.comment = re.comment;
  return alias;
}

// node_modules/yaml/browser/dist/compose/compose-doc.js
function composeDoc(options, directives, { offset, start, value, end }, onError) {
  const opts = Object.assign({ _directives: directives }, options);
  const doc = new Document2(void 0, opts);
  const ctx = {
    atKey: false,
    atRoot: true,
    directives: doc.directives,
    options: doc.options,
    schema: doc.schema
  };
  const props = resolveProps(start, {
    indicator: "doc-start",
    next: value ?? end?.[0],
    offset,
    onError,
    parentIndent: 0,
    startOnNewline: true
  });
  if (props.found) {
    doc.directives.docStart = true;
    if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
      onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
  }
  doc.contents = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
  const contentEnd = doc.contents.range[2];
  const re = resolveEnd(end, contentEnd, false, onError);
  if (re.comment)
    doc.comment = re.comment;
  doc.range = [offset, contentEnd, re.offset];
  return doc;
}

// node_modules/yaml/browser/dist/compose/composer.js
function getErrorPos(src) {
  if (typeof src === "number")
    return [src, src + 1];
  if (Array.isArray(src))
    return src.length === 2 ? src : [src[0], src[1]];
  const { offset, source } = src;
  return [offset, offset + (typeof source === "string" ? source.length : 1)];
}
function parsePrelude(prelude) {
  let comment = "";
  let atComment = false;
  let afterEmptyLine = false;
  for (let i5 = 0; i5 < prelude.length; ++i5) {
    const source = prelude[i5];
    switch (source[0]) {
      case "#":
        comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
        atComment = true;
        afterEmptyLine = false;
        break;
      case "%":
        if (prelude[i5 + 1]?.[0] !== "#")
          i5 += 1;
        atComment = false;
        break;
      default:
        if (!atComment)
          afterEmptyLine = true;
        atComment = false;
    }
  }
  return { comment, afterEmptyLine };
}
var Composer = class {
  constructor(options = {}) {
    this.doc = null;
    this.atDirectives = false;
    this.prelude = [];
    this.errors = [];
    this.warnings = [];
    this.onError = (source, code, message, warning) => {
      const pos = getErrorPos(source);
      if (warning)
        this.warnings.push(new YAMLWarning(pos, code, message));
      else
        this.errors.push(new YAMLParseError(pos, code, message));
    };
    this.directives = new Directives({ version: options.version || "1.2" });
    this.options = options;
  }
  decorate(doc, afterDoc) {
    const { comment, afterEmptyLine } = parsePrelude(this.prelude);
    if (comment) {
      const dc = doc.contents;
      if (afterDoc) {
        doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
      } else if (afterEmptyLine || doc.directives.docStart || !dc) {
        doc.commentBefore = comment;
      } else if (isCollection(dc) && !dc.flow && dc.items.length > 0) {
        let it = dc.items[0];
        if (isPair(it))
          it = it.key;
        const cb = it.commentBefore;
        it.commentBefore = cb ? `${comment}
${cb}` : comment;
      } else {
        const cb = dc.commentBefore;
        dc.commentBefore = cb ? `${comment}
${cb}` : comment;
      }
    }
    if (afterDoc) {
      for (let i5 = 0; i5 < this.errors.length; ++i5)
        doc.errors.push(this.errors[i5]);
      for (let i5 = 0; i5 < this.warnings.length; ++i5)
        doc.warnings.push(this.warnings[i5]);
    } else {
      doc.errors = this.errors;
      doc.warnings = this.warnings;
    }
    this.prelude = [];
    this.errors = [];
    this.warnings = [];
  }
  /**
   * Current stream status information.
   *
   * Mostly useful at the end of input for an empty stream.
   */
  streamInfo() {
    return {
      comment: parsePrelude(this.prelude).comment,
      directives: this.directives,
      errors: this.errors,
      warnings: this.warnings
    };
  }
  /**
   * Compose tokens into documents.
   *
   * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
   * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
   */
  *compose(tokens, forceDoc = false, endOffset = -1) {
    for (const token of tokens)
      yield* this.next(token);
    yield* this.end(forceDoc, endOffset);
  }
  /** Advance the composer by one CST token. */
  *next(token) {
    switch (token.type) {
      case "directive":
        this.directives.add(token.source, (offset, message, warning) => {
          const pos = getErrorPos(token);
          pos[0] += offset;
          this.onError(pos, "BAD_DIRECTIVE", message, warning);
        });
        this.prelude.push(token.source);
        this.atDirectives = true;
        break;
      case "document": {
        const doc = composeDoc(this.options, this.directives, token, this.onError);
        if (this.atDirectives && !doc.directives.docStart)
          this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
        this.decorate(doc, false);
        if (this.doc)
          yield this.doc;
        this.doc = doc;
        this.atDirectives = false;
        break;
      }
      case "byte-order-mark":
      case "space":
        break;
      case "comment":
      case "newline":
        this.prelude.push(token.source);
        break;
      case "error": {
        const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
        const error = new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
        if (this.atDirectives || !this.doc)
          this.errors.push(error);
        else
          this.doc.errors.push(error);
        break;
      }
      case "doc-end": {
        if (!this.doc) {
          const msg = "Unexpected doc-end without preceding document";
          this.errors.push(new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
          break;
        }
        this.doc.directives.docEnd = true;
        const end = resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
        this.decorate(this.doc, true);
        if (end.comment) {
          const dc = this.doc.comment;
          this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
        }
        this.doc.range[2] = end.offset;
        break;
      }
      default:
        this.errors.push(new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
    }
  }
  /**
   * Call at end of input to yield any remaining document.
   *
   * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
   * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
   */
  *end(forceDoc = false, endOffset = -1) {
    if (this.doc) {
      this.decorate(this.doc, true);
      yield this.doc;
      this.doc = null;
    } else if (forceDoc) {
      const opts = Object.assign({ _directives: this.directives }, this.options);
      const doc = new Document2(void 0, opts);
      if (this.atDirectives)
        this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
      doc.range = [0, endOffset, endOffset];
      this.decorate(doc, false);
      yield doc;
    }
  }
};

// node_modules/yaml/browser/dist/parse/cst-visit.js
var BREAK2 = /* @__PURE__ */ Symbol("break visit");
var SKIP2 = /* @__PURE__ */ Symbol("skip children");
var REMOVE2 = /* @__PURE__ */ Symbol("remove item");
function visit2(cst, visitor) {
  if ("type" in cst && cst.type === "document")
    cst = { start: cst.start, value: cst.value };
  _visit(Object.freeze([]), cst, visitor);
}
visit2.BREAK = BREAK2;
visit2.SKIP = SKIP2;
visit2.REMOVE = REMOVE2;
visit2.itemAtPath = (cst, path) => {
  let item = cst;
  for (const [field2, index] of path) {
    const tok = item?.[field2];
    if (tok && "items" in tok) {
      item = tok.items[index];
    } else
      return void 0;
  }
  return item;
};
visit2.parentCollection = (cst, path) => {
  const parent = visit2.itemAtPath(cst, path.slice(0, -1));
  const field2 = path[path.length - 1][0];
  const coll = parent?.[field2];
  if (coll && "items" in coll)
    return coll;
  throw new Error("Parent collection not found");
};
function _visit(path, item, visitor) {
  let ctrl = visitor(item, path);
  if (typeof ctrl === "symbol")
    return ctrl;
  for (const field2 of ["key", "value"]) {
    const token = item[field2];
    if (token && "items" in token) {
      for (let i5 = 0; i5 < token.items.length; ++i5) {
        const ci = _visit(Object.freeze(path.concat([[field2, i5]])), token.items[i5], visitor);
        if (typeof ci === "number")
          i5 = ci - 1;
        else if (ci === BREAK2)
          return BREAK2;
        else if (ci === REMOVE2) {
          token.items.splice(i5, 1);
          i5 -= 1;
        }
      }
      if (typeof ctrl === "function" && field2 === "key")
        ctrl = ctrl(item, path);
    }
  }
  return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
}

// node_modules/yaml/browser/dist/parse/cst.js
var BOM = "\uFEFF";
var DOCUMENT = "";
var FLOW_END = "";
var SCALAR2 = "";
function tokenType(source) {
  switch (source) {
    case BOM:
      return "byte-order-mark";
    case DOCUMENT:
      return "doc-mode";
    case FLOW_END:
      return "flow-error-end";
    case SCALAR2:
      return "scalar";
    case "---":
      return "doc-start";
    case "...":
      return "doc-end";
    case "":
    case "\n":
    case "\r\n":
      return "newline";
    case "-":
      return "seq-item-ind";
    case "?":
      return "explicit-key-ind";
    case ":":
      return "map-value-ind";
    case "{":
      return "flow-map-start";
    case "}":
      return "flow-map-end";
    case "[":
      return "flow-seq-start";
    case "]":
      return "flow-seq-end";
    case ",":
      return "comma";
  }
  switch (source[0]) {
    case " ":
    case "	":
      return "space";
    case "#":
      return "comment";
    case "%":
      return "directive-line";
    case "*":
      return "alias";
    case "&":
      return "anchor";
    case "!":
      return "tag";
    case "'":
      return "single-quoted-scalar";
    case '"':
      return "double-quoted-scalar";
    case "|":
    case ">":
      return "block-scalar-header";
  }
  return null;
}

// node_modules/yaml/browser/dist/parse/lexer.js
function isEmpty(ch) {
  switch (ch) {
    case void 0:
    case " ":
    case "\n":
    case "\r":
    case "	":
      return true;
    default:
      return false;
  }
}
var hexDigits = new Set("0123456789ABCDEFabcdef");
var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
var flowIndicatorChars = new Set(",[]{}");
var invalidAnchorChars = new Set(" ,[]{}\n\r	");
var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
var Lexer = class {
  constructor() {
    this.atEnd = false;
    this.blockScalarIndent = -1;
    this.blockScalarKeep = false;
    this.buffer = "";
    this.flowKey = false;
    this.flowLevel = 0;
    this.indentNext = 0;
    this.indentValue = 0;
    this.lineEndPos = null;
    this.next = null;
    this.pos = 0;
  }
  /**
   * Generate YAML tokens from the `source` string. If `incomplete`,
   * a part of the last line may be left as a buffer for the next call.
   *
   * @returns A generator of lexical tokens
   */
  *lex(source, incomplete = false) {
    if (source) {
      if (typeof source !== "string")
        throw TypeError("source is not a string");
      this.buffer = this.buffer ? this.buffer + source : source;
      this.lineEndPos = null;
    }
    this.atEnd = !incomplete;
    let next = this.next ?? "stream";
    while (next && (incomplete || this.hasChars(1)))
      next = yield* this.parseNext(next);
  }
  atLineEnd() {
    let i5 = this.pos;
    let ch = this.buffer[i5];
    while (ch === " " || ch === "	")
      ch = this.buffer[++i5];
    if (!ch || ch === "#" || ch === "\n")
      return true;
    if (ch === "\r")
      return this.buffer[i5 + 1] === "\n";
    return false;
  }
  charAt(n4) {
    return this.buffer[this.pos + n4];
  }
  continueScalar(offset) {
    let ch = this.buffer[offset];
    if (this.indentNext > 0) {
      let indent = 0;
      while (ch === " ")
        ch = this.buffer[++indent + offset];
      if (ch === "\r") {
        const next = this.buffer[indent + offset + 1];
        if (next === "\n" || !next && !this.atEnd)
          return offset + indent + 1;
      }
      return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
    }
    if (ch === "-" || ch === ".") {
      const dt = this.buffer.substr(offset, 3);
      if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
        return -1;
    }
    return offset;
  }
  getLine() {
    let end = this.lineEndPos;
    if (typeof end !== "number" || end !== -1 && end < this.pos) {
      end = this.buffer.indexOf("\n", this.pos);
      this.lineEndPos = end;
    }
    if (end === -1)
      return this.atEnd ? this.buffer.substring(this.pos) : null;
    if (this.buffer[end - 1] === "\r")
      end -= 1;
    return this.buffer.substring(this.pos, end);
  }
  hasChars(n4) {
    return this.pos + n4 <= this.buffer.length;
  }
  setNext(state) {
    this.buffer = this.buffer.substring(this.pos);
    this.pos = 0;
    this.lineEndPos = null;
    this.next = state;
    return null;
  }
  peek(n4) {
    return this.buffer.substr(this.pos, n4);
  }
  *parseNext(next) {
    switch (next) {
      case "stream":
        return yield* this.parseStream();
      case "line-start":
        return yield* this.parseLineStart();
      case "block-start":
        return yield* this.parseBlockStart();
      case "doc":
        return yield* this.parseDocument();
      case "flow":
        return yield* this.parseFlowCollection();
      case "quoted-scalar":
        return yield* this.parseQuotedScalar();
      case "block-scalar":
        return yield* this.parseBlockScalar();
      case "plain-scalar":
        return yield* this.parsePlainScalar();
    }
  }
  *parseStream() {
    let line = this.getLine();
    if (line === null)
      return this.setNext("stream");
    if (line[0] === BOM) {
      yield* this.pushCount(1);
      line = line.substring(1);
    }
    if (line[0] === "%") {
      let dirEnd = line.length;
      let cs = line.indexOf("#");
      while (cs !== -1) {
        const ch = line[cs - 1];
        if (ch === " " || ch === "	") {
          dirEnd = cs - 1;
          break;
        } else {
          cs = line.indexOf("#", cs + 1);
        }
      }
      while (true) {
        const ch = line[dirEnd - 1];
        if (ch === " " || ch === "	")
          dirEnd -= 1;
        else
          break;
      }
      const n4 = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
      yield* this.pushCount(line.length - n4);
      this.pushNewline();
      return "stream";
    }
    if (this.atLineEnd()) {
      const sp = yield* this.pushSpaces(true);
      yield* this.pushCount(line.length - sp);
      yield* this.pushNewline();
      return "stream";
    }
    yield DOCUMENT;
    return yield* this.parseLineStart();
  }
  *parseLineStart() {
    const ch = this.charAt(0);
    if (!ch && !this.atEnd)
      return this.setNext("line-start");
    if (ch === "-" || ch === ".") {
      if (!this.atEnd && !this.hasChars(4))
        return this.setNext("line-start");
      const s4 = this.peek(3);
      if ((s4 === "---" || s4 === "...") && isEmpty(this.charAt(3))) {
        yield* this.pushCount(3);
        this.indentValue = 0;
        this.indentNext = 0;
        return s4 === "---" ? "doc" : "stream";
      }
    }
    this.indentValue = yield* this.pushSpaces(false);
    if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
      this.indentNext = this.indentValue;
    return yield* this.parseBlockStart();
  }
  *parseBlockStart() {
    const [ch0, ch1] = this.peek(2);
    if (!ch1 && !this.atEnd)
      return this.setNext("block-start");
    if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
      const n4 = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
      this.indentNext = this.indentValue + 1;
      this.indentValue += n4;
      return "block-start";
    }
    return "doc";
  }
  *parseDocument() {
    yield* this.pushSpaces(true);
    const line = this.getLine();
    if (line === null)
      return this.setNext("doc");
    let n4 = yield* this.pushIndicators();
    switch (line[n4]) {
      case "#":
        yield* this.pushCount(line.length - n4);
      // fallthrough
      case void 0:
        yield* this.pushNewline();
        return yield* this.parseLineStart();
      case "{":
      case "[":
        yield* this.pushCount(1);
        this.flowKey = false;
        this.flowLevel = 1;
        return "flow";
      case "}":
      case "]":
        yield* this.pushCount(1);
        return "doc";
      case "*":
        yield* this.pushUntil(isNotAnchorChar);
        return "doc";
      case '"':
      case "'":
        return yield* this.parseQuotedScalar();
      case "|":
      case ">":
        n4 += yield* this.parseBlockScalarHeader();
        n4 += yield* this.pushSpaces(true);
        yield* this.pushCount(line.length - n4);
        yield* this.pushNewline();
        return yield* this.parseBlockScalar();
      default:
        return yield* this.parsePlainScalar();
    }
  }
  *parseFlowCollection() {
    let nl, sp;
    let indent = -1;
    do {
      nl = yield* this.pushNewline();
      if (nl > 0) {
        sp = yield* this.pushSpaces(false);
        this.indentValue = indent = sp;
      } else {
        sp = 0;
      }
      sp += yield* this.pushSpaces(true);
    } while (nl + sp > 0);
    const line = this.getLine();
    if (line === null)
      return this.setNext("flow");
    if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
      const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
      if (!atFlowEndMarker) {
        this.flowLevel = 0;
        yield FLOW_END;
        return yield* this.parseLineStart();
      }
    }
    let n4 = 0;
    while (line[n4] === ",") {
      n4 += yield* this.pushCount(1);
      n4 += yield* this.pushSpaces(true);
      this.flowKey = false;
    }
    n4 += yield* this.pushIndicators();
    switch (line[n4]) {
      case void 0:
        return "flow";
      case "#":
        yield* this.pushCount(line.length - n4);
        return "flow";
      case "{":
      case "[":
        yield* this.pushCount(1);
        this.flowKey = false;
        this.flowLevel += 1;
        return "flow";
      case "}":
      case "]":
        yield* this.pushCount(1);
        this.flowKey = true;
        this.flowLevel -= 1;
        return this.flowLevel ? "flow" : "doc";
      case "*":
        yield* this.pushUntil(isNotAnchorChar);
        return "flow";
      case '"':
      case "'":
        this.flowKey = true;
        return yield* this.parseQuotedScalar();
      case ":": {
        const next = this.charAt(1);
        if (this.flowKey || isEmpty(next) || next === ",") {
          this.flowKey = false;
          yield* this.pushCount(1);
          yield* this.pushSpaces(true);
          return "flow";
        }
      }
      // fallthrough
      default:
        this.flowKey = false;
        return yield* this.parsePlainScalar();
    }
  }
  *parseQuotedScalar() {
    const quote = this.charAt(0);
    let end = this.buffer.indexOf(quote, this.pos + 1);
    if (quote === "'") {
      while (end !== -1 && this.buffer[end + 1] === "'")
        end = this.buffer.indexOf("'", end + 2);
    } else {
      while (end !== -1) {
        let n4 = 0;
        while (this.buffer[end - 1 - n4] === "\\")
          n4 += 1;
        if (n4 % 2 === 0)
          break;
        end = this.buffer.indexOf('"', end + 1);
      }
    }
    const qb = this.buffer.substring(0, end);
    let nl = qb.indexOf("\n", this.pos);
    if (nl !== -1) {
      while (nl !== -1) {
        const cs = this.continueScalar(nl + 1);
        if (cs === -1)
          break;
        nl = qb.indexOf("\n", cs);
      }
      if (nl !== -1) {
        end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
      }
    }
    if (end === -1) {
      if (!this.atEnd)
        return this.setNext("quoted-scalar");
      end = this.buffer.length;
    }
    yield* this.pushToIndex(end + 1, false);
    return this.flowLevel ? "flow" : "doc";
  }
  *parseBlockScalarHeader() {
    this.blockScalarIndent = -1;
    this.blockScalarKeep = false;
    let i5 = this.pos;
    while (true) {
      const ch = this.buffer[++i5];
      if (ch === "+")
        this.blockScalarKeep = true;
      else if (ch > "0" && ch <= "9")
        this.blockScalarIndent = Number(ch) - 1;
      else if (ch !== "-")
        break;
    }
    return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
  }
  *parseBlockScalar() {
    let nl = this.pos - 1;
    let indent = 0;
    let ch;
    loop: for (let i6 = this.pos; ch = this.buffer[i6]; ++i6) {
      switch (ch) {
        case " ":
          indent += 1;
          break;
        case "\n":
          nl = i6;
          indent = 0;
          break;
        case "\r": {
          const next = this.buffer[i6 + 1];
          if (!next && !this.atEnd)
            return this.setNext("block-scalar");
          if (next === "\n")
            break;
        }
        // fallthrough
        default:
          break loop;
      }
    }
    if (!ch && !this.atEnd)
      return this.setNext("block-scalar");
    if (indent >= this.indentNext) {
      if (this.blockScalarIndent === -1)
        this.indentNext = indent;
      else {
        this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
      }
      do {
        const cs = this.continueScalar(nl + 1);
        if (cs === -1)
          break;
        nl = this.buffer.indexOf("\n", cs);
      } while (nl !== -1);
      if (nl === -1) {
        if (!this.atEnd)
          return this.setNext("block-scalar");
        nl = this.buffer.length;
      }
    }
    let i5 = nl + 1;
    ch = this.buffer[i5];
    while (ch === " ")
      ch = this.buffer[++i5];
    if (ch === "	") {
      while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
        ch = this.buffer[++i5];
      nl = i5 - 1;
    } else if (!this.blockScalarKeep) {
      do {
        let i6 = nl - 1;
        let ch2 = this.buffer[i6];
        if (ch2 === "\r")
          ch2 = this.buffer[--i6];
        const lastChar = i6;
        while (ch2 === " ")
          ch2 = this.buffer[--i6];
        if (ch2 === "\n" && i6 >= this.pos && i6 + 1 + indent > lastChar)
          nl = i6;
        else
          break;
      } while (true);
    }
    yield SCALAR2;
    yield* this.pushToIndex(nl + 1, true);
    return yield* this.parseLineStart();
  }
  *parsePlainScalar() {
    const inFlow = this.flowLevel > 0;
    let end = this.pos - 1;
    let i5 = this.pos - 1;
    let ch;
    while (ch = this.buffer[++i5]) {
      if (ch === ":") {
        const next = this.buffer[i5 + 1];
        if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
          break;
        end = i5;
      } else if (isEmpty(ch)) {
        let next = this.buffer[i5 + 1];
        if (ch === "\r") {
          if (next === "\n") {
            i5 += 1;
            ch = "\n";
            next = this.buffer[i5 + 1];
          } else
            end = i5;
        }
        if (next === "#" || inFlow && flowIndicatorChars.has(next))
          break;
        if (ch === "\n") {
          const cs = this.continueScalar(i5 + 1);
          if (cs === -1)
            break;
          i5 = Math.max(i5, cs - 2);
        }
      } else {
        if (inFlow && flowIndicatorChars.has(ch))
          break;
        end = i5;
      }
    }
    if (!ch && !this.atEnd)
      return this.setNext("plain-scalar");
    yield SCALAR2;
    yield* this.pushToIndex(end + 1, true);
    return inFlow ? "flow" : "doc";
  }
  *pushCount(n4) {
    if (n4 > 0) {
      yield this.buffer.substr(this.pos, n4);
      this.pos += n4;
      return n4;
    }
    return 0;
  }
  *pushToIndex(i5, allowEmpty) {
    const s4 = this.buffer.slice(this.pos, i5);
    if (s4) {
      yield s4;
      this.pos += s4.length;
      return s4.length;
    } else if (allowEmpty)
      yield "";
    return 0;
  }
  *pushIndicators() {
    let n4 = 0;
    loop: while (true) {
      switch (this.charAt(0)) {
        case "!":
          n4 += yield* this.pushTag();
          n4 += yield* this.pushSpaces(true);
          continue loop;
        case "&":
          n4 += yield* this.pushUntil(isNotAnchorChar);
          n4 += yield* this.pushSpaces(true);
          continue loop;
        case "-":
        // this is an error
        case "?":
        // this is an error outside flow collections
        case ":": {
          const inFlow = this.flowLevel > 0;
          const ch1 = this.charAt(1);
          if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
            if (!inFlow)
              this.indentNext = this.indentValue + 1;
            else if (this.flowKey)
              this.flowKey = false;
            n4 += yield* this.pushCount(1);
            n4 += yield* this.pushSpaces(true);
            continue loop;
          }
        }
      }
      break loop;
    }
    return n4;
  }
  *pushTag() {
    if (this.charAt(1) === "<") {
      let i5 = this.pos + 2;
      let ch = this.buffer[i5];
      while (!isEmpty(ch) && ch !== ">")
        ch = this.buffer[++i5];
      return yield* this.pushToIndex(ch === ">" ? i5 + 1 : i5, false);
    } else {
      let i5 = this.pos + 1;
      let ch = this.buffer[i5];
      while (ch) {
        if (tagChars.has(ch))
          ch = this.buffer[++i5];
        else if (ch === "%" && hexDigits.has(this.buffer[i5 + 1]) && hexDigits.has(this.buffer[i5 + 2])) {
          ch = this.buffer[i5 += 3];
        } else
          break;
      }
      return yield* this.pushToIndex(i5, false);
    }
  }
  *pushNewline() {
    const ch = this.buffer[this.pos];
    if (ch === "\n")
      return yield* this.pushCount(1);
    else if (ch === "\r" && this.charAt(1) === "\n")
      return yield* this.pushCount(2);
    else
      return 0;
  }
  *pushSpaces(allowTabs) {
    let i5 = this.pos - 1;
    let ch;
    do {
      ch = this.buffer[++i5];
    } while (ch === " " || allowTabs && ch === "	");
    const n4 = i5 - this.pos;
    if (n4 > 0) {
      yield this.buffer.substr(this.pos, n4);
      this.pos = i5;
    }
    return n4;
  }
  *pushUntil(test) {
    let i5 = this.pos;
    let ch = this.buffer[i5];
    while (!test(ch))
      ch = this.buffer[++i5];
    return yield* this.pushToIndex(i5, false);
  }
};

// node_modules/yaml/browser/dist/parse/line-counter.js
var LineCounter = class {
  constructor() {
    this.lineStarts = [];
    this.addNewLine = (offset) => this.lineStarts.push(offset);
    this.linePos = (offset) => {
      let low = 0;
      let high = this.lineStarts.length;
      while (low < high) {
        const mid = low + high >> 1;
        if (this.lineStarts[mid] < offset)
          low = mid + 1;
        else
          high = mid;
      }
      if (this.lineStarts[low] === offset)
        return { line: low + 1, col: 1 };
      if (low === 0)
        return { line: 0, col: offset };
      const start = this.lineStarts[low - 1];
      return { line: low, col: offset - start + 1 };
    };
  }
};

// node_modules/yaml/browser/dist/parse/parser.js
function includesToken(list, type) {
  for (let i5 = 0; i5 < list.length; ++i5)
    if (list[i5].type === type)
      return true;
  return false;
}
function findNonEmptyIndex(list) {
  for (let i5 = 0; i5 < list.length; ++i5) {
    switch (list[i5].type) {
      case "space":
      case "comment":
      case "newline":
        break;
      default:
        return i5;
    }
  }
  return -1;
}
function isFlowToken(token) {
  switch (token?.type) {
    case "alias":
    case "scalar":
    case "single-quoted-scalar":
    case "double-quoted-scalar":
    case "flow-collection":
      return true;
    default:
      return false;
  }
}
function getPrevProps(parent) {
  switch (parent.type) {
    case "document":
      return parent.start;
    case "block-map": {
      const it = parent.items[parent.items.length - 1];
      return it.sep ?? it.start;
    }
    case "block-seq":
      return parent.items[parent.items.length - 1].start;
    /* istanbul ignore next should not happen */
    default:
      return [];
  }
}
function getFirstKeyStartProps(prev) {
  if (prev.length === 0)
    return [];
  let i5 = prev.length;
  loop: while (--i5 >= 0) {
    switch (prev[i5].type) {
      case "doc-start":
      case "explicit-key-ind":
      case "map-value-ind":
      case "seq-item-ind":
      case "newline":
        break loop;
    }
  }
  while (prev[++i5]?.type === "space") {
  }
  return prev.splice(i5, prev.length);
}
function arrayPushArray(target, source) {
  if (source.length < 1e5)
    Array.prototype.push.apply(target, source);
  else
    for (let i5 = 0; i5 < source.length; ++i5)
      target.push(source[i5]);
}
function fixFlowSeqItems(fc) {
  if (fc.start.type === "flow-seq-start") {
    for (const it of fc.items) {
      if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
        if (it.key)
          it.value = it.key;
        delete it.key;
        if (isFlowToken(it.value)) {
          if (it.value.end)
            arrayPushArray(it.value.end, it.sep);
          else
            it.value.end = it.sep;
        } else
          arrayPushArray(it.start, it.sep);
        delete it.sep;
      }
    }
  }
}
var Parser = class {
  /**
   * @param onNewLine - If defined, called separately with the start position of
   *   each new line (in `parse()`, including the start of input).
   */
  constructor(onNewLine) {
    this.atNewLine = true;
    this.atScalar = false;
    this.indent = 0;
    this.offset = 0;
    this.onKeyLine = false;
    this.stack = [];
    this.source = "";
    this.type = "";
    this.lexer = new Lexer();
    this.onNewLine = onNewLine;
  }
  /**
   * Parse `source` as a YAML stream.
   * If `incomplete`, a part of the last line may be left as a buffer for the next call.
   *
   * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
   *
   * @returns A generator of tokens representing each directive, document, and other structure.
   */
  *parse(source, incomplete = false) {
    if (this.onNewLine && this.offset === 0)
      this.onNewLine(0);
    for (const lexeme of this.lexer.lex(source, incomplete))
      yield* this.next(lexeme);
    if (!incomplete)
      yield* this.end();
  }
  /**
   * Advance the parser by the `source` of one lexical token.
   */
  *next(source) {
    this.source = source;
    if (this.atScalar) {
      this.atScalar = false;
      yield* this.step();
      this.offset += source.length;
      return;
    }
    const type = tokenType(source);
    if (!type) {
      const message = `Not a YAML token: ${source}`;
      yield* this.pop({ type: "error", offset: this.offset, message, source });
      this.offset += source.length;
    } else if (type === "scalar") {
      this.atNewLine = false;
      this.atScalar = true;
      this.type = "scalar";
    } else {
      this.type = type;
      yield* this.step();
      switch (type) {
        case "newline":
          this.atNewLine = true;
          this.indent = 0;
          if (this.onNewLine)
            this.onNewLine(this.offset + source.length);
          break;
        case "space":
          if (this.atNewLine && source[0] === " ")
            this.indent += source.length;
          break;
        case "explicit-key-ind":
        case "map-value-ind":
        case "seq-item-ind":
          if (this.atNewLine)
            this.indent += source.length;
          break;
        case "doc-mode":
        case "flow-error-end":
          return;
        default:
          this.atNewLine = false;
      }
      this.offset += source.length;
    }
  }
  /** Call at end of input to push out any remaining constructions */
  *end() {
    while (this.stack.length > 0)
      yield* this.pop();
  }
  get sourceToken() {
    const st = {
      type: this.type,
      offset: this.offset,
      indent: this.indent,
      source: this.source
    };
    return st;
  }
  *step() {
    const top = this.peek(1);
    if (this.type === "doc-end" && top?.type !== "doc-end") {
      while (this.stack.length > 0)
        yield* this.pop();
      this.stack.push({
        type: "doc-end",
        offset: this.offset,
        source: this.source
      });
      return;
    }
    if (!top)
      return yield* this.stream();
    switch (top.type) {
      case "document":
        return yield* this.document(top);
      case "alias":
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
        return yield* this.scalar(top);
      case "block-scalar":
        return yield* this.blockScalar(top);
      case "block-map":
        return yield* this.blockMap(top);
      case "block-seq":
        return yield* this.blockSequence(top);
      case "flow-collection":
        return yield* this.flowCollection(top);
      case "doc-end":
        return yield* this.documentEnd(top);
    }
    yield* this.pop();
  }
  peek(n4) {
    return this.stack[this.stack.length - n4];
  }
  *pop(error) {
    const token = error ?? this.stack.pop();
    if (!token) {
      const message = "Tried to pop an empty stack";
      yield { type: "error", offset: this.offset, source: "", message };
    } else if (this.stack.length === 0) {
      yield token;
    } else {
      const top = this.peek(1);
      if (token.type === "block-scalar") {
        token.indent = "indent" in top ? top.indent : 0;
      } else if (token.type === "flow-collection" && top.type === "document") {
        token.indent = 0;
      }
      if (token.type === "flow-collection")
        fixFlowSeqItems(token);
      switch (top.type) {
        case "document":
          top.value = token;
          break;
        case "block-scalar":
          top.props.push(token);
          break;
        case "block-map": {
          const it = top.items[top.items.length - 1];
          if (it.value) {
            top.items.push({ start: [], key: token, sep: [] });
            this.onKeyLine = true;
            return;
          } else if (it.sep) {
            it.value = token;
          } else {
            Object.assign(it, { key: token, sep: [] });
            this.onKeyLine = !it.explicitKey;
            return;
          }
          break;
        }
        case "block-seq": {
          const it = top.items[top.items.length - 1];
          if (it.value)
            top.items.push({ start: [], value: token });
          else
            it.value = token;
          break;
        }
        case "flow-collection": {
          const it = top.items[top.items.length - 1];
          if (!it || it.value)
            top.items.push({ start: [], key: token, sep: [] });
          else if (it.sep)
            it.value = token;
          else
            Object.assign(it, { key: token, sep: [] });
          return;
        }
        /* istanbul ignore next should not happen */
        default:
          yield* this.pop();
          yield* this.pop(token);
      }
      if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
        const last = token.items[token.items.length - 1];
        if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
          if (top.type === "document")
            top.end = last.start;
          else
            top.items.push({ start: last.start });
          token.items.splice(-1, 1);
        }
      }
    }
  }
  *stream() {
    switch (this.type) {
      case "directive-line":
        yield { type: "directive", offset: this.offset, source: this.source };
        return;
      case "byte-order-mark":
      case "space":
      case "comment":
      case "newline":
        yield this.sourceToken;
        return;
      case "doc-mode":
      case "doc-start": {
        const doc = {
          type: "document",
          offset: this.offset,
          start: []
        };
        if (this.type === "doc-start")
          doc.start.push(this.sourceToken);
        this.stack.push(doc);
        return;
      }
    }
    yield {
      type: "error",
      offset: this.offset,
      message: `Unexpected ${this.type} token in YAML stream`,
      source: this.source
    };
  }
  *document(doc) {
    if (doc.value)
      return yield* this.lineEnd(doc);
    switch (this.type) {
      case "doc-start": {
        if (findNonEmptyIndex(doc.start) !== -1) {
          yield* this.pop();
          yield* this.step();
        } else
          doc.start.push(this.sourceToken);
        return;
      }
      case "anchor":
      case "tag":
      case "space":
      case "comment":
      case "newline":
        doc.start.push(this.sourceToken);
        return;
    }
    const bv = this.startBlockValue(doc);
    if (bv)
      this.stack.push(bv);
    else {
      yield {
        type: "error",
        offset: this.offset,
        message: `Unexpected ${this.type} token in YAML document`,
        source: this.source
      };
    }
  }
  *scalar(scalar) {
    if (this.type === "map-value-ind") {
      const prev = getPrevProps(this.peek(2));
      const start = getFirstKeyStartProps(prev);
      let sep;
      if (scalar.end) {
        sep = scalar.end;
        sep.push(this.sourceToken);
        delete scalar.end;
      } else
        sep = [this.sourceToken];
      const map2 = {
        type: "block-map",
        offset: scalar.offset,
        indent: scalar.indent,
        items: [{ start, key: scalar, sep }]
      };
      this.onKeyLine = true;
      this.stack[this.stack.length - 1] = map2;
    } else
      yield* this.lineEnd(scalar);
  }
  *blockScalar(scalar) {
    switch (this.type) {
      case "space":
      case "comment":
      case "newline":
        scalar.props.push(this.sourceToken);
        return;
      case "scalar":
        scalar.source = this.source;
        this.atNewLine = true;
        this.indent = 0;
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        yield* this.pop();
        break;
      /* istanbul ignore next should not happen */
      default:
        yield* this.pop();
        yield* this.step();
    }
  }
  *blockMap(map2) {
    const it = map2.items[map2.items.length - 1];
    switch (this.type) {
      case "newline":
        this.onKeyLine = false;
        if (it.value) {
          const end = "end" in it.value ? it.value.end : void 0;
          const last = Array.isArray(end) ? end[end.length - 1] : void 0;
          if (last?.type === "comment")
            end?.push(this.sourceToken);
          else
            map2.items.push({ start: [this.sourceToken] });
        } else if (it.sep) {
          it.sep.push(this.sourceToken);
        } else {
          it.start.push(this.sourceToken);
        }
        return;
      case "space":
      case "comment":
        if (it.value) {
          map2.items.push({ start: [this.sourceToken] });
        } else if (it.sep) {
          it.sep.push(this.sourceToken);
        } else {
          if (this.atIndentedComment(it.start, map2.indent)) {
            const prev = map2.items[map2.items.length - 2];
            const end = prev?.value?.end;
            if (Array.isArray(end)) {
              arrayPushArray(end, it.start);
              end.push(this.sourceToken);
              map2.items.pop();
              return;
            }
          }
          it.start.push(this.sourceToken);
        }
        return;
    }
    if (this.indent >= map2.indent) {
      const atMapIndent = !this.onKeyLine && this.indent === map2.indent;
      const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
      let start = [];
      if (atNextItem && it.sep && !it.value) {
        const nl = [];
        for (let i5 = 0; i5 < it.sep.length; ++i5) {
          const st = it.sep[i5];
          switch (st.type) {
            case "newline":
              nl.push(i5);
              break;
            case "space":
              break;
            case "comment":
              if (st.indent > map2.indent)
                nl.length = 0;
              break;
            default:
              nl.length = 0;
          }
        }
        if (nl.length >= 2)
          start = it.sep.splice(nl[1]);
      }
      switch (this.type) {
        case "anchor":
        case "tag":
          if (atNextItem || it.value) {
            start.push(this.sourceToken);
            map2.items.push({ start });
            this.onKeyLine = true;
          } else if (it.sep) {
            it.sep.push(this.sourceToken);
          } else {
            it.start.push(this.sourceToken);
          }
          return;
        case "explicit-key-ind":
          if (!it.sep && !it.explicitKey) {
            it.start.push(this.sourceToken);
            it.explicitKey = true;
          } else if (atNextItem || it.value) {
            start.push(this.sourceToken);
            map2.items.push({ start, explicitKey: true });
          } else {
            this.stack.push({
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken], explicitKey: true }]
            });
          }
          this.onKeyLine = true;
          return;
        case "map-value-ind":
          if (it.explicitKey) {
            if (!it.sep) {
              if (includesToken(it.start, "newline")) {
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              } else {
                const start2 = getFirstKeyStartProps(it.start);
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                });
              }
            } else if (it.value) {
              map2.items.push({ start: [], key: null, sep: [this.sourceToken] });
            } else if (includesToken(it.sep, "map-value-ind")) {
              this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start, key: null, sep: [this.sourceToken] }]
              });
            } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
              const start2 = getFirstKeyStartProps(it.start);
              const key = it.key;
              const sep = it.sep;
              sep.push(this.sourceToken);
              delete it.key;
              delete it.sep;
              this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start: start2, key, sep }]
              });
            } else if (start.length > 0) {
              it.sep = it.sep.concat(start, this.sourceToken);
            } else {
              it.sep.push(this.sourceToken);
            }
          } else {
            if (!it.sep) {
              Object.assign(it, { key: null, sep: [this.sourceToken] });
            } else if (it.value || atNextItem) {
              map2.items.push({ start, key: null, sep: [this.sourceToken] });
            } else if (includesToken(it.sep, "map-value-ind")) {
              this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start: [], key: null, sep: [this.sourceToken] }]
              });
            } else {
              it.sep.push(this.sourceToken);
            }
          }
          this.onKeyLine = true;
          return;
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar": {
          const fs = this.flowScalar(this.type);
          if (atNextItem || it.value) {
            map2.items.push({ start, key: fs, sep: [] });
            this.onKeyLine = true;
          } else if (it.sep) {
            this.stack.push(fs);
          } else {
            Object.assign(it, { key: fs, sep: [] });
            this.onKeyLine = true;
          }
          return;
        }
        default: {
          const bv = this.startBlockValue(map2);
          if (bv) {
            if (bv.type === "block-seq") {
              if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                yield* this.pop({
                  type: "error",
                  offset: this.offset,
                  message: "Unexpected block-seq-ind on same line with key",
                  source: this.source
                });
                return;
              }
            } else if (atMapIndent) {
              map2.items.push({ start });
            }
            this.stack.push(bv);
            return;
          }
        }
      }
    }
    yield* this.pop();
    yield* this.step();
  }
  *blockSequence(seq2) {
    const it = seq2.items[seq2.items.length - 1];
    switch (this.type) {
      case "newline":
        if (it.value) {
          const end = "end" in it.value ? it.value.end : void 0;
          const last = Array.isArray(end) ? end[end.length - 1] : void 0;
          if (last?.type === "comment")
            end?.push(this.sourceToken);
          else
            seq2.items.push({ start: [this.sourceToken] });
        } else
          it.start.push(this.sourceToken);
        return;
      case "space":
      case "comment":
        if (it.value)
          seq2.items.push({ start: [this.sourceToken] });
        else {
          if (this.atIndentedComment(it.start, seq2.indent)) {
            const prev = seq2.items[seq2.items.length - 2];
            const end = prev?.value?.end;
            if (Array.isArray(end)) {
              arrayPushArray(end, it.start);
              end.push(this.sourceToken);
              seq2.items.pop();
              return;
            }
          }
          it.start.push(this.sourceToken);
        }
        return;
      case "anchor":
      case "tag":
        if (it.value || this.indent <= seq2.indent)
          break;
        it.start.push(this.sourceToken);
        return;
      case "seq-item-ind":
        if (this.indent !== seq2.indent)
          break;
        if (it.value || includesToken(it.start, "seq-item-ind"))
          seq2.items.push({ start: [this.sourceToken] });
        else
          it.start.push(this.sourceToken);
        return;
    }
    if (this.indent > seq2.indent) {
      const bv = this.startBlockValue(seq2);
      if (bv) {
        this.stack.push(bv);
        return;
      }
    }
    yield* this.pop();
    yield* this.step();
  }
  *flowCollection(fc) {
    const it = fc.items[fc.items.length - 1];
    if (this.type === "flow-error-end") {
      let top;
      do {
        yield* this.pop();
        top = this.peek(1);
      } while (top?.type === "flow-collection");
    } else if (fc.end.length === 0) {
      switch (this.type) {
        case "comma":
        case "explicit-key-ind":
          if (!it || it.sep)
            fc.items.push({ start: [this.sourceToken] });
          else
            it.start.push(this.sourceToken);
          return;
        case "map-value-ind":
          if (!it || it.value)
            fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
          else if (it.sep)
            it.sep.push(this.sourceToken);
          else
            Object.assign(it, { key: null, sep: [this.sourceToken] });
          return;
        case "space":
        case "comment":
        case "newline":
        case "anchor":
        case "tag":
          if (!it || it.value)
            fc.items.push({ start: [this.sourceToken] });
          else if (it.sep)
            it.sep.push(this.sourceToken);
          else
            it.start.push(this.sourceToken);
          return;
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar": {
          const fs = this.flowScalar(this.type);
          if (!it || it.value)
            fc.items.push({ start: [], key: fs, sep: [] });
          else if (it.sep)
            this.stack.push(fs);
          else
            Object.assign(it, { key: fs, sep: [] });
          return;
        }
        case "flow-map-end":
        case "flow-seq-end":
          fc.end.push(this.sourceToken);
          return;
      }
      const bv = this.startBlockValue(fc);
      if (bv)
        this.stack.push(bv);
      else {
        yield* this.pop();
        yield* this.step();
      }
    } else {
      const parent = this.peek(2);
      if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
        yield* this.pop();
        yield* this.step();
      } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
        const prev = getPrevProps(parent);
        const start = getFirstKeyStartProps(prev);
        fixFlowSeqItems(fc);
        const sep = fc.end.splice(1, fc.end.length);
        sep.push(this.sourceToken);
        const map2 = {
          type: "block-map",
          offset: fc.offset,
          indent: fc.indent,
          items: [{ start, key: fc, sep }]
        };
        this.onKeyLine = true;
        this.stack[this.stack.length - 1] = map2;
      } else {
        yield* this.lineEnd(fc);
      }
    }
  }
  flowScalar(type) {
    if (this.onNewLine) {
      let nl = this.source.indexOf("\n") + 1;
      while (nl !== 0) {
        this.onNewLine(this.offset + nl);
        nl = this.source.indexOf("\n", nl) + 1;
      }
    }
    return {
      type,
      offset: this.offset,
      indent: this.indent,
      source: this.source
    };
  }
  startBlockValue(parent) {
    switch (this.type) {
      case "alias":
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
        return this.flowScalar(this.type);
      case "block-scalar-header":
        return {
          type: "block-scalar",
          offset: this.offset,
          indent: this.indent,
          props: [this.sourceToken],
          source: ""
        };
      case "flow-map-start":
      case "flow-seq-start":
        return {
          type: "flow-collection",
          offset: this.offset,
          indent: this.indent,
          start: this.sourceToken,
          items: [],
          end: []
        };
      case "seq-item-ind":
        return {
          type: "block-seq",
          offset: this.offset,
          indent: this.indent,
          items: [{ start: [this.sourceToken] }]
        };
      case "explicit-key-ind": {
        this.onKeyLine = true;
        const prev = getPrevProps(parent);
        const start = getFirstKeyStartProps(prev);
        start.push(this.sourceToken);
        return {
          type: "block-map",
          offset: this.offset,
          indent: this.indent,
          items: [{ start, explicitKey: true }]
        };
      }
      case "map-value-ind": {
        this.onKeyLine = true;
        const prev = getPrevProps(parent);
        const start = getFirstKeyStartProps(prev);
        return {
          type: "block-map",
          offset: this.offset,
          indent: this.indent,
          items: [{ start, key: null, sep: [this.sourceToken] }]
        };
      }
    }
    return null;
  }
  atIndentedComment(start, indent) {
    if (this.type !== "comment")
      return false;
    if (this.indent <= indent)
      return false;
    return start.every((st) => st.type === "newline" || st.type === "space");
  }
  *documentEnd(docEnd) {
    if (this.type !== "doc-mode") {
      if (docEnd.end)
        docEnd.end.push(this.sourceToken);
      else
        docEnd.end = [this.sourceToken];
      if (this.type === "newline")
        yield* this.pop();
    }
  }
  *lineEnd(token) {
    switch (this.type) {
      case "comma":
      case "doc-start":
      case "doc-end":
      case "flow-seq-end":
      case "flow-map-end":
      case "map-value-ind":
        yield* this.pop();
        yield* this.step();
        break;
      case "newline":
        this.onKeyLine = false;
      // fallthrough
      case "space":
      case "comment":
      default:
        if (token.end)
          token.end.push(this.sourceToken);
        else
          token.end = [this.sourceToken];
        if (this.type === "newline")
          yield* this.pop();
    }
  }
};

// node_modules/yaml/browser/dist/public-api.js
function parseOptions(options) {
  const prettyErrors = options.prettyErrors !== false;
  const lineCounter = options.lineCounter || prettyErrors && new LineCounter() || null;
  return { lineCounter, prettyErrors };
}
function parseDocument(source, options = {}) {
  const { lineCounter, prettyErrors } = parseOptions(options);
  const parser = new Parser(lineCounter?.addNewLine);
  const composer = new Composer(options);
  let doc = null;
  for (const _doc of composer.compose(parser.parse(source), true, source.length)) {
    if (!doc)
      doc = _doc;
    else if (doc.options.logLevel !== "silent") {
      doc.errors.push(new YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
      break;
    }
  }
  if (prettyErrors && lineCounter) {
    doc.errors.forEach(prettifyError(source, lineCounter));
    doc.warnings.forEach(prettifyError(source, lineCounter));
  }
  return doc;
}
function parse(src, reviver, options) {
  let _reviver = void 0;
  if (typeof reviver === "function") {
    _reviver = reviver;
  } else if (options === void 0 && reviver && typeof reviver === "object") {
    options = reviver;
  }
  const doc = parseDocument(src, options);
  if (!doc)
    return null;
  doc.warnings.forEach((warning) => warn(doc.options.logLevel, warning));
  if (doc.errors.length > 0) {
    if (doc.options.logLevel !== "silent")
      throw doc.errors[0];
    else
      doc.errors = [];
  }
  return doc.toJS(Object.assign({ reviver: _reviver }, options));
}
function stringify3(value, replacer, options) {
  let _replacer = null;
  if (typeof replacer === "function" || Array.isArray(replacer)) {
    _replacer = replacer;
  } else if (options === void 0 && replacer) {
    options = replacer;
  }
  if (typeof options === "string")
    options = options.length;
  if (typeof options === "number") {
    const indent = Math.round(options);
    options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
  }
  if (value === void 0) {
    const { keepUndefined } = options ?? replacer ?? {};
    if (!keepUndefined)
      return void 0;
  }
  if (isDocument(value) && !_replacer)
    return value.toString(options);
  return new Document2(value, _replacer, options).toString(options);
}

// frontend/editor/types.ts
var editorSections = [
  { title: "Basic" },
  { title: "When to check" },
  { title: "Condition" },
  { title: "Recipients" },
  { title: "Notification" },
  {
    title: "Post-send actions",
    setting: "postSendActions",
    parent: "Notification",
    status: "postSendActions"
  },
  { title: "Confirmation", setting: "confirmation", status: "confirmation" },
  {
    title: "Reminder policy",
    setting: "confirmationReminder",
    parent: "Confirmation",
    status: "confirmationReminder"
  },
  {
    title: "Notify recipients when confirmed",
    setting: "confirmationNotification",
    parent: "Confirmation",
    status: "confirmationNotification"
  },
  {
    title: "Post-confirmation actions",
    setting: "postConfirmationActions",
    parent: "Confirmation",
    status: "postConfirmationActions"
  }
];
var optionalSections = {
  postSendActions: { index: 5 },
  confirmation: { index: 6 },
  confirmationReminder: { index: 7 },
  confirmationNotification: { index: 8 },
  postConfirmationActions: { index: 9 }
};
var ACTIONS_PLACEHOLDER = `- action: switch.turn_on
  metadata: {}
  target:
    entity_id:
      - switch.garage_door
      - light.living_room
  data: {}`;
var clone = (value) => JSON.parse(JSON.stringify(value));

// frontend/editor/helpers.ts
function editorModeFor(value) {
  if (value.conditions.some(
    (item) => ["state", "numeric", "attribute"].includes(item.type)
  )) {
    return "visual";
  }
  return "jinja";
}
function sectionForSetting(setting) {
  return optionalSections[setting];
}
function isSectionVisible(setting, settings) {
  return !setting || settings[setting];
}
function defaultAlert() {
  return {
    id: `alert_${Date.now()}`,
    name: "",
    enabled: true,
    description: "",
    icon: "mdi:bell-outline",
    conditions: [{ type: "template", template: "" }],
    monitor: { on_change: true, startup: true },
    notification: {
      target: {},
      title: "",
      message: ""
    },
    confirmation: {
      enabled: true,
      button: "",
      notification: { enabled: false, message: "", clear: true },
      reminders: {
        enabled: true,
        interval: "00:30:00",
        max_attempts: 5,
        show_attempts: false
      },
      actions: { enabled: false, items: [] }
    }
  };
}
function conditionTemplate(alert) {
  return alert.conditions.find((condition) => condition.type === "template")?.template || "";
}
function conditionsYaml(conditions) {
  if (conditions.length) {
    return stringify3(conditions);
  }
  return stringify3([]);
}
function actionsYaml(actions) {
  if (actions?.length) {
    return stringify3(actions);
  }
  return "";
}
function parseConditionsYaml(value) {
  const parsed = parse(value || "[]");
  if (!Array.isArray(parsed)) {
    throw new Error("Conditions YAML must be a list.");
  }
  if (!parsed.every((item) => item && typeof item === "object")) {
    throw new Error("Conditions YAML must contain condition objects.");
  }
  return parsed;
}
function valueOf(event) {
  return event.currentTarget.value;
}
function checkedOf(event) {
  return event.currentTarget.checked;
}
function showEditorToast(root, message, duration = 6e3) {
  const toast = document.createElement("div");
  toast.className = "nc-toast";
  toast.textContent = message;
  root.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}
function durationInputValue(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const totalSeconds2 = Math.max(0, Math.floor(value));
    const hours2 = Math.floor(totalSeconds2 / 3600);
    const minutes2 = Math.floor(totalSeconds2 % 3600 / 60);
    const seconds2 = totalSeconds2 % 60;
    return [hours2, minutes2, seconds2].map((part) => String(part).padStart(2, "0")).join(":");
  }
  if (typeof value === "string") {
    const parts = value.split(":");
    if (parts.length === 2) return `${value}:00`;
    return value;
  }
  if (!value || typeof value !== "object") return fallback;
  const totalSeconds = Math.max(
    0,
    Math.floor(
      (Number(value.hours) || 0) * 3600 + (Number(value.minutes) || 0) * 60 + (Number(value.seconds) || 0)
    )
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
function durationInput(value, onChange) {
  const normalize = (raw) => {
    const parts = raw.replace(/[^\d:]/g, "").split(":");
    const seconds = Number(parts.pop() || 0);
    const minutes = Number(parts.pop() || 0);
    const hours = Number(parts.join("") || 0);
    return `${hours}:${String(Math.min(minutes, 59)).padStart(2, "0")}:${String(
      Math.min(seconds, 59)
    ).padStart(2, "0")}`;
  };
  const update = (event) => {
    const input = event.currentTarget;
    onChange(input.value);
  };
  const commit = (event) => {
    const input = event.currentTarget;
    input.value = normalize(input.value);
    onChange(input.value);
  };
  return b2`<input
    class="nc-duration-input"
    type="text"
    inputmode="numeric"
    placeholder="HH:MM:SS"
    aria-label="Duration (HH:MM:SS)"
    .value=${value}
    @input=${update}
    @blur=${commit}
    @change=${commit}
  />`;
}
async function fillActionEditors(host) {
  await customElements.whenDefined("ha-code-editor");
  const editors = Array.from(
    host.querySelectorAll("ha-code-editor.nc-action-editor")
  );
  for (const editor of editors) {
    await editor.updateComplete;
    const codeMirror = editor.codemirror?.dom;
    if (!codeMirror || !editor.isConnected) continue;
    editor.style.height = "280px";
    codeMirror.style.height = "100%";
    const scroller = codeMirror.querySelector(
      ".cm-scroller"
    );
    if (scroller) scroller.style.height = "100%";
  }
}
function field(label, content, full = false) {
  let className = "nc-field";
  if (full) {
    className = "nc-field full";
  }
  return b2`<div class=${className}><label>${label}</label>${content}</div>`;
}
function codeEditor({
  role,
  value,
  placeholder = "",
  mode,
  language,
  label,
  className = "nc-action-editor",
  readOnly = false,
  onInput
}) {
  return b2`<ha-code-editor
    data-role=${role || A}
    .value=${value}
    placeholder=${placeholder || A}
    class=${`nc-code-editor ${className}`}
    mode=${mode}
    language=${language}
    aria-label=${label}
    ?read-only=${readOnly}
    @input=${onInput || A}
  ></ha-code-editor>`;
}
function section(title, content, className = "", controls = A) {
  return b2`<section class="nc-section ${className}" data-title=${title}>
    <header class="nc-section-titlebar">
      <h2>${title}</h2>
      ${controls}
    </header>
    <div class="nc-section-content">${content}</div>
  </section>`;
}
function optionalControls(context, setting, enabled, label, onToggle, disabled = false) {
  const stateText = enabledLabel(enabled);
  const title = toggleTitle(enabled, label);
  return b2`<div class="nc-setting-controls">
    <span class="nc-setting-state">${stateText}</span>
    <input
      class="nc-switch-input"
      type="checkbox"
      role="switch"
      .checked=${enabled}
      ?disabled=${disabled}
      aria-label=${`Enable ${label}`}
      title=${title}
      @change=${(event) => onToggle(checkedOf(event))}
    />
    <button
      class="nc-icon-button danger"
      type="button"
      aria-label=${`Remove ${label}`}
      title=${`Remove ${label}`}
      @click=${() => context.removeSetting(setting)}
    >
      <ha-icon icon="mdi:trash-can-outline"></ha-icon>
    </button>
  </div>`;
}
function enabledLabel(enabled) {
  return enabled ? "Enabled" : "Disabled";
}
function toggleTitle(enabled, label) {
  return enabled ? `Disable ${label}` : `Enable ${label}`;
}
function showYaml(root, alert) {
  const popup = document.createElement("div");
  const close = () => popup.remove();
  D(
    b2`<div
      class="nc-modal-backdrop"
      @click=${(event) => {
      if (event.target === event.currentTarget) close();
    }}
    >
      <section class="nc-modal nc-alert-yaml-modal">
        <header class="nc-modal-header">
          <h2>Alert YAML</h2>
          <button
            class="nc-icon-button"
            @click=${close}
            aria-label="Close YAML"
            title="Close YAML"
          >
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </header>
        <main class="nc-modal-body">
          ${codeEditor({
      value: "",
      mode: "yaml",
      language: "yaml",
      label: "Alert YAML",
      className: "nc-alert-yaml-editor",
      readOnly: true
    })}
        </main>
      </section>
    </div>`,
    popup
  );
  const editor = popup.querySelector("ha-code-editor");
  if (!editor) throw new Error("Missing alert YAML editor");
  editor.value = stringify3(alert);
  root.append(popup);
}
function actionArrayValue(editor, label) {
  let parsed;
  try {
    parsed = parse(editor?.value || "[]");
  } catch {
    throw new Error(
      `${label} must be a valid YAML list of action objects. Example: - action: switch.turn_on`
    );
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => item && typeof item === "object")) {
    throw new Error(`${label} must be a YAML list of action objects.`);
  }
  return parsed;
}

// frontend/condition-builder.ts
var conditionTypes = [
  ["state", "State"],
  ["numeric", "Numeric state"],
  ["attribute", "Attribute"]
];
function firstValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  if (typeof value === "string") return value;
  return "";
}
function visualConditionBuilder(container, registries, conditions = [], markDirty) {
  const state = conditions.filter(
    (condition) => conditionTypes.some(([type]) => type === condition.type)
  ).map((condition) => ({ ...condition }));
  const entities = registries.entities.filter(
    (item) => !item.entity_id.startsWith("notify.")
  );
  const entityListId = `nc-condition-entities-${Math.random().toString(36).slice(2)}`;
  const entityName = (entityId) => {
    const entity = entities.find((item) => item.entity_id === entityId);
    return entity?.friendly_name || entity?.name_by_user || entity?.name || entity?.original_name || entityId;
  };
  const entityLabel = (entityId) => {
    const name = entityName(entityId);
    if (name === entityId) return entityId;
    return `${name} (${entityId})`;
  };
  const resolveEntityInput = (input) => {
    const value = input.trim();
    const matchingEntity = entities.find((item) => item.entity_id === value);
    if (matchingEntity) return matchingEntity.entity_id;
    const matchingLabel = entities.find(
      (item) => entityLabel(item.entity_id) === value
    );
    if (matchingLabel) return matchingLabel.entity_id;
    const matchingName = entities.filter(
      (item) => entityName(item.entity_id) === value
    );
    if (matchingName.length === 1) return matchingName[0].entity_id;
    const entityIdMatch = value.match(/\(([^)]+)\)$/);
    if (entityIdMatch?.[1]) return entityIdMatch[1];
    return value;
  };
  const update = (condition, key, event) => {
    const control = event.currentTarget;
    condition[key] = control.value;
    markDirty();
  };
  const updateEntity = (condition, event) => {
    condition.entity_id = resolveEntityInput(
      event.currentTarget.value
    );
    markDirty();
  };
  const renderBuilder = () => {
    D(
      b2`<div class="nc-condition-rows">${conditionRowsTemplate()}</div>
        <datalist id=${entityListId}>
          ${entities.map(
        (item) => b2`<option value=${entityLabel(item.entity_id)}></option>`
      )}
        </datalist>
        <button
          class="nc-button secondary"
          @click=${() => {
        state.push({ type: "state", entity_id: "", state: "on" });
        markDirty();
        renderBuilder();
      }}
        >
          Add condition
        </button>`,
      container
    );
  };
  const conditionRowsTemplate = () => {
    if (!state.length) {
      return b2`<div class="nc-help">No visual conditions configured.</div>`;
    }
    return state.map(
      (condition, index) => conditionRowTemplate(condition, index)
    );
  };
  const conditionRowTemplate = (condition, index) => b2` <div class="nc-condition-row">
      <label class="nc-field"
        >Type
        <select
          @change=${(event) => {
    condition.type = event.currentTarget.value;
    markDirty();
    renderBuilder();
  }}
        >
          ${conditionTypes.map(
    ([value, label]) => b2`<option value=${value} .selected=${condition.type === value}>
                ${label}
              </option>`
  )}
        </select>
      </label>
      <label class="nc-field"
        >Entity
        <input
          list=${entityListId}
          placeholder="Search entity name or ID"
          .value=${entityLabel(firstValue(condition.entity_id))}
          @input=${(event) => updateEntity(condition, event)}
          @change=${(event) => updateEntity(condition, event)}
        />
      </label>
      ${stateConditionTemplate(condition)}${numericConditionTemplate(
    condition
  )}${attributeConditionTemplate(condition)}
      <label class="nc-field"
        >For${durationInput(
    durationInputValue(condition.for, "00:00:00"),
    (next) => {
      condition.for = next;
      markDirty();
    }
  )}</label
      >
      <button
        class="nc-button danger"
        @click=${() => {
    state.splice(index, 1);
    markDirty();
    renderBuilder();
  }}
      >
        Remove condition
      </button>
    </div>`;
  const stateConditionTemplate = (condition) => {
    if (condition.type !== "state") {
      return "";
    }
    return b2`<label class="nc-field"
      >State<input
        value=${firstValue(condition.state)}
        @input=${(event) => update(condition, "state", event)}
    /></label>`;
  };
  const numericConditionTemplate = (condition) => {
    if (condition.type !== "numeric") {
      return "";
    }
    return b2`<label class="nc-field"
        >Above<input
          type="number"
          .value=${String(condition.above ?? "")}
          @input=${(event) => update(condition, "above", event)} /></label
      ><label class="nc-field"
        >Below<input
          type="number"
          .value=${String(condition.below ?? "")}
          @input=${(event) => update(condition, "below", event)}
      /></label>`;
  };
  const attributeConditionTemplate = (condition) => {
    if (condition.type !== "attribute") {
      return "";
    }
    return b2`<label class="nc-field"
        >Attribute<input
          .value=${condition.attribute || ""}
          @input=${(event) => update(condition, "attribute", event)} /></label
      ><label class="nc-field"
        >Expected value<input
          .value=${condition.value || ""}
          @input=${(event) => update(condition, "value", event)}
      /></label>`;
  };
  renderBuilder();
  return () => state.filter((condition) => Boolean(firstValue(condition.entity_id)));
}

// frontend/recipient-picker.ts
function createRecipientPicker(registries, target, markDirty) {
  const host = document.createElement("div");
  const labels = {
    all: "All",
    device_id: "Devices",
    area_id: "Areas",
    floor_id: "Floors",
    label_id: "Labels",
    entity_id: "Notification entities",
    user_id: "Users"
  };
  const items = [
    ...registries.devices.map((item) => ({
      type: "device_id",
      id: item.id,
      label: item.name_by_user || item.name || item.id
    })),
    ...registries.areas.map((item) => ({
      type: "area_id",
      id: item.area_id || item.id || "",
      label: item.name || item.id || ""
    })),
    ...registries.floors.map((item) => ({
      type: "floor_id",
      id: item.floor_id || item.id || "",
      label: item.name || item.id || ""
    })),
    ...registries.labels.map((item) => ({
      type: "label_id",
      id: item.label_id || item.id || "",
      label: item.name || item.id || ""
    })),
    ...registries.entities.filter((item) => item.entity_id.startsWith("notify.")).map((item) => ({
      type: "entity_id",
      id: item.entity_id,
      label: item.name || item.entity_id
    })),
    ...registries.users.filter((item) => item.is_active !== false).map((item) => ({
      type: "user_id",
      id: item.id,
      label: item.name
    }))
  ];
  const selected = /* @__PURE__ */ new Set();
  for (const item of items) {
    if ((target[item.type] || []).some((value) => String(value) === item.id))
      selected.add(`${item.type}:${item.id}`);
  }
  let filter = "all";
  let search = "";
  let open = false;
  const notifyChange = () => {
    markDirty();
    host.dispatchEvent(new Event("change"));
  };
  const renderPicker = () => {
    const query = search.trim().toLowerCase();
    const matches = items.filter(
      (item) => !selected.has(`${item.type}:${item.id}`) && (filter === "all" || item.type === filter) && (!query || item.label.toLowerCase().includes(query))
    );
    const selectedItems = [...selected].map((key) => {
      const [type, ...parts] = key.split(":");
      return {
        key,
        type,
        id: parts.join(":"),
        item: items.find(
          (candidate) => candidate.type === type && candidate.id === parts.join(":")
        )
      };
    });
    D(
      b2`<div class="nc-target-picker">
        <div class="nc-target-selection-label">Selected recipients</div>
        <div class="nc-target-chips">
          ${selectedItems.map(
        ({ key, type, id, item }) => b2`<span class="nc-target-chip" title=${labels[type]}
                >${item?.label || id}<button
                  class="nc-chip-remove"
                  @click=${() => {
          selected.delete(key);
          notifyChange();
          renderPicker();
        }}
                >
                  Remove
                </button></span
              >`
      )}
        </div>
        <div class="nc-recipient-input">
          <div class="nc-recipient-toolbar">
            <input
              type="search"
              autocomplete="off"
              name="ha-notifications-recipient-search"
              placeholder="Search recipients"
              .value=${search}
              @input=${(event) => {
        search = event.currentTarget.value;
        open = true;
        renderPicker();
      }}
              @focus=${() => {
        open = true;
        renderPicker();
      }}
            />
            <div class="nc-recipient-filters">
              ${Object.keys(labels).map(
        (key) => b2`<button
                    class=${recipientFilterClass(filter === key)}
                    @click=${() => {
          filter = key;
          open = true;
          renderPicker();
        }}
                  >
                    ${labels[key]}
                  </button>`
      )}
            </div>
          </div>
          <div
            class="nc-recipient-results"
            ?hidden=${!open}
            @focusout=${(event) => {
        if (!event.currentTarget.contains(
          event.relatedTarget
        )) {
          open = false;
          renderPicker();
        }
      }}
          >
            ${recipientMatchesTemplate(matches, query)}
          </div>
        </div>
      </div>`,
      host
    );
  };
  const recipientFilterClass = (active) => {
    const classes = ["nc-recipient-filter"];
    if (active) {
      classes.push("active");
    }
    return classes.join(" ");
  };
  const recipientMatchesTemplate = (matches, query) => {
    if (!matches.length) {
      return recipientEmptyTemplate(query);
    }
    return matches.map(
      (item) => b2`<button
          class="nc-recipient-option"
          title=${labels[item.type]}
          @mousedown=${(event) => event.preventDefault()}
          @click=${() => {
        selected.add(`${item.type}:${item.id}`);
        notifyChange();
        open = false;
        renderPicker();
      }}
        >
          ${item.label}
        </button>`
    );
  };
  const recipientEmptyTemplate = (query) => {
    let message = "No recipients available";
    if (query) {
      message = "No matching recipients";
    }
    return b2`<div class="nc-recipient-empty">${message}</div>`;
  };
  renderPicker();
  return {
    element: host,
    target: () => {
      const result = {};
      for (const key of selected) {
        const [type, ...parts] = key.split(":");
        const recipientType = type;
        result[recipientType] ||= [];
        result[recipientType]?.push(parts.join(":"));
      }
      return result;
    }
  };
}

// frontend/sections/basic.ts
function renderBasicSection(context) {
  const { value } = context;
  return section(
    "Basic",
    b2`<div class="nc-grid">
      ${field(
      "Name",
      b2`<input
          type="text"
          .value=${value.name}
          placeholder="Alert name"
          @input=${(event) => {
        value.name = valueOf(event);
        context.markDirty();
        context.refreshStatuses();
      }}
        />`
    )}
      ${field(
      "Description",
      b2`<textarea
          .value=${value.description}
          @input=${(event) => {
        value.description = valueOf(event);
        context.markDirty();
        context.refreshStatuses();
      }}
        ></textarea>`,
      true
    )}
    </div>`
  );
}

// frontend/sections/monitor.ts
function renderMonitorSection(context) {
  const monitor = context.value.monitor;
  return section(
    "When to check",
    b2`<div class="nc-grid">
        ${field(
      "When condition changes",
      b2`<div class="nc-check">
            <input
              type="checkbox"
              .checked=${monitor.on_change !== false}
              @change=${(event) => {
        monitor.on_change = checkedOf(event);
        context.markDirty();
        context.refreshStatuses();
      }}
            /><span>When the condition changes</span>
          </div>`
    )}
        ${field(
      "Re-evaluate condition every",
      b2`<div class="nc-check">
              <input
                data-role="interval-toggle"
                type="checkbox"
                .checked=${Boolean(monitor.interval)}
                @change=${(event) => {
        const currentInterval = monitor.interval;
        monitor.interval = void 0;
        if (checkedOf(event)) {
          monitor.interval = currentInterval || "12:00:00";
        }
        context.markDirty();
        context.refreshStatuses();
      }}
              /><span>Re-evaluate condition every</span>
            </div>
            ${durationInput(
        durationInputValue(monitor.interval, "12:00:00"),
        (next) => {
          monitor.interval = next;
          context.markDirty();
        }
      )}`
    )}
        ${field(
      "Check at startup",
      b2`<div class="nc-check">
            <input
              type="checkbox"
              .checked=${monitor.startup !== false}
              @change=${(event) => {
        monitor.startup = checkedOf(event);
        context.markDirty();
        context.refreshStatuses();
      }}
            /><span>Check when Home Assistant starts</span>
          </div>`
    )}
      </div>
      <div class="nc-help">
        You can select either method or both. For example, use changes for
        immediate detection and an interval as a safety check.
      </div>`
  );
}

// frontend/sections/condition.ts
function renderConditionSection(context) {
  const condition = conditionTemplate(context.value);
  return section(
    "Condition",
    b2`<div class="nc-condition-mode">
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => context.setMode("visual")}
        >
          Visual conditions
        </button>
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => context.setMode("yaml")}
        >
          Conditions YAML
        </button>
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => context.setMode("jinja")}
        >
          Advanced Jinja
        </button>
      </div>
      <div data-role="visual" class="nc-condition-visual"></div>
      <div data-role="conditions-yaml">
        ${field(
      "Conditions YAML",
      codeEditor({
        role: "conditions-yaml-editor",
        value: conditionsYaml(context.value.conditions),
        mode: "yaml",
        language: "yaml",
        label: "Conditions YAML",
        onInput: () => context.markDirty()
      }),
      true
    )}
        <div class="nc-help">
          Edit the raw <code>conditions:</code> list. This is the YAML behind
          the visual editor.
        </div>
      </div>
      <div data-role="jinja">
        ${field(
      "Jinja condition",
      codeEditor({
        role: "condition",
        value: condition,
        placeholder: "{{ is_state('binary_sensor.example', 'on') }}",
        mode: "jinja2",
        language: "jinja",
        label: "Jinja condition",
        onInput: (event) => {
          context.value.conditions = [
            {
              type: "template",
              template: event.currentTarget.value
            }
          ];
          context.markDirty();
          context.refreshStatuses();
        }
      }),
      true
    )}
        <div class="nc-help">
          The condition should evaluate to true or false. Home Assistant
          automatically tracks entities referenced by the template.
        </div>
      </div>`,
    "",
    b2`<button
      class="nc-button secondary"
      @click=${() => context.validateCondition()}
    >
      Validate condition
    </button>`
  );
}

// frontend/sections/recipients.ts
function renderRecipientSection() {
  return section(
    "Recipients",
    b2`<div data-role="recipients"></div>
      <div class="nc-help">
        Search for a recipient, choose a type when needed, then select it. You
        can mix devices, areas, labels, floors, and notification entities.
      </div>
      <div class="nc-help">
        Mobile App-only recipients use legacy Mobile App delivery. Mixed or
        non-mobile recipients use standard Notify delivery.
      </div>`,
    "nc-section-recipient"
  );
}

// frontend/sections/notification.ts
function renderNotificationSection(context) {
  const notification = context.value.notification;
  return section(
    "Notification",
    b2`<div class="nc-grid">
        ${field(
      "Title",
      b2`<input
            type="text"
            .value=${notification.title}
            placeholder="Notification title"
            @input=${(event) => {
        notification.title = valueOf(event);
        context.markDirty();
        context.refreshStatuses();
      }}
          />`
    )}
        ${field(
      "Message",
      codeEditor({
        value: notification.message || "",
        placeholder: "Notification message",
        mode: "jinja2",
        language: "jinja",
        label: "Notification message",
        onInput: (event) => {
          notification.message = event.currentTarget.value;
          context.markDirty();
          context.refreshStatuses();
        }
      }),
      true
    )}
      </div>
      <div class="nc-help">
        Recipients on selected devices, areas, floors, and labels receive direct
        Mobile App notifications when a matching notifier is available.
      </div>`
  );
}

// frontend/sections/post-send-actions.ts
function renderPostSendActionsSection(context) {
  const postSendActions = context.value.post_send_actions;
  return section(
    "Post-send actions",
    b2`<div class="nc-help">
        Runs after every notification send. Enter a YAML list of Home Assistant
        actions. JSON arrays also work because JSON is valid YAML.
      </div>
      ${codeEditor({
      role: "notification-actions",
      value: actionsYaml(postSendActions?.actions),
      placeholder: ACTIONS_PLACEHOLDER,
      mode: "yaml",
      language: "yaml",
      label: "Post-send actions",
      onInput: () => context.markDirty()
    })}
      <button
        class="nc-button secondary"
        @click=${() => context.validateActions("notification-actions", "Post-send actions")}
      >
        Validate actions
      </button>`,
    "",
    optionalControls(
      context,
      "postSendActions",
      Boolean(postSendActions?.enabled),
      "post-send actions",
      (enabled) => {
        context.value.post_send_actions = {
          enabled,
          actions: postSendActions?.actions
        };
        context.markDirty();
      }
    )
  );
}

// frontend/sections/confirmation.ts
function renderConfirmationSection(context) {
  const confirmation = context.value.confirmation;
  return section(
    "Confirmation",
    b2`<div class="nc-grid">
        ${field(
      "Button text",
      b2`<input
            type="text"
            .value=${confirmation.button}
            placeholder="Activity completed"
            @input=${(event) => {
        confirmation.button = valueOf(event);
        context.markDirty();
      }}
          />`
    )}
      </div>
      <div class="nc-help">
        Confirmation buttons require at least one Mobile App recipient.
      </div>
      <label class="nc-switch-label">
        <input
          class="nc-switch-input"
          type="checkbox"
          role="switch"
          .checked=${confirmation.notification.clear !== false}
          @change=${(event) => {
      confirmation.notification.clear = checkedOf(event);
      context.markDirty();
    }}
        />
        <span>Clear notifications when acknowledged</span>
      </label>`,
    "",
    optionalControls(
      context,
      "confirmation",
      Boolean(confirmation.enabled),
      "confirmation",
      (enabled) => {
        confirmation.enabled = enabled;
        context.markDirty();
      }
    )
  );
}

// frontend/sections/confirmation-reminder.ts
function renderConfirmationReminderSection(context) {
  const confirmation = context.value.confirmation;
  return section(
    "Reminder policy",
    b2`<div class="nc-grid">
        ${field(
      "Remind every",
      durationInput(
        durationInputValue(confirmation.reminders.interval, "00:30:00"),
        (next) => {
          confirmation.reminders.interval = next;
          context.markDirty();
        }
      )
    )}
        ${field(
      "Maximum reminders",
      b2`<input
            type="number"
            min="1"
            max="20"
            .value=${String(confirmation.reminders.max_attempts || 5)}
            @input=${(event) => {
        confirmation.reminders.max_attempts = Math.min(
          20,
          Math.max(1, Number(valueOf(event)) || 5)
        );
        context.markDirty();
      }}
          />`
    )}
      </div>
      <div class="nc-reminder-options">
      <label class="nc-switch-label">
        <input
          class="nc-switch-input"
          type="checkbox"
          role="switch"
          .checked=${confirmation.reminders.show_attempts === true}
          @change=${(event) => {
      confirmation.reminders.show_attempts = checkedOf(event);
      context.markDirty();
    }}
        />
        <span>Show attempt count in notification title</span>
      </label>
      </div>
      <div class="nc-help">
        Resend only while this confirmation is still pending.
      </div>`,
    "",
    optionalControls(
      context,
      "confirmationReminder",
      confirmation.reminders.enabled !== false,
      "reminder policy",
      (enabled) => {
        confirmation.reminders.enabled = enabled;
        context.markDirty();
      }
    )
  );
}

// frontend/sections/confirmation-notification.ts
function renderConfirmationNotificationSection(context) {
  const confirmation = context.value.confirmation;
  return section(
    "Notify recipients when confirmed",
    b2`${codeEditor({
      value: confirmation.notification.message || "",
      placeholder: "",
      mode: "jinja2",
      language: "jinja",
      label: "Confirmation message",
      onInput: (event) => {
        confirmation.notification.message = event.currentTarget.value;
        context.markDirty();
      }
    })}
      <div class="nc-help">
        Optionally send a follow-up message after acknowledgement.
      </div>
      `,
    "",
    optionalControls(
      context,
      "confirmationNotification",
      confirmation.notification.enabled === true,
      "confirmation notification",
      (enabled) => {
        confirmation.notification.enabled = enabled;
        context.markDirty();
      }
    )
  );
}

// frontend/sections/post-confirmation-actions.ts
function renderPostConfirmationActionsSection(context) {
  const confirmation = context.value.confirmation;
  return section(
    "Post-confirmation actions",
    b2`<div class="nc-help">
        Runs after a recipient confirms. Enter a YAML list of Home Assistant
        actions. JSON arrays also work because JSON is valid YAML.
      </div>
      ${codeEditor({
      role: "actions",
      value: actionsYaml(confirmation.actions.items),
      placeholder: ACTIONS_PLACEHOLDER,
      mode: "yaml",
      language: "yaml",
      label: "Post-confirmation actions",
      onInput: () => context.markDirty()
    })}
      <button
        class="nc-button secondary"
        @click=${() => context.validateActions("actions", "Post-confirmation actions")}
      >
        Validate actions
      </button>`,
    "",
    optionalControls(
      context,
      "postConfirmationActions",
      Boolean(confirmation.actions.enabled),
      "post-confirmation actions",
      (enabled) => {
        confirmation.actions.enabled = enabled;
        context.markDirty();
      }
    )
  );
}

// frontend/editor/index.ts
var AlertEditorController = class {
  root;
  registries;
  onSave;
  onSaved;
  onTest;
  onValidateCondition;
  onDiscardTest;
  value;
  host = document.createElement("div");
  page;
  dashboardContent;
  dashboardTabs;
  dashboardActions;
  context;
  optionalSettings;
  collapsedParents = /* @__PURE__ */ new Set();
  dirty = false;
  draftTestSessionId = null;
  visual;
  conditionsYamlView;
  jinja;
  visualConditions;
  recipients;
  constructor(options) {
    this.root = options.root;
    this.registries = options.registries;
    this.onSave = options.onSave;
    this.onSaved = options.onSaved;
    this.onTest = options.onTest;
    this.onValidateCondition = options.onValidateCondition;
    this.onDiscardTest = options.onDiscardTest;
    this.value = clone(options.alert || defaultAlert());
    this.value.confirmation = {
      enabled: false,
      button: "",
      notification: { enabled: false, message: "", clear: true },
      reminders: {
        enabled: true,
        interval: "00:30:00",
        max_attempts: 5,
        show_attempts: false
      },
      actions: { enabled: false, items: [] },
      ...this.value.confirmation
    };
    this.page = this.root.querySelector(".nc-page");
    this.dashboardContent = this.page?.querySelector(
      ".nc-alerts, .nc-empty, #history-view, #yaml-view"
    );
    this.dashboardTabs = this.page?.querySelector(".nc-tabs");
    this.dashboardActions = this.page?.querySelector(".nc-actions");
    if (this.dashboardContent) this.dashboardContent.hidden = true;
    if (this.dashboardTabs) this.dashboardTabs.hidden = true;
    if (this.dashboardActions) {
      const backButton = document.createElement("button");
      backButton.className = "nc-button secondary";
      backButton.textContent = "Back to alerts";
      backButton.addEventListener("click", () => this.close());
      this.dashboardActions.replaceChildren(backButton);
    }
    this.context = {
      value: this.value,
      mode: editorModeFor(this.value),
      markDirty: this.markDirty,
      refreshStatuses: this.refreshStatuses,
      removeSetting: this.removeSetting,
      setMode: this.setMode,
      validateCondition: this.validateCondition,
      validateActions: this.validateActions
    };
    this.optionalSettings = {
      confirmation: !options.alert || Boolean(options.alert.confirmation),
      confirmationReminder: !options.alert || Boolean(options.alert?.confirmation?.reminders),
      confirmationNotification: !options.alert || Boolean(options.alert?.confirmation?.notification),
      postSendActions: true,
      postConfirmationActions: !options.alert || Boolean(options.alert.confirmation)
    };
    this.renderEditor();
    this.root.append(this.host);
    void fillActionEditors(this.host);
    this.visual = this.host.querySelector('[data-role="visual"]');
    this.conditionsYamlView = this.host.querySelector(
      '[data-role="conditions-yaml"]'
    );
    const recipientMount = this.host.querySelector(
      '[data-role="recipients"]'
    );
    this.visualConditions = visualConditionBuilder(
      this.visual,
      this.registries,
      this.value.conditions,
      this.context.markDirty
    );
    this.recipients = createRecipientPicker(
      this.registries,
      this.value.notification.target,
      this.context.markDirty
    );
    recipientMount.replaceChildren(this.recipients.element);
    this.jinja = this.host.querySelector('[data-role="jinja"]');
    this.refreshStatuses();
    this.showSection(0);
  }
  restoreDashboardAction = () => {
    if (!this.dashboardActions) return;
    const addButton = document.createElement("button");
    addButton.className = "nc-button";
    addButton.textContent = "+ Add alert";
    addButton.addEventListener("click", () => {
      const panel = this.root.host;
      void panel.addAlert?.();
    });
    this.dashboardActions.replaceChildren(addButton);
  };
  renderEditor = () => {
    const optionalSettings = this.optionalSettings;
    const context = this.context;
    D(
      b2`<div class="nc-editor-view">
        <section class="nc-editor-shell">
          <main class="nc-modal-body">
            <div class="nc-editor-layout">
              <nav class="nc-section-header" aria-label="Alert sections">
                <select
                  class="nc-add-setting"
                  aria-label="Add setting"
                  @change=${(event) => this.addSetting(valueOf(event))}
                >
                  <option value="">Add setting</option>
                  <option
                    value="confirmation"
                    ?disabled=${optionalSettings.confirmation}
                  >
                    Confirmation
                  </option>
                </select>
                ${editorSections.map(
        ({ title, setting, parent, status }, index) => {
          const hasChildren = editorSections.some(
            (section2) => section2.parent === title
          );
          return b2` <div
                      class="nc-section-nav-row"
                      data-setting=${setting || A}
                      data-parent=${parent || A}
                      ?hidden=${!isSectionVisible(setting, optionalSettings) || parent === "Confirmation" && !optionalSettings.confirmation}
                    >
                      <button
                        class=${this.sectionNavButtonClass(setting, parent)}
                        @click=${() => this.showSection(index)}
                      >
                        ${this.sectionStatus(status)}
                        <span>${title}</span>
                      </button>
                      ${this.sectionCollapseButton(hasChildren, title)}
                    </div>`;
        }
      )}
              </nav>
              <select
                class="nc-section-select"
                aria-label="Alert section"
                @change=${(event) => this.showSection(Number(valueOf(event)))}
              >
                ${editorSections.map(
        ({ title, setting, parent }, index) => b2`<option
                      value=${index}
                      ?disabled=${!isSectionVisible(
          setting,
          optionalSettings
        ) || parent === "Confirmation" && !optionalSettings.confirmation}
                    >
                      ${this.sectionLabel(parent, title)}
                    </option>`
      )}
              </select>
              <div class="nc-editor-sections">
                ${renderBasicSection(context)}${renderMonitorSection(
        context
      )}${renderConditionSection(
        context
      )}${renderRecipientSection()}${renderNotificationSection(
        context
      )}
                <div
                  class="nc-optional-setting"
                  data-setting="postSendActions"
                  ?hidden=${!optionalSettings.postSendActions}
                >
                  ${renderPostSendActionsSection(context)}
                </div>
                <div
                  class="nc-optional-setting"
                  data-setting="confirmation"
                  ?hidden=${!optionalSettings.confirmation}
                >
                  ${renderConfirmationSection(context)}
                </div>
                <div
                  class="nc-optional-setting"
                  data-setting="confirmationReminder"
                  ?hidden=${!optionalSettings.confirmationReminder || !optionalSettings.confirmation}
                >
                  ${renderConfirmationReminderSection(context)}
                </div>
                <div
                  class="nc-optional-setting"
                  data-setting="confirmationNotification"
                  ?hidden=${!optionalSettings.confirmationNotification || !optionalSettings.confirmation}
                >
                  ${renderConfirmationNotificationSection(context)}
                </div>
                <div
                  class="nc-optional-setting"
                  data-setting="postConfirmationActions"
                  ?hidden=${!optionalSettings.postConfirmationActions}
                >
                  ${renderPostConfirmationActionsSection(context)}
                </div>
              </div>
            </div>
          </main>
          <footer class="nc-modal-footer">
            <button
              class="nc-icon-button"
              type="button"
              aria-label="View alert YAML"
              title="View alert YAML"
              aria-expanded="false"
              @click=${this.yamlView}
            >
              <ha-icon icon="mdi:code-braces"></ha-icon>
            </button>
            <button class="nc-button secondary" @click=${() => this.close()}>
              Cancel</button
            ><button class="nc-button secondary" @click=${this.test}>
              Test alert</button
            ><button class="nc-button" @click=${this.save}>Save alert</button>
          </footer>
        </section>
      </div>`,
      this.host
    );
  };
  markDirty = () => {
    this.dirty = true;
    this.refreshStatuses();
  };
  setMode = (mode) => {
    if (mode === "yaml" && this.context.mode === "visual") {
      const editor = this.host.querySelector(
        '[data-role="conditions-yaml-editor"]'
      );
      if (editor) editor.value = conditionsYaml(this.visualConditions());
    }
    this.context.mode = mode;
    this.markDirty();
    this.refreshStatuses();
  };
  refreshStatuses = () => {
    const value = this.value;
    this.visual.hidden = this.context.mode !== "visual";
    this.conditionsYamlView.hidden = this.context.mode !== "yaml";
    this.jinja.hidden = this.context.mode !== "jinja";
    const enabled = {
      postSendActions: Boolean(value.post_send_actions?.enabled),
      confirmation: Boolean(value.confirmation?.enabled),
      postConfirmationActions: Boolean(
        value.confirmation?.enabled && value.confirmation.actions.enabled
      ),
      confirmationReminder: Boolean(
        value.confirmation?.enabled && value.confirmation.reminders.enabled
      ),
      confirmationNotification: Boolean(
        value.confirmation?.enabled && value.confirmation.notification.enabled
      )
    };
    this.host.querySelectorAll(".nc-section-status").forEach((indicator) => {
      const status = indicator.dataset.status;
      const isEnabled = Boolean(status && enabled[status]);
      indicator.classList.toggle("active", isEnabled);
      indicator.textContent = this.sectionStatusSymbol(isEnabled);
      indicator.setAttribute("aria-label", enabledLabel(isEnabled));
    });
  };
  addSetting = (setting) => {
    if (setting === "confirmation") {
      this.value.confirmation.enabled = true;
      this.optionalSettings.confirmation = true;
      this.optionalSettings.confirmationReminder = true;
      this.optionalSettings.confirmationNotification = true;
      this.optionalSettings.postConfirmationActions = true;
    } else return;
    this.host.querySelectorAll(`[data-setting="${setting}"]`).forEach((item) => item.hidden = false);
    const select = this.host.querySelector(".nc-add-setting");
    const option = select?.querySelector(
      `option[value="${setting}"]`
    );
    if (option) option.disabled = true;
    const sectionIndex = sectionForSetting(setting).index;
    const mobileOption = this.host.querySelector(
      `.nc-section-select option[value="${sectionIndex}"]`
    );
    if (mobileOption) mobileOption.disabled = false;
    if (setting === "confirmation") {
      this.setOptionalSettingVisible("postConfirmationActions", true);
    }
    if (select) select.value = "";
    this.markDirty();
    this.refreshStatuses();
  };
  removeSetting = (setting) => {
    if (setting === "postSendActions") {
      delete this.value.post_send_actions;
    } else if (setting === "confirmationReminder") {
      this.value.confirmation.reminders.enabled = false;
    } else if (setting === "confirmationNotification") {
      this.value.confirmation.notification.enabled = false;
    } else if (setting === "postConfirmationActions") {
      this.value.confirmation.actions.items = [];
      this.value.confirmation.actions.enabled = false;
    } else {
      this.value.confirmation = {
        enabled: false,
        button: "",
        notification: { enabled: false, message: "", clear: true },
        reminders: {
          enabled: true,
          interval: "00:30:00",
          max_attempts: 5,
          show_attempts: false
        },
        actions: { enabled: false, items: [] }
      };
      this.optionalSettings.postConfirmationActions = false;
      this.optionalSettings.confirmationReminder = false;
      this.optionalSettings.confirmationNotification = false;
      this.setOptionalSettingVisible("postConfirmationActions", false);
      this.setOptionalSettingVisible("confirmationReminder", false);
      this.setOptionalSettingVisible("confirmationNotification", false);
    }
    this.optionalSettings[setting] = false;
    this.setOptionalSettingVisible(setting, false);
    this.markDirty();
    this.showSection(0);
  };
  setOptionalSettingVisible = (setting, visible) => {
    this.host.querySelectorAll(`[data-setting="${setting}"]`).forEach((item) => item.hidden = !visible);
    const sectionIndex = sectionForSetting(setting).index;
    const mobileOption = this.host.querySelector(
      `.nc-section-select option[value="${sectionIndex}"]`
    );
    if (mobileOption) mobileOption.disabled = !visible;
    const addOption = this.host.querySelector(
      `.nc-add-setting option[value="${setting}"]`
    );
    if (addOption) addOption.disabled = visible;
  };
  showSection = (index) => {
    this.host.querySelectorAll(".nc-section").forEach(
      (item, itemIndex) => item.classList.toggle("active", itemIndex === index)
    );
    this.host.querySelectorAll(".nc-section-nav-button").forEach((button, itemIndex) => {
      const active = itemIndex === index;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    const select = this.host.querySelector(".nc-section-select");
    if (select) select.value = String(index);
  };
  toggleSidebarChildren = (parent) => {
    const collapsed = !this.collapsedParents.has(parent);
    if (collapsed) this.collapsedParents.add(parent);
    else this.collapsedParents.delete(parent);
    this.host.querySelectorAll(
      `.nc-section-nav-row[data-parent="${parent}"]`
    ).forEach((row) => {
      const setting = row.dataset.setting;
      row.hidden = collapsed || !isSectionVisible(setting, this.optionalSettings);
    });
    const button = this.host.querySelector(
      `[data-collapse-parent="${parent}"]`
    );
    if (button) {
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute(
        "aria-label",
        this.sidebarToggleLabel(collapsed, parent)
      );
      button.setAttribute("title", this.sidebarToggleLabel(collapsed, parent));
      const icon = button.querySelector("ha-icon");
      if (icon) icon.setAttribute("icon", this.sidebarToggleIcon(collapsed));
    }
  };
  sectionStatus(status) {
    if (!status) {
      return A;
    }
    return b2`<span
      class="nc-section-status"
      data-status=${status}
      aria-hidden="true"
    ></span>`;
  }
  sectionNavButtonClass(setting, parent) {
    const classes = ["nc-section-nav-button"];
    if (setting) {
      classes.push("nc-optional-setting");
    }
    if (parent) {
      classes.push("nc-section-nav-child");
    }
    return classes.join(" ");
  }
  sectionCollapseButton(hasChildren, title) {
    if (!hasChildren) {
      return A;
    }
    return b2`<button
      class="nc-section-collapse-button"
      type="button"
      aria-label=${`Collapse ${title} subpanels`}
      title=${`Collapse ${title} subpanels`}
      aria-expanded="true"
      data-collapse-parent=${title}
      @click=${() => this.toggleSidebarChildren(title)}
    >
      <ha-icon icon="mdi:chevron-down"></ha-icon>
    </button>`;
  }
  sectionLabel(parent, title) {
    if (parent) {
      return `${parent} / ${title}`;
    }
    return title;
  }
  sectionStatusSymbol(isEnabled) {
    if (isEnabled) {
      return "\u2713";
    }
    return "\xD7";
  }
  sidebarToggleLabel(collapsed, parent) {
    let action = "Collapse";
    if (collapsed) {
      action = "Expand";
    }
    return `${action} ${parent} subpanels`;
  }
  sidebarToggleIcon(collapsed) {
    if (collapsed) {
      return "mdi:chevron-right";
    }
    return "mdi:chevron-down";
  }
  discardDraftTest = async () => {
    const sessionId = this.draftTestSessionId;
    this.draftTestSessionId = null;
    if (!sessionId) return;
    try {
      await this.onDiscardTest(sessionId);
    } catch {
    }
  };
  close = ({ force = false } = {}) => {
    if (!force && this.dirty && !window.confirm("Discard unsaved changes?"))
      return false;
    void this.discardDraftTest();
    this.host.remove();
    if (this.dashboardContent) this.dashboardContent.hidden = false;
    if (this.dashboardTabs) this.dashboardTabs.hidden = false;
    this.restoreDashboardAction();
    return true;
  };
  formPayload = () => {
    const value = this.value;
    const conditions = this.conditionsForCurrentMode();
    let actions = [];
    if (this.optionalSettings.postConfirmationActions) {
      actions = actionArrayValue(
        this.host.querySelector('[data-role="actions"]'),
        "Post-confirmation actions"
      );
    }
    let notificationActions = [];
    if (this.optionalSettings.postSendActions) {
      notificationActions = actionArrayValue(
        this.host.querySelector(
          '[data-role="notification-actions"]'
        ),
        "Post-send actions"
      );
    }
    const confirmation = value.confirmation;
    const payload = {
      identity: {
        name: value.name,
        description: value.description
      },
      monitor: {
        conditions,
        onChange: value.monitor.on_change,
        startup: value.monitor.startup,
        interval: this.monitorIntervalPayload()
      },
      notification: {
        target: this.recipients.target(),
        title: value.notification.title,
        message: value.notification.message
      },
      confirmation: {
        enabled: Boolean(confirmation.enabled),
        button: confirmation.button,
        notification: {
          enabled: Boolean(confirmation.notification.enabled),
          message: confirmation.notification.message,
          clear: confirmation.notification.clear !== false
        },
        reminders: {
          enabled: confirmation.reminders.enabled,
          interval: durationInputValue(
            confirmation.reminders.interval,
            "00:30:00"
          ),
          max_attempts: confirmation.reminders.max_attempts,
          show_attempts: confirmation.reminders.show_attempts === true
        },
        actions: {
          enabled: Boolean(confirmation.actions.enabled)
        }
      },
      post_send_actions: {
        postSendActionsEnabled: Boolean(value.post_send_actions?.enabled)
      }
    };
    if (notificationActions.length) {
      payload.post_send_actions.actions = notificationActions;
    }
    if (actions.length) {
      payload.confirmation.actions.items = actions;
    }
    return buildAlertPayload(value, payload);
  };
  yamlView = () => {
    showYaml(this.root, this.formPayload());
  };
  conditionPayload = () => {
    const value = this.value;
    return {
      ...value,
      conditions: this.conditionsForCurrentMode()
    };
  };
  conditionsForCurrentMode() {
    if (this.context.mode === "visual") {
      return this.visualConditions();
    }
    if (this.context.mode === "yaml") {
      return parseConditionsYaml(this.conditionsYamlValue());
    }
    return [
      { type: "template", template: conditionTemplate(this.value) }
    ];
  }
  conditionsYamlValue() {
    return this.host.querySelector(
      '[data-role="conditions-yaml-editor"]'
    )?.value || "[]";
  }
  monitorIntervalPayload() {
    if (!this.value.monitor.interval) {
      return void 0;
    }
    return durationInputValue(this.value.monitor.interval, "12:00:00");
  }
  hasRequiredCondition = () => {
    if (this.context.mode === "visual") {
      return this.visualConditions().length > 0;
    }
    if (this.context.mode === "yaml") {
      try {
        return parseConditionsYaml(
          this.host.querySelector(
            '[data-role="conditions-yaml-editor"]'
          )?.value || "[]"
        ).length > 0;
      } catch {
        return true;
      }
    }
    return Boolean(conditionTemplate(this.value).trim());
  };
  validateCondition = async () => {
    try {
      if (!this.hasRequiredCondition())
        throw new Error("Condition is required.");
      await this.onValidateCondition(this.conditionPayload());
    } catch (error) {
      showEditorToast(this.root, errorMessage(error));
    }
  };
  validateActions = (role, label) => {
    try {
      actionArrayValue(
        this.host.querySelector(`[data-role="${role}"]`),
        label
      );
      showEditorToast(this.root, `${label} are valid.`, 4e3);
    } catch (error) {
      showEditorToast(this.root, errorMessage(error));
    }
  };
  test = async (event) => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      await this.discardDraftTest();
      const result = await this.onTest(this.formPayload());
      this.draftTestSessionId = result.session_id;
    } catch (error) {
      showEditorToast(this.root, errorMessage(error));
    } finally {
      button.disabled = false;
    }
  };
  save = async (event) => {
    const button = event.currentTarget;
    try {
      if (!this.value.name.trim()) throw new Error("Name is required.");
      if (!this.hasRequiredCondition())
        throw new Error("Condition is required.");
      if (!this.value.monitor.on_change && !this.value.monitor.interval)
        throw new Error("Enable condition changes, an interval, or both.");
      const result = this.formPayload();
      button.disabled = true;
      await this.discardDraftTest();
      const saved = await this.onSave(result);
      const savedAlert = saved || result;
      Object.assign(this.value, savedAlert);
      this.dirty = false;
      this.close({ force: true });
      await this.onSaved?.(savedAlert);
    } catch (error) {
      showEditorToast(this.root, errorMessage(error));
    } finally {
      button.disabled = false;
    }
  };
};
function openEditor(options) {
  if (options.root.querySelector(".nc-editor-view")) return;
  new AlertEditorController(options);
}

// frontend/history.ts
function historySeverity(type) {
  if (!type) return "info";
  if (type.includes("failed") || type.includes("error")) return "error";
  if (type.includes("confirmed") || type.includes("sent")) return "success";
  if (type.includes("inactive")) return "muted";
  return "info";
}
function formatTime(value) {
  if (!value) {
    return "\u2014";
  }
  try {
    return new Intl.DateTimeFormat(void 0, {
      dateStyle: "short",
      timeStyle: "medium"
    }).format(new Date(value));
  } catch (_err) {
    return value;
  }
}
function formatType(value) {
  return String(value || "event").replaceAll("_", " ");
}
function shortFlowId(value) {
  if (!value) return "";
  if (value.length > 18) {
    return value.slice(-12);
  }
  return value;
}
function detailSummary(details) {
  if (!details || !Object.keys(details).length) return "";
  if (typeof details.error === "string") return details.error;
  if (typeof details.source === "string") return `Source: ${details.source}`;
  return JSON.stringify(details);
}
function renderHistory(container, history, options = {}) {
  let content = emptyHistoryTemplate(options);
  if (history.length) {
    content = historyTemplate(history, options);
  }
  D(content, container);
}
function historyTemplate(history, options) {
  return b2`<div class="nc-card nc-history">
    ${historyFilterTemplate(options)}
    ${history.map((item) => historyItemTemplate(item, options))}
  </div>`;
}
function historyFilterTemplate(options) {
  if (!options.alertName) {
    return "";
  }
  return b2`<div class="nc-history-filter">
    <div>
      <div class="nc-history-filter-title">
        History for ${options.alertName}
      </div>
      <div class="nc-history-filter-subtitle">
        Showing events for this alert only.
      </div>
    </div>
    ${showAllButton(options.onShowAll, "Show all")}
  </div>`;
}
function historyItemTemplate(item, options) {
  const details = item.details;
  const summary = detailSummary(details);
  return b2`<div class="nc-history-item">
    <div class="nc-history-time">${formatTime(item.timestamp)}</div>
    <div class="nc-history-main">
      <div class="nc-history-title">
        ${historyAlertTemplate(item, options)}
        <span class=${`nc-history-badge ${historySeverity(item.type)}`}
          >${formatType(item.type)}</span
        >
        ${item.flow_id ? b2`<span class="nc-history-flow"
              >Flow ${shortFlowId(item.flow_id)}</span
            >` : ""}
      </div>
      <div class="nc-history-message">${item.message || ""}</div>
      ${summary ? b2`<div class="nc-history-summary">${summary}</div>` : ""}${item.details && Object.keys(item.details).length ? b2`<details class="nc-details">
            <summary>Details</summary>
            <pre>${JSON.stringify(item.details, null, 2)}</pre>
          </details>` : ""}
    </div>
  </div>`;
}
function historyAlertTemplate(item, options) {
  const alertName = item.alert_name || "Unknown alert";
  if (!item.alert_id) {
    return b2`<span>${alertName}</span>`;
  }
  return b2`<button
    class="nc-history-alert-link"
    @click=${() => options.onAlertSelected?.(item.alert_id, alertName)}
  >
    ${alertName}
  </button>`;
}
function emptyHistoryTemplate(options) {
  let title = "No activity yet";
  if (options.alertName) {
    title = `No activity for ${options.alertName}`;
  }
  return b2`<div class="nc-card nc-empty">
    <h2>${title}</h2>
    <p>Notification activity and debug traces will appear here.</p>
    ${options.alertName ? showAllButton(options.onShowAll, "Show all history") : ""}
  </div>`;
}
function showAllButton(onShowAll, label) {
  return b2`<button class="nc-button secondary" @click=${onShowAll}>
    ${label}
  </button>`;
}

// frontend/styles.ts
var styles = `
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

.nc-section {
  background: transparent;
}

.nc-section-content {
  padding: 0 16px 16px;
}

.nc-reminder-options {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.nc-section-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(244, 67, 54, 0.12);
  color: var(--error-color);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
}

.nc-section-status.active {
  background: rgba(76, 175, 80, 0.14);
  color: var(--success-color, #4caf50);
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

.nc-alert-icon ha-icon {
  --mdc-icon-size: 24px;
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

.nc-alert-statuses {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
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

.nc-status ha-icon {
  --mdc-icon-size: 14px;
}

.nc-status.active {
  background: rgba(244, 67, 54, 0.14);
  color: var(--error-color);
}

.nc-status.ok {
  background: rgba(76, 175, 80, 0.14);
  color: var(--success-color, #4caf50);
}

.nc-status.idle {
  background: rgba(33, 150, 243, 0.12);
  color: var(--info-color, #2196f3);
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
.nc-yaml textarea,
.nc-code-editor {
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  background: var(--card-background-color);
  color: var(--primary-text-color);
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  padding: 10px;
}

ha-code-editor.nc-code-editor {
  display: block;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}

ha-code-editor.nc-code-editor .cm-editor,
ha-code-editor.nc-code-editor .cm-scroller,
ha-code-editor.nc-code-editor .cm-content {
  max-width: 100%;
}

ha-code-editor.nc-code-editor .cm-scroller {
  overflow-x: auto;
}

.nc-history {
  display: grid;
  gap: 8px;
}

.nc-history-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0 12px;
  border-bottom: 1px solid var(--divider-color);
}

.nc-history-filter-title {
  font-weight: 700;
}

.nc-history-filter-subtitle {
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-history-item {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 13px;
  border-bottom: 1px solid var(--divider-color);
}

.nc-history-time {
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-history-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.nc-history-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-weight: 700;
}

.nc-history-alert-link {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.nc-history-alert-link:hover {
  text-decoration: underline;
}

.nc-history-message {
  min-width: 0;
}

.nc-history-summary {
  overflow: hidden;
  color: var(--secondary-text-color);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nc-history-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 700;
}

.nc-history-badge.error {
  background: rgba(244, 67, 54, 0.14);
  color: var(--error-color);
}

.nc-history-badge.success {
  background: rgba(76, 175, 80, 0.14);
  color: var(--success-color, #4caf50);
}

.nc-history-badge.info {
  background: rgba(33, 150, 243, 0.12);
  color: var(--info-color, #2196f3);
}

.nc-history-badge.muted {
  background: var(--secondary-background-color);
  color: var(--secondary-text-color);
}

.nc-history-flow {
  display: inline-flex;
  align-items: center;
  max-width: 180px;
  overflow: hidden;
  border: 1px solid var(--divider-color);
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--secondary-text-color);
  font-family: monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nc-details {
  margin-top: 6px;
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-details summary {
  cursor: pointer;
}

.nc-details pre {
  margin: 6px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: var(--secondary-background-color);
  white-space: pre-wrap;
}

.nc-yaml {
  display: grid;
  gap: 12px;
}

.nc-yaml textarea,
.nc-code-editor {
  width: 100%;
  min-height: min(650px, 70vh);
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

.nc-editor-view {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
}

.nc-editor-shell {
  background: var(--card-background-color);
  color: var(--primary-text-color);
  border-radius: 16px;
  box-shadow: var(--ha-box-shadow);
  overflow: hidden;
}

.nc-editor-shell > .nc-modal-header {
  background: var(--card-background-color);
  color: var(--primary-text-color);
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
  background: var(--secondary-background-color);
  padding: 20px;
  border-bottom: 1px solid var(--divider-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  .nc-editor-shell > .nc-modal-header {
    background: var(--card-background-color);
    color: var(--primary-text-color);
  }
  margin: 0;
}

.nc-modal-body {
  padding: 24px;
}

.nc-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 232px;
  grid-template-areas: "content sidebar";
  gap: 28px;
}

.nc-section-header {
  grid-area: sidebar;
  position: sticky;
  top: 0;
  z-index: 15;
  align-self: start;
  display: grid;
  gap: 2px;
  padding: 4px 0 4px 14px;
  border-left: 1px solid var(--divider-color);
  background: transparent;
}

.nc-section-nav-row {
  display: flex;
  align-items: center;
}

.nc-section-header .nc-section-nav-button {
  flex: 1 1 auto;
  width: 100%;
  border: 0;
  border-radius: 9px;
  padding: 10px 12px;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 7px;
}

.nc-section-header .nc-section-nav-button:hover {
  background: var(--primary-background-color);
  color: var(--primary-text-color);
}

.nc-section-header .nc-section-nav-button.active {
  background: var(--secondary-background-color);
  color: var(--primary-text-color);
  box-shadow: none;
}

.nc-section-header .nc-section-nav-button.nc-section-nav-child {
  width: calc(100% - 12px);
  margin-left: 12px;
  font-size: 12px;
}

.nc-section-collapse-button {
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
}

.nc-section-collapse-button:hover {
  background: var(--secondary-background-color);
  color: var(--primary-text-color);
}

.nc-section-collapse-button ha-icon {
  --mdc-icon-size: 18px;
}

.nc-add-setting {
  width: 100%;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  padding: 7px 28px 7px 10px;
  background: var(--card-background-color);
  color: var(--primary-text-color);
  cursor: pointer;
  font-size: 13px;
}

.nc-optional-setting[hidden] {
  display: none;
}

.nc-section-header .nc-section-status {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--error-color);
}

.nc-section-header .nc-section-status.active {
  background: var(--success-color, #4caf50);
}

.nc-section:not(.active) {
  display: none;
}

.nc-section-select {
  display: none;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  padding: 10px;
  background: var(--card-background-color);
  color: var(--primary-text-color);
}

.nc-editor-sections {
  grid-area: content;
  min-width: 0;
}

.nc-modal-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--divider-color);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.nc-yaml-utility {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--divider-color);
}

.nc-yaml-utility .nc-alert-yaml-editor {
  min-height: 360px;
}

.nc-section {
  border: 0;
  border-radius: 0;
  padding: 0;
  margin-bottom: 20px;
}

.nc-section-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.nc-section-titlebar h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.nc-section-content {
  padding: 0;
}

.nc-setting-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.nc-setting-state {
  color: var(--secondary-text-color);
  font-size: 12px;
}

.nc-icon-button {
  display: inline-grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
}

.nc-icon-button:hover {
  background: var(--secondary-background-color);
  color: var(--primary-text-color);
}

.nc-icon-button.danger:hover {
  color: var(--error-color);
}

.nc-icon-button ha-icon {
  --mdc-icon-size: 20px;
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
  background: var(--card-background-color);
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

ha-code-editor.nc-action-editor {
  --code-editor-background-color: var(--secondary-background-color);
  --code-editor-gutter-color: var(--secondary-background-color);
  display: block;
  width: 100%;
  height: auto;
  min-height: 0;
}

.nc-target-picker {
  display: grid;
  gap: 8px;
}

.nc-recipient-input {
  position: relative;
  z-index: 40;
}

.nc-section-recipient {
  position: relative;
  z-index: 30;
  overflow: visible;
}

.nc-recipient-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.nc-recipient-toolbar input {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--divider-color);
  border-radius: 9px;
  padding: 10px;
  background: var(--card-background-color);
  color: var(--primary-text-color);
}

.nc-recipient-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  grid-column: 1 / -1;
}

.nc-recipient-filter {
  border: 1px solid var(--divider-color);
  border-radius: 999px;
  padding: 5px 9px;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
  font-size: 12px;
}

.nc-recipient-filter.active,
.nc-recipient-filter:hover {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: var(--text-primary-color, white);
}

.nc-recipient-results {
  display: grid;
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  z-index: 50;
  grid-template-columns: 1fr;
  gap: 6px;
  max-height: 240px;
  overflow: auto;
  padding: 2px;
  border: 1px solid var(--divider-color);
  border-radius: 9px;
  background: var(--card-background-color);
  box-shadow: var(--ha-box-shadow);
}

.nc-recipient-results[hidden] {
  display: none;
}

.nc-recipient-option {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--primary-background-color);
  color: var(--primary-text-color);
  cursor: pointer;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nc-recipient-option:hover {
  border-color: var(--primary-color);
}

.nc-recipient-empty {
  grid-column: 1 / -1;
  padding: 12px;
  color: var(--secondary-text-color);
  text-align: center;
}

.nc-target-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 24px;
}

.nc-target-selection-label {
  color: var(--secondary-text-color);
  font-size: 12px;
  font-weight: 600;
}

.nc-target-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 7px 5px 10px;
  border-radius: 999px;
  background: var(--secondary-background-color);
  color: var(--primary-text-color);
  font-size: 13px;
}

.nc-chip-remove {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
  font-size: 0;
}

.nc-chip-remove::after {
  content: "\xD7";
  font-size: 18px;
  line-height: 1;
}



.nc-switch-input {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 42px !important;
  height: 24px;
  margin: 0;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: var(--divider-color);
  cursor: pointer;
  transition: background 0.15s ease;
}

.nc-switch-input::after {
  content: "";
  position: absolute;
  top: 4px;
  left: 4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--card-background-color);
  transition: transform 0.15s ease;
}

.nc-switch-input:checked {
  background-color: var(--primary-color);
}

.nc-switch-input:checked::after {
  transform: translateX(18px);
}

.nc-switch-input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.nc-switch-label {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  cursor: pointer;
}

.nc-confirmation-clear {
  margin-top: 16px;
}

.nc-check input:not(.nc-switch-input) {
  width: auto;
}

.nc-duration-input {
  width: 8em;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.nc-help {
  color: var(--secondary-text-color);
  font-size: 12px;
  line-height: 1.5;
}

.nc-condition-mode {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.nc-condition-mode-button {
  border: 1px solid var(--divider-color);
  border-radius: 999px;
  padding: 7px 11px;
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.nc-condition-mode-button.active,
.nc-condition-mode-button:hover {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: var(--text-primary-color, white);
}

.nc-condition-rows {
  display: grid;
  gap: 10px;
  margin-bottom: 10px;
}

.nc-condition-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  align-items: end;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  background: var(--secondary-background-color);
}

.nc-condition-row .nc-button {
  justify-self: start;
  align-self: end;
  white-space: nowrap;
}

.nc-error {
  color: var(--error-color);
  background: rgba(244, 67, 54, 0.1);
  border-radius: 9px;
  padding: 10px;
  white-space: pre-wrap;
}

.nc-toast-list {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 20000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nc-toast {
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--primary-text-color);
  color: var(--primary-background-color);
  box-shadow: var(--ha-box-shadow);
}

.nc-toast.error {
  background: var(--error-color);
  color: white;
}

@container (max-width: 700px) {
  .nc-page {
    padding: 14px;
  }

  .nc-editor-view {
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

  .nc-grid,
  .nc-condition-row,
  .nc-recipient-toolbar {
    grid-template-columns: 1fr;
  }

  .nc-modal-body {
    padding: 16px;
  }

  .nc-editor-layout {
    display: block;
  }

  .nc-section-header {
    display: none;
  }

  .nc-section-select {
    display: block;
    margin-bottom: 12px;
  }

  .nc-toolbar,
  .nc-yaml .nc-actions {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .nc-yaml .nc-actions .nc-button {
    width: 100%;
  }

  .nc-code-editor,
  ha-code-editor.nc-alert-yaml-editor {
    min-height: min(420px, 62vh);
  }

  .nc-history-item {
    grid-template-columns: 1fr;
    gap: 4px;
  }
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

  .nc-modal-body {
    padding: 16px;
  }

  .nc-editor-layout {
    display: block;
  }

  .nc-section-header {
    display: none;
  }

  .nc-section-select {
    display: block;
    margin-bottom: 12px;
  }

  .nc-toolbar,
  .nc-yaml .nc-actions {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .nc-yaml .nc-actions .nc-button {
    width: 100%;
  }

  .nc-code-editor,
  ha-code-editor.nc-alert-yaml-editor {
    min-height: min(420px, 62vh);
  }

  .nc-condition-row {
    grid-template-columns: 1fr;
  }

  .nc-recipient-toolbar {
    grid-template-columns: 1fr;
  }

  .nc-history-item {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
.nc-alert-yaml-modal {
  width: min(1000px, 100%);
  max-height: 92vh;
}

.nc-alert-yaml-editor {
  min-height: 600px;
  width: 100%;
}

ha-code-editor.nc-alert-yaml-editor {
  --code-editor-background-color: var(--secondary-background-color);
  --code-editor-gutter-color: var(--secondary-background-color);
  display: block;
  min-height: min(650px, 70vh);
}
`;

// frontend/toast.ts
var nextToastId = 0;
function showToast(host, message, error = false, duration = 3500) {
  const toast = { id: ++nextToastId, message, error };
  host.toasts = [...host.toasts, toast];
  host.requestUpdate();
  window.setTimeout(() => {
    host.toasts = host.toasts.filter((item) => item.id !== toast.id);
    host.requestUpdate();
  }, duration);
}
function toastListTemplate(toasts) {
  return b2`<div class="nc-toast-list">
    ${toasts.map(
    (toast) => b2`<div class=${toast.error ? "nc-toast error" : "nc-toast"}>
          ${toast.message}
        </div>`
  )}
  </div>`;
}

// frontend/yaml-view.ts
function codeEditor2(root) {
  const editor = root.querySelector("ha-code-editor");
  if (!editor) {
    throw new Error("YAML editor is missing.");
  }
  return editor;
}
function renderYamlView(container, hass, showToast2, refresh) {
  async function load() {
    try {
      const result = await getYaml(hass);
      editor.value = result.yaml || "";
    } catch (err) {
      showToast2(errorMessage(err), true);
    }
  }
  D(
    b2`<div class="nc-card nc-yaml">
      <div class="nc-toolbar">
        <div>
          Advanced editor. Copy this YAML to another system, edit it directly,
          or use the file at
          /config/ha_notifications.yaml.
        </div>
        <div class="nc-actions">
          <button class="nc-button secondary" @click=${copyYaml}>Copy</button>
          <button class="nc-button secondary" @click=${validateYamlText}>
            Validate
          </button>
          <button class="nc-button secondary" @click=${reloadYaml}>
            Reload
          </button>
          <button class="nc-button" @click=${saveYamlText}>Save YAML</button>
        </div>
      </div>
      <ha-code-editor
        id="nc-yaml-editor"
        class="nc-code-editor nc-yaml-editor"
        mode="yaml"
        language="yaml"
        aria-label="HA Notifications YAML"
      ></ha-code-editor>
    </div>`,
    container
  );
  const editor = codeEditor2(container);
  const readEditor = () => editor.value || "";
  async function copyYaml() {
    try {
      await navigator.clipboard.writeText(readEditor());
      showToast2("YAML copied to clipboard.");
    } catch (err) {
      showToast2(errorMessage(err), true);
    }
  }
  async function reloadYaml(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await reload(hass);
      await load();
      showToast2("YAML configuration reloaded.");
    } catch (err) {
      showToast2(errorMessage(err), true);
    } finally {
      button.disabled = false;
    }
  }
  async function validateYamlText(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await validateYaml(hass, readEditor());
      showToast2("YAML is valid.");
    } catch (err) {
      showToast2(errorMessage(err), true);
    } finally {
      button.disabled = false;
    }
  }
  async function saveYamlText(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await saveYaml(hass, readEditor());
      if (!result.saved) {
        throw new Error("The YAML was not saved.");
      }
      showToast2("YAML saved and configuration reloaded.");
      await refresh();
    } catch (err) {
      showToast2(errorMessage(err), true);
    } finally {
      button.disabled = false;
    }
  }
  void load();
}

// frontend/panel.ts
var panelTabs = [
  { key: "alerts", label: "Alerts" },
  { key: "history", label: "History" },
  { key: "yaml", label: "YAML" }
];
function alertStatus(alert) {
  let enabledStatus = {
    className: "nc-status disabled",
    icon: "mdi:pause-circle-outline",
    label: "Disabled"
  };
  if (alert.enabled) {
    enabledStatus = {
      className: "nc-status ok",
      icon: "mdi:check-circle",
      label: "Enabled"
    };
  }
  let conditionStatus = {
    className: "nc-status idle",
    icon: "mdi:circle-outline",
    label: "Idle"
  };
  if (alert.runtime?.active) {
    conditionStatus = {
      className: "nc-status active",
      icon: "mdi:alert-circle",
      label: "Triggered"
    };
  }
  return {
    enabled: enabledStatus,
    condition: conditionStatus
  };
}
function activeTabClass(active) {
  const classes = ["nc-tab"];
  if (active) {
    classes.push("active");
  }
  return classes.join(" ");
}
function toggleAlertLabel(alert) {
  if (alert.enabled) {
    return "Disable";
  }
  return "Enable";
}
function toggleAlertToast(alert) {
  if (alert.enabled) {
    return "Alert disabled.";
  }
  return "Alert enabled.";
}
function attemptSummary(alert) {
  if (!alert.confirmation?.reminders.show_attempts || !alert.runtime?.attempts) {
    return null;
  }
  return `Attempt ${alert.runtime.attempts}/${alert.confirmation.reminders.max_attempts}`;
}
var HaNotificationsPanel = class extends i4 {
  _hass = null;
  alerts = [];
  history = [];
  historyAlertId = null;
  historyAlertName = null;
  tab = "alerts";
  loading = false;
  refreshing = false;
  refreshTimer = null;
  _registries = null;
  _registriesPromise = null;
  _initialized = false;
  toasts = [];
  set hass(value) {
    this._hass = value;
    this.requestUpdate();
    if (this.isConnected && !this._initialized) {
      this._initialized = true;
      void this.refresh();
    }
  }
  get hass() {
    return this._hass;
  }
  isAdmin() {
    return Boolean(this._hass?.user?.is_admin);
  }
  connectedCallback() {
    super.connectedCallback();
    this.startAutoRefresh();
    if (this._hass) {
      this._initialized = true;
      void this.refresh();
    }
  }
  disconnectedCallback() {
    this.stopAutoRefresh();
    super.disconnectedCallback();
  }
  async getRegistries() {
    if (this._registries) {
      return this._registries;
    }
    if (!this._registriesPromise) {
      this._registriesPromise = loadRegistries(this._hass).then((registries) => {
        this._registries = registries;
        return registries;
      }).catch((err) => {
        this._registriesPromise = null;
        throw err;
      });
    }
    return this._registriesPromise;
  }
  startAutoRefresh() {
    if (this.refreshTimer !== null) {
      return;
    }
    this.refreshTimer = window.setInterval(() => {
      void this.refresh({ silent: true });
    }, 5e3);
  }
  stopAutoRefresh() {
    if (this.refreshTimer === null) {
      return;
    }
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }
  editorOpen() {
    return Boolean(
      this.renderRoot.querySelector(".nc-editor-view") || this.renderRoot.querySelector("#nc-yaml-editor")
    );
  }
  async refresh({ silent = false } = {}) {
    if (!this._hass || !this.isAdmin() || this.refreshing) {
      return;
    }
    if (silent && this.editorOpen()) {
      return;
    }
    this.refreshing = true;
    if (!silent) {
      this.loading = true;
    }
    this.requestUpdate();
    try {
      const [alertsResult, historyResult] = await Promise.allSettled([
        getAlerts(this._hass),
        getHistory(this._hass, this.historyAlertId, 150)
      ]);
      if (alertsResult.status === "fulfilled") {
        this.alerts = alertsResult.value;
        this.refreshHistoryAlertName();
      } else if (!silent) {
        this.showToast(errorMessage(alertsResult.reason), true);
      }
      if (historyResult.status === "fulfilled") {
        this.history = historyResult.value;
      } else if (!silent) {
        this.showToast(errorMessage(historyResult.reason), true);
      }
    } finally {
      this.refreshing = false;
      if (!silent) {
        this.loading = false;
      }
      this.requestUpdate();
    }
  }
  render() {
    if (!this.isAdmin()) {
      return b2`${this.styleTemplate()}${this.adminRequiredTemplate()}${toastListTemplate(
        this.toasts
      )}`;
    }
    return b2`${this.styleTemplate()}
      <div class="nc-page">
        ${this.headerTemplate()}${this.tabsTemplate()}${this.tabTemplate()}
      </div>
      ${toastListTemplate(this.toasts)}`;
  }
  updated() {
    this.renderActiveExternalView();
  }
  styleTemplate() {
    return b2`<style>
      ${styles}
    </style>`;
  }
  adminRequiredTemplate() {
    return b2`<div class="nc-page">
      <div class="nc-card nc-empty">
        <h2>Administrator access required</h2>
        <p>
          HA Notifications alerts can only be viewed and edited by Home
          Assistant administrators.
        </p>
      </div>
    </div>`;
  }
  headerTemplate() {
    return b2`<div class="nc-header">
      <div class="nc-title">
        <div class="nc-title-icon">🔔</div>
        <div>
          <h1>HA Notifications</h1>
          <p>Manage alerts, notifications and debug history.</p>
        </div>
      </div>
      <div class="nc-actions">
        <button class="nc-button" @click=${() => this.addAlert()}>
          + Add alert
        </button>
      </div>
    </div>`;
  }
  tabsTemplate() {
    return b2`<div class="nc-tabs">
      ${panelTabs.map(
      ({ key, label }) => b2`<button
            class=${activeTabClass(this.tab === key)}
            @click=${() => this.selectTab(key)}
          >
            ${label}
          </button>`
    )}
    </div>`;
  }
  tabTemplate() {
    if (this.tab === "alerts") {
      return this.alertsTemplate();
    }
    if (this.tab === "history") {
      return b2`<div id="history-view"></div>`;
    }
    return b2`<div id="yaml-view"></div>`;
  }
  alertsTemplate() {
    if (this.alerts.length) {
      return b2`<div class="nc-alerts">
        ${this.alerts.map((alert) => this.alertCardTemplate(alert))}
      </div>`;
    }
    return b2`<div class="nc-card nc-empty">
      <h2>No alerts yet</h2>
      <p>
        Create your first alert. You can trigger it from condition changes, an
        interval, or both.
      </p>
      <button class="nc-button" @click=${() => this.addAlert()}>
        Create alert
      </button>
    </div>`;
  }
  renderActiveExternalView() {
    if (!this.isAdmin()) {
      return;
    }
    if (this.tab === "history") {
      renderHistory(
        this.renderRoot.querySelector("#history-view"),
        this.history,
        {
          alertName: this.historyAlertName,
          onAlertSelected: (alertId, alertName) => this.showHistoryForAlert(alertId, alertName),
          onShowAll: () => this.showAllHistory()
        }
      );
    }
    const yamlView = this.renderRoot.querySelector("#yaml-view");
    if (this.tab === "yaml" && this._hass && yamlView && !yamlView.querySelector("#nc-yaml-editor")) {
      renderYamlView(
        yamlView,
        this._hass,
        (message, error) => this.showToast(message, error),
        () => this.refresh()
      );
    }
  }
  selectTab(tab) {
    this.tab = tab;
    this.requestUpdate();
  }
  refreshHistoryAlertName() {
    if (!this.historyAlertId) {
      return;
    }
    const alert = this.alerts.find((item) => item.id === this.historyAlertId);
    if (alert) {
      this.historyAlertName = alert.name;
    }
  }
  alertCardTemplate(alert) {
    const runtime = alert.runtime || {};
    const status = alertStatus(alert);
    const monitor = this.monitorSummary(alert);
    const lastNotification = this.lastNotificationSummary(
      runtime.last_notified
    );
    const attempts = attemptSummary(alert);
    return b2`<div class="nc-card nc-alert">
      <div class="nc-alert-icon">
        <ha-icon icon=${alert.icon || "mdi:bell-outline"}></ha-icon>
      </div>
      <div class="nc-alert-main">
        <div class="nc-alert-name">${alert.name}</div>
        <div class="nc-alert-statuses">
          <span class=${status.enabled.className}
            ><ha-icon icon=${status.enabled.icon}></ha-icon>${status.enabled.label}</span
          >
          <span class=${status.condition.className}
            ><ha-icon icon=${status.condition.icon}></ha-icon>${status.condition.label}</span
          >
        </div>
        <div class="nc-alert-meta">
          ${monitor} · ${this.targetSummary(alert.notification?.target)}
        </div>
        <div class="nc-alert-meta">${lastNotification}</div>
        ${attempts ? b2`<div class="nc-alert-meta">${attempts}</div>` : ""}
      </div>
      <div class="nc-alert-actions">
        <button
          class="nc-button"
          ?disabled=${!alert.enabled}
          @click=${() => this.testAlertFromCard(alert)}
        >
          Test</button
        ><button class="nc-button" @click=${() => this.toggleAlert(alert)}>
          ${toggleAlertLabel(alert)}</button
        ><button class="nc-button" @click=${() => this.editAlert(alert)}>
          Edit</button
        ><button class="nc-button" @click=${() => this.showAlertHistory(alert)}>
          History</button
        ><button
          class="nc-button danger"
          @click=${() => this.removeAlert(alert)}
        >
          Delete
        </button>
      </div>
    </div>`;
  }
  monitorSummary(alert) {
    const parts = [];
    if (alert.monitor?.on_change) {
      parts.push("condition changes");
    }
    if (alert.monitor?.interval) {
      parts.push(`every ${alert.monitor.interval}`);
    }
    const summary = parts.join(" + ");
    if (summary) {
      return summary;
    }
    return "No trigger";
  }
  lastNotificationSummary(lastNotified) {
    if (lastNotified) {
      return `Last notification: ${this.formatTime(lastNotified)}`;
    }
    return "No notification sent yet";
  }
  targetSummary(target = {}) {
    const parts = [];
    for (const [key, label] of [
      ["device_id", "devices"],
      ["area_id", "areas"],
      ["floor_id", "floors"],
      ["label_id", "labels"],
      ["entity_id", "entities"]
    ]) {
      const count = target[key]?.length || 0;
      if (count) {
        parts.push(`${count} ${label}`);
      }
    }
    return parts.join(", ") || "No target";
  }
  addAlert = async () => {
    let registries;
    try {
      registries = await this.getRegistries();
    } catch (err) {
      this.showToast(errorMessage(err), true);
      return;
    }
    openEditor({
      root: this.renderRoot,
      alert: null,
      registries,
      onTest: async (draft) => {
        const result = await testAlertPayload(this._hass, draft);
        this.showToast("Draft test notification sent.");
        return result;
      },
      onValidateCondition: async (draft) => {
        await validateConditions(this._hass, draft);
        this.showToast("Condition is valid.");
      },
      onDiscardTest: async (sessionId) => {
        await discardDraftTestPayload(this._hass, sessionId);
      },
      onSave: async (alert) => {
        const saved = await saveAlert(this._hass, alert);
        this.showToast("Alert created.");
        return saved;
      },
      onSaved: async () => {
        await this.refresh();
      }
    });
  };
  async editAlert(alert) {
    let registries;
    try {
      registries = await this.getRegistries();
    } catch (err) {
      this.showToast(errorMessage(err), true);
      return;
    }
    openEditor({
      root: this.renderRoot,
      alert,
      registries,
      onTest: async (draft) => {
        const result = await testAlertPayload(this._hass, draft);
        this.showToast("Draft test notification sent.");
        return result;
      },
      onValidateCondition: async (draft) => {
        await validateConditions(this._hass, draft);
        this.showToast("Condition is valid.");
      },
      onDiscardTest: async (sessionId) => {
        await discardDraftTestPayload(this._hass, sessionId);
      },
      onSave: async (updated) => {
        const saved = await saveAlert(this._hass, updated);
        this.replaceSavedAlert(saved);
        this.showToast("Alert saved.");
        return saved;
      },
      onSaved: async () => {
        await this.refresh();
      }
    });
  }
  replaceSavedAlert(saved) {
    this.alerts = this.alerts.map((item) => {
      if (item.id === saved.id) {
        return {
          ...item,
          ...saved,
          runtime: item.runtime
        };
      }
      return item;
    });
    this.requestUpdate();
  }
  async testAlertFromCard(alert) {
    try {
      await testAlert(this._hass, alert.id);
      this.showToast("Test notification sent.");
      await this.refresh();
    } catch (err) {
      this.showToast(errorMessage(err), true);
    }
  }
  async showAlertHistory(alert) {
    await this.showHistoryForAlert(alert.id, alert.name);
  }
  async showHistoryForAlert(alertId, alertName) {
    if (!this._hass) {
      return;
    }
    this.historyAlertId = alertId;
    this.historyAlertName = alertName;
    this.tab = "history";
    this.loading = true;
    this.requestUpdate();
    try {
      this.history = await getHistory(this._hass, alertId, 150);
    } catch (err) {
      this.showToast(errorMessage(err), true);
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }
  async showAllHistory() {
    if (!this._hass) {
      return;
    }
    this.historyAlertId = null;
    this.historyAlertName = null;
    this.tab = "history";
    this.loading = true;
    this.requestUpdate();
    try {
      this.history = await getHistory(this._hass, null, 150);
    } catch (err) {
      this.showToast(errorMessage(err), true);
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }
  async toggleAlert(alert) {
    try {
      await saveAlert(this._hass, { ...alert, enabled: !alert.enabled });
      this.showToast(toggleAlertToast(alert));
      await this.refresh();
    } catch (err) {
      this.showToast(errorMessage(err), true);
    }
  }
  async removeAlert(alert) {
    if (!window.confirm(`Delete "${alert.name}"?`)) {
      return;
    }
    try {
      await deleteAlert(this._hass, alert.id);
      this.showToast("Alert deleted.");
      await this.refresh();
    } catch (err) {
      this.showToast(errorMessage(err), true);
    }
  }
  formatTime(value) {
    if (!value) {
      return "\u2014";
    }
    try {
      return new Intl.DateTimeFormat(void 0, {
        dateStyle: "short",
        timeStyle: "short"
      }).format(new Date(value));
    } catch (_err) {
      return value;
    }
  }
  showToast(message, error = false) {
    showToast(this, message, error);
  }
};
if (!customElements.get("ha-notifications-panel")) {
  customElements.define("ha-notifications-panel", HaNotificationsPanel);
}
var HaNotificationsCard = class extends HaNotificationsPanel {
  config = null;
  setConfig(config) {
    if (!config || config.type !== "custom:ha-notifications-card") {
      throw new Error("Card type must be custom:ha-notifications-card.");
    }
    this.config = config;
    this.requestUpdate();
  }
  getCardSize() {
    return 12;
  }
  static getStubConfig() {
    return { type: "custom:ha-notifications-card" };
  }
};
if (!customElements.get("ha-notifications-card")) {
  customElements.define("ha-notifications-card", HaNotificationsCard);
}
var customCardWindow = window;
customCardWindow.customCards = customCardWindow.customCards || [];
if (!customCardWindow.customCards.some(
  (card) => card.type === "ha-notifications-card"
)) {
  customCardWindow.customCards.push({
    type: "ha-notifications-card",
    name: "HA Notifications",
    description: "Manage HA Notifications alerts, history, and YAML."
  });
}
/*! Bundled license information:

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/reactive-element.js:
lit-html/lit-html.js:
lit-element/lit-element.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
