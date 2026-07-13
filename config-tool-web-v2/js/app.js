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
  { id: "quirks", label: "Quirks", icon: ICON.wrench },
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
    case "quirks": return window.renderQuirks(c);
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

// Where did the config currently in APP come from?
//
// This matters because saveToDevice() sends CLEAR_MAPPING / CLEAR_MACROS / CLEAR_EXPRESSIONS /
// CLEAR_QUIRKS and then writes whatever APP holds. So a config that did NOT come from the device
// can silently erase the device's macros/expressions/quirks — the page has no macro editor yet,
// and an imported file may not carry them at all.
//
//   "empty"   - boot state. The page ships with NO config at all: no mappings, no macros, no
//               expressions. Nothing on screen is invented.
//   "device"  - loaded from the connected device. Safe to save.
//   "json"    - imported or hand-edited. Savable, but only after the user confirms, because it
//               may not carry the device's macros or quirks.
let configSource = "empty";
window.HRX.setConfigSource = (src) => { configSource = src; };
window.HRX.getConfigSource = () => configSource;

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

      // The page boots empty, so on connect we pull the device's real config straight away —
      // what you see IS the device. The one exception: if you authored something offline (or
      // imported a file), we must not silently throw it away, so we keep it and let you decide.
      const hasLocalWork = configSource !== "device" && APP.mappings.length > 0;
      if (hasLocalWork) {
        render();
        toast("Connected to " + info.name + " — your unsaved config is still here. Click “Load from device” to replace it with the device's.");
        return;
      }

      configSource = "empty";
      try {
        const config = await dev.loadFromDevice();
        applyDeviceConfig(config);
        configSource = "device";
        render();
        toast("Connected to " + info.name + " — loaded " + ((config.mappings && config.mappings.length) || 0) + " mappings");
      } catch (e) {
        render();
        toast("Connected to " + info.name + ", but the load failed: " + String((e && e.message) || e) + " — saving is blocked until a load succeeds");
      }
    } catch (e) {
      APP.connection = "disconnected"; configSource = "empty"; render();
      toast(String((e && e.message) || e));
    }
  } else if (act === "disconnect") {
    try { await dev.disconnect(); } catch (e) {}
    APP.connection = "disconnected"; render(); toast("Device disconnected");
  } else if (act === "load") {
    if (!dev.isConnected()) { toast("Connect a device first"); return; }
    try {
      const config = await dev.loadFromDevice();
      applyDeviceConfig(config);
      configSource = "device";
      render();
      toast("Loaded " + ((config.mappings && config.mappings.length) || 0) + " mappings from device");
    } catch (e) { toast("Load failed: " + String((e && e.message) || e)); }
  } else if (act === "save") {
    if (!dev.isConnected()) { toast("Connect a device first"); return; }
    // A save CLEARS and rewrites everything on the device (mappings, macros, expressions,
    // quirks). So: never save an empty page over a device, and confirm anything that did not
    // come from the device itself — it may not carry that device's macros or quirks.
    if (configSource !== "device" && APP.mappings.length === 0) {
      toast("Nothing to save — load from the device, or import a config, first");
      return;
    }
    if (configSource !== "device") {
      const ok = window.confirm(
        "This config did not come from the device.\n\n" +
        "Saving REPLACES the device's mappings, macros, expressions and quirks with what is on " +
        "this page. Anything this page does not carry will be erased.\n\n" +
        "Tip: click “Load from device” first if you only meant to change a few mappings.\n\nSave anyway?");
      if (!ok) { toast("Save cancelled"); return; }
    }
    // A usage the device reports at a CONSTANT non-zero value is a vendor field, not a control.
    // In a combo it is fatal: its "press" happened once at enumeration and never again, so the
    // timing window can never be satisfied and the combo can NEVER fire — silently. Refuse.
    const stuck = window.HRX_MON_STUCK || new Set();
    if (stuck.size) {
      const bad = APP.mappings.filter((m) => (m.inputs || []).some((u) => stuck.has(u)));
      if (bad.length) {
        const list = bad.map((m) => (m.inputs || []).filter((u) => stuck.has(u)).join(", ")).join("; ");
        const ok = window.confirm(
          "These mappings use a usage your device reports as a CONSTANT value: " + list + ".\n\n" +
          "That is a vendor field, not a button — it never goes up or down. A combo built on it " +
          "can NEVER fire, and with Consume on it will interfere with the other keys in it.\n\n" +
          "Remove it (recommended), or save anyway?\n\nOK = save anyway   Cancel = go back and fix it");
        if (!ok) { toast("Save cancelled — remove the constant usage from the highlighted rows"); return; }
      }
    }
    try {
      const config = window.HRX_TRANSLATE.appToConfig(APP, { forDevice: true });
      const res = await dev.saveToDevice(config);
      if (res && res.ok) {
        const n = (config.mappings && config.mappings.length) || 0;
        let msg = "Saved " + n + " mappings to device";
        // never drop a combo silently — say so
        if (config.combo_skipped) {
          msg += " — " + config.combo_skipped + " combo(s) NOT sent (Combos are switched off in Settings)";
        }
        if (config.combo_overflow) {
          msg += " — " + config.combo_overflow + " combo(s) NOT sent (the firmware holds at most " +
            window.HRX_TRANSLATE.NCOMBOS + ")";
        }
        if (config.incomplete) {
          msg += " — " + config.incomplete + " unfinished row(s) NOT sent (pick their output, " +
            "and every key of a combo)";
        }
        toast(msg);
      } else {
        toast("Save failed: " + ((res && res.error) || "unknown"));
      }
    } catch (e) { toast("Save failed: " + String((e && e.message) || e)); }
  }
}

// The device was physically unplugged. Say so instead of continuing to claim "Connected"
// and then failing deep inside the protocol on the next save.
if (window.HRX_DEVICE && window.HRX_DEVICE.onDisconnect) {
  window.HRX_DEVICE.onDisconnect(() => {
    APP.connection = "disconnected";
    configSource = "json";  // what's on screen came from the device, but the device is gone now
    render();
    toast("Device unplugged — your config is still here. Reconnect to save it.");
  });
}

// Back to top (v1 parity) — the mappings list gets long. One button, appended once, shown only
// once you have actually scrolled.
function mountBackToTop() {
  if (document.getElementById("backToTop")) return;
  const btn = h(`<button id="backToTop" class="back-to-top" title="Back to top">${ICON.up}</button>`);
  document.body.appendChild(btn);
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  const sync = () => btn.classList.toggle("show", window.scrollY > 260);
  window.addEventListener("scroll", sync, { passive: true });
  sync();
}

function boot() {
  mountBackToTop();
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
