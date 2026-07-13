/* ============================================================
   HID Remapper VX — App shell, tabs, connection, orchestration
   ============================================================ */
(function () {
const { APP } = window.HRX_STATE;
const { h, $, $$, toast } = window.HRX;

/* ---- TABS (consolidated proposal) ----
   Primary: Mappings · Quick Start · Monitor · Settings
   Advanced ▾ menu: Macros · Expressions (as-is) · Actions
*/
const PRIMARY_TABS = [
  { id: "mappings", label: "Mappings", icon: ICON.chip },
  { id: "quick", label: "Quick Start", icon: ICON.bolt },
  { id: "monitor", label: "Monitor", icon: ICON.activity },
  { id: "settings", label: "Settings", icon: ICON.settings },
];
const ADVANCED_TABS = [
  { id: "macros", label: "Macros", icon: ICON.macro },
  { id: "expressions", label: "Expressions", icon: ICON.fx },
  { id: "actions", label: "Actions", icon: ICON.file },
];

function renderTopbar() {
  return `
  <div class="topbar">
    <div class="brand">
      <div class="brand-glyph">${ICON.chip}</div>
      <div>
        <div class="brand-name">HID Remapper VX</div>
        <div class="brand-tag">Web Config</div>
      </div>
    </div>
    <div class="topbar-spacer"></div>
    <div class="conn-actions" id="connActions"></div>
  </div>`;
}

function connButtons() {
  if (APP.connection === "connected") {
    return `
      <button class="btn-hx btn-ghost" data-act="load">${ICON.download}<span>Load from device</span></button>
      <button class="btn-hx btn-primary" data-act="save">${ICON.save}<span>Save to device</span></button>
      <button class="btn-hx" data-act="disconnect">${ICON.plug}<span>Disconnect</span></button>`;
  }
  if (APP.connection === "connecting") {
    return `<button class="btn-hx btn-primary" disabled>${ICON.plug}<span>Connecting…</span></button>`;
  }
  return `<button class="btn-hx btn-primary" data-act="connect">${ICON.plug}<span>Open device</span></button>`;
}

function renderDeviceBar() {
  const c = APP.connection;
  const pill = c === "connected"
    ? `<span class="conn-pill on"><span class="conn-dot"></span>Connected</span>`
    : c === "connecting"
    ? `<span class="conn-pill connecting"><span class="conn-dot"></span>Connecting…</span>`
    : `<span class="conn-pill off"><span class="conn-dot"></span>No device</span>`;

  if (c !== "connected") {
    return `
    <div class="device-bar">
      <div class="seg" style="flex-direction:row;align-items:center;gap:12px">
        <div class="device-glyph">${ICON.tv}</div>
        <div>
          <div class="seg-value">No device connected</div>
          <div class="seg-label" style="text-transform:none;letter-spacing:0;font-family:var(--font-ui);font-size:12px">Plug in your remapper and click “Open device” — Chrome will show a picker.</div>
        </div>
      </div>
      <div class="topbar-spacer"></div>
      <div class="seg" style="border-right:none">${pill}</div>
    </div>`;
  }
  const d = APP.device;
  return `
  <div class="device-bar">
    <div class="seg" style="flex-direction:row;align-items:center;gap:11px">
      <div class="device-glyph">${ICON.tv}</div>
      <div><div class="seg-label">Device name</div><input id="deviceName" class="device-name-input" value="${d.name}" maxlength="64" spellcheck="false" autocomplete="off" placeholder="Name this device"></div>
    </div>
    <div class="seg"><div class="seg-label">VID:PID</div><div class="seg-value mono">${d.vidpid}</div></div>
    <div class="seg"><div class="seg-label">Firmware</div><div class="seg-value mono">${d.firmware}</div></div>
    <div class="seg"><div class="seg-label">Output Profile</div><div class="seg-value">${d.profile}</div></div>
    <div class="topbar-spacer"></div>
    <div class="seg" style="border-right:none">${pill}</div>
  </div>`;
}

function renderTabs() {
  const tabsHtml = PRIMARY_TABS.concat(ADVANCED_TABS).map((t) => {
    const active = APP.activeTab === t.id ? "active" : "";
    const count = t.count ? `<span class="tab-count">${t.count()}</span>` : "";
    return `<button class="tab ${active}" data-tab="${t.id}">${t.icon}<span>${t.label}</span>${count}</button>`;
  }).join("");

  return `<div class="tabs">${tabsHtml}</div>`;
}

function renderConfigHeader() {
  return `
  <div class="config-header">
    <div class="ch-main">
      <div class="ch-kicker">Configuration</div>
      <input id="configTitle" class="config-title-input" value="${APP.config.title}" spellcheck="false" autocomplete="off" placeholder="Name this configuration">
    </div>
  </div>`;
}

/* ---- main render ---- */
function render() {
  const app = $("#app");
  app.innerHTML = `
    ${renderTopbar()}
    <div class="app-shell">
      ${renderConfigHeader()}
      ${renderDeviceBar()}
      ${renderTabs()}
      <div id="tabContent"></div>
    </div>`;
  renderConnActions();
  renderActiveTab();
  wireShell();
}

function renderConnActions() { $("#connActions").innerHTML = connButtons(); }

function renderActiveTab() {
  const c = $("#tabContent");
  switch (APP.activeTab) {
    case "mappings": return window.renderMappings(c);
    case "quick": return window.renderQuickActions(c);
    case "monitor": return window.renderMonitor(c);
    case "settings": return window.renderSettings(c);
    case "macros": return window.renderMacros(c);
    case "expressions": return window.renderExpressions(c);
    case "actions": return window.renderActions(c);
  }
}

function setTab(id) {
  // turn the live monitor stream off when leaving the Monitor tab
  if (APP.activeTab === "monitor" && id !== "monitor" && window.HRX_DEVICE && window.HRX_DEVICE.isConnected()) {
    window.HRX_DEVICE.setMonitorEnabled(false).catch(() => {});
  }
  APP.activeTab = id;
  render();
}
window.HRX.setTab = setTab;
window.HRX.rerenderTab = () => { renderActiveTab(); };
window.HRX.connect = () => handleConn("connect");

function wireShell() {
  $$('[data-tab]').forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $$('#connActions [data-act]').forEach((b) => b.addEventListener("click", () => handleConn(b.dataset.act)));

  const ct = $("#configTitle");
  if (ct) ct.addEventListener("input", () => { APP.config.title = ct.value; });
  const dn = $("#deviceName");
  if (dn) dn.addEventListener("input", () => { APP.device.name = dn.value; });
}

// emulated-output profiles, indexed by our_descriptor_number (shared with Settings)
const PROFILE_NAMES = window.HRX_STATE.PROFILES;

// Has the config in APP come FROM the connected device?
//
// This matters because saveToDevice() sends CLEAR_MACROS / CLEAR_EXPRESSIONS / CLEAR_QUIRKS
// and then writes whatever APP holds. The Macros tab has no editor yet and state.js ships
// sample expressions, so saving a never-loaded APP would ERASE the device's macros and
// overwrite its expressions with samples. We therefore load on connect, and refuse to save
// until a load has succeeded.
let deviceLoaded = false;

// Fold a device `config` (from device.js) back into the shared APP object in place.
// APP is a const reference held by every module, so we mutate rather than reassign.
function applyDeviceConfig(config) {
  const next = window.HRX_TRANSLATE.configToApp(config, APP, window.HRX_STATE.uid);
  Object.assign(APP, next);
  APP.device.profile = PROFILE_NAMES[config.our_descriptor_number] || ("Profile " + (config.our_descriptor_number || 0));
}

async function handleConn(act) {
  const dev = window.HRX_DEVICE;
  if (act === "connect") {
    if (!navigator.hid) { toast("WebHID needs desktop Chrome or Edge"); return; }
    APP.connection = "connecting"; render();
    try {
      const info = await dev.connect();
      if (!info) { APP.connection = "disconnected"; render(); toast("No device selected"); return; }
      APP.device.name = info.name;
      APP.device.vidpid = info.vidpid;
      APP.device.firmware = info.firmware;
      if (!APP.device.profile) APP.device.profile = "—";
      APP.connection = "connected";
      deviceLoaded = false;

      // Pull the device's real config immediately, so what you see (and what a later Save
      // writes back) is the device's own state — not this page's sample data.
      try {
        const config = await dev.loadFromDevice();
        applyDeviceConfig(config);
        deviceLoaded = true;
        render();
        toast("Connected to " + info.name + " — loaded " + ((config.mappings && config.mappings.length) || 0) + " mappings");
      } catch (e) {
        render();
        toast("Connected to " + info.name + ", but the load failed: " + String((e && e.message) || e) + " — saving is blocked until a load succeeds");
      }
    } catch (e) {
      APP.connection = "disconnected"; deviceLoaded = false; render();
      toast(String((e && e.message) || e));
    }
  } else if (act === "disconnect") {
    try { await dev.disconnect(); } catch (e) {}
    APP.connection = "disconnected"; deviceLoaded = false; render(); toast("Device disconnected");
  } else if (act === "load") {
    if (!dev.isConnected()) { toast("Connect a device first"); return; }
    try {
      const config = await dev.loadFromDevice();
      applyDeviceConfig(config);
      deviceLoaded = true;
      render();
      toast("Loaded " + ((config.mappings && config.mappings.length) || 0) + " mappings from device");
    } catch (e) { toast("Load failed: " + String((e && e.message) || e)); }
  } else if (act === "save") {
    if (!dev.isConnected()) { toast("Connect a device first"); return; }
    if (!deviceLoaded) {
      // guard: see the deviceLoaded comment above — this would wipe the device's macros
      toast("Load from the device first — saving now would erase its macros and expressions");
      return;
    }
    try {
      const combos = APP.mappings.filter((m) => (m.inputs || []).length > 1).length;
      const config = window.HRX_TRANSLATE.appToConfig(APP, { forDevice: true });
      const res = await dev.saveToDevice(config);
      if (res && res.ok) {
        const n = (config.mappings && config.mappings.length) || 0;
        toast(combos
          ? ("Saved " + n + " mappings — " + combos + " combo(s) kept in config, not sent (firmware has no combo support)")
          : ("Saved " + n + " mappings to device"));
      } else {
        toast("Save failed: " + ((res && res.error) || "unknown"));
      }
    } catch (e) { toast("Save failed: " + String((e && e.message) || e)); }
  }
}

function boot() {
  // Start disconnected (honest): the sample mappings still render so the tool is
  // fully explorable/editable offline; "Open device" runs real WebHID.
  APP.connection = "disconnected";
  render();
}
// Fire immediately if the DOM is already parsed (e.g. when scripts are injected
// after load, as in the bundled standalone file); otherwise wait for it.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
})();
