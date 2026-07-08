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

function setTab(id) { APP.activeTab = id; render(); }
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

function handleConn(act) {
  if (act === "connect") {
    APP.connection = "connecting";
    render();
    setTimeout(() => { APP.connection = "connected"; render(); toast("Device connected"); }, 1100);
  } else if (act === "disconnect") {
    APP.connection = "disconnected"; render(); toast("Device disconnected");
  } else if (act === "save") {
    toast("Configuration saved to device");
  } else if (act === "load") {
    toast("Configuration loaded from device");
  }
}

function boot() {
  APP.connection = "connected"; // start connected so the prototype is immediately explorable
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
