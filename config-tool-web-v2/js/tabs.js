/* ============================================================
   HID Remapper VX — Settings · Monitor · Macros · Expressions · Actions
   ============================================================ */
(function () {
  const { APP } = window.HRX_STATE;
  const { $, $$, toast } = window.HRX;

  /* ---------------- SETTINGS ---------------- */
  const EMU = window.HRX_STATE.PROFILES; // index = our_descriptor_number

  window.renderSettings = function (container) {
    const s = APP.settings;
    const emuOpts = EMU.map((e, i) => `<option value="${i}" ${i === s.emulatedDevice ? "selected" : ""}>${e}</option>`).join("");
    const passToggles = s.passthrough.map((on, i) =>
      `<div class="toggle-row" style="margin-bottom:7px"><span class="toggle ${on ? "on" : ""}" data-pass="${i}"></span><span>Layer ${i}</span></div>`
    ).join("");

    container.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div><div class="panel-title">Settings</div><div class="panel-sub">Device-wide behavior. Advanced users can edit the raw config.</div></div>
        <button class="btn-hx btn-sm" id="editJson" style="margin-left:auto">${ICON.file}<span>Edit config JSON</span></button>
      </div>
      <div class="panel-body">
      <div class="settings-grid">
        <div class="setting-card">
          <div class="sc-label">Emulated device type</div>
          <div class="sc-help">What the remapper presents itself as to the host.</div>
          <select class="select-hx" style="width:100%" id="emu">${emuOpts}</select>
        </div>

        <div class="setting-card highlight">
          <div class="sc-label">Combo timing window <span class="section-tag" style="margin-left:6px">New</span></div>
          <div class="sc-help">All keys in a combo must be pressed within this window to trigger it.</div>
          <div style="display:flex;align-items:center;gap:9px">
            <input class="input-hx" type="number" min="10" max="250" value="${s.comboWindow}" id="comboWin" style="width:90px;font-family:var(--font-mono)">
            <span class="hint">milliseconds (10–250)</span>
          </div>
        </div>

        <div class="setting-card">
          <div class="sc-label">Tap-hold threshold</div>
          <div class="sc-help">Global timing that separates a tap from a hold.</div>
          <div style="display:flex;align-items:center;gap:9px">
            <input class="input-hx" type="number" min="0" value="${s.tapHold}" id="tapHold" style="width:90px;font-family:var(--font-mono)">
            <span class="hint">milliseconds</span>
          </div>
        </div>

        <div class="setting-card">
          <div class="sc-label">Partial scroll timeout</div>
          <div class="sc-help">How long partial scroll accumulation persists.</div>
          <div style="display:flex;align-items:center;gap:9px">
            <input class="input-hx" type="number" min="0" value="${s.scrollTimeout}" id="scrollTimeout" style="width:90px;font-family:var(--font-mono)">
            <span class="hint">milliseconds</span>
          </div>
        </div>

        <div class="setting-card">
          <div class="sc-label">Interval override</div>
          <div class="sc-help">USB polling interval. 0 keeps the device default.</div>
          <input class="input-hx" type="number" min="0" max="255" value="${s.interval}" id="interval" style="width:90px;font-family:var(--font-mono)">
        </div>

        <div class="setting-card">
          <div class="sc-label">Unmapped passthrough</div>
          <div class="sc-help">Pass keys with no mapping straight through, per layer.</div>
          ${passToggles}
        </div>
      </div>
    </div></div>`;

    $("#emu", container).addEventListener("change", (e) => {
      s.emulatedDevice = +e.target.value;
      APP.device.profile = EMU[s.emulatedDevice] || ("Profile " + s.emulatedDevice);
      toast("Emulated device: " + EMU[s.emulatedDevice]);
    });
    $("#comboWin", container).addEventListener("change", (e) => {
      let v = Math.round(+e.target.value || 50);
      v = Math.max(10, Math.min(250, v));
      s.comboWindow = v; e.target.value = v;
    });
    const numField = (id, key, min, max) => {
      const el = $("#" + id, container);
      if (!el) return;
      el.addEventListener("change", (e) => {
        let v = Math.round(+e.target.value || 0);
        if (min != null) v = Math.max(min, v);
        if (max != null) v = Math.min(max, v);
        s[key] = v; e.target.value = v;
      });
    };
    numField("tapHold", "tapHold", 0, null);
    numField("scrollTimeout", "scrollTimeout", 0, null);
    numField("interval", "interval", 0, 255);
    $$('[data-pass]', container).forEach((t) => t.addEventListener("click", () => { const i = +t.dataset.pass; s.passthrough[i] = !s.passthrough[i]; t.classList.toggle("on"); }));
    const ej = $("#editJson", container);
    if (ej && window.openConfigJson) ej.addEventListener("click", () => window.openConfigJson());
  };

  /* ---------------- MONITOR (live input reports from the device) ---------------- */
  const monData = new Map(); // `${usage}_${hub_port}` -> { usage, name, hub_port, last, min, max }
  let monRegistered = false;

  // fed by device.js -> HRX_DEVICE.onMonitor(cb); cb gets { usage, value, hub_port }
  function monIngest(rec) {
    const key = rec.usage + "_" + rec.hub_port;
    let row = monData.get(key);
    if (!row) {
      const name = (window.HRX_USAGES && window.HRX_USAGES.usageName(rec.usage)) || rec.usage;
      row = { usage: rec.usage, name, hub_port: rec.hub_port, last: rec.value, min: rec.value, max: rec.value };
      monData.set(key, row);
    }
    row.last = rec.value;
    if (rec.value < row.min) row.min = rec.value;
    if (rec.value > row.max) row.max = rec.value;
    if (APP.activeTab === "monitor") paintMon();
  }

  window.renderMonitor = function (container) {
    if (APP.connection !== "connected") {
      container.innerHTML = `
      <div class="panel"><div class="panel-body">
        <div class="state-hero">
          <div class="sh-glyph">${ICON.activity}</div>
          <h4>No device to monitor</h4>
          <p>Live HID activity appears here once a remapper is connected. Plug in your device and open it — then press buttons on your remote to see them stream in.</p>
          <button class="btn-hx btn-primary" id="monConnect">${ICON.plug}<span>Open device</span></button>
        </div>
      </div></div>`;
      const mc = $("#monConnect", container);
      if (mc && window.HRX.connect) mc.addEventListener("click", () => window.HRX.connect());
      return;
    }
    // register once, then turn the live stream on while this tab is visible
    if (!monRegistered && window.HRX_DEVICE) { window.HRX_DEVICE.onMonitor(monIngest); monRegistered = true; }
    if (window.HRX_DEVICE) window.HRX_DEVICE.setMonitorEnabled(true).catch(() => {});

    container.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div><div class="panel-title">Monitor</div><div class="panel-sub">Live HID activity from the connected device. Press buttons on your remote to see them here.</div></div>
        <button class="btn-hx btn-ghost btn-sm" id="monClear" style="margin-left:auto">Clear</button>
      </div>
      <div class="panel-body">
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>
            ${["Usage code", "Usage name", "Last value", "Min", "Max", ""].map((th) => `<th style="text-align:left;padding:9px 12px;font-family:var(--font-mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--label);border-bottom:1px solid var(--border)">${th}</th>`).join("")}
          </tr></thead>
          <tbody id="monBody"></tbody>
        </table>
        </div>
      </div>
    </div>`;
    paintMon();
    $("#monClear", container).addEventListener("click", () => { monData.clear(); paintMon(); toast("Monitor cleared"); });
  };

  function paintMon() {
    const body = $("#monBody");
    if (!body) return;
    const rows = Array.from(monData.values());
    body.innerHTML = rows.map(rowMon).join("") ||
      `<tr><td colspan="6" style="padding:26px;text-align:center;color:var(--label)">Press a key on your device…</td></tr>`;
    $$('#monBody [data-mkmap]').forEach((b) => b.addEventListener("click", () => {
      APP.mappings.push(window.HRX_STATE.mk(b.dataset.code, "0x00000000"));
      toast(`Mapping created from ${b.dataset.name}`);
    }));
  }
  function rowMon(r) {
    return `<tr>
      <td style="padding:9px 12px;font-family:var(--font-mono);color:var(--text-strong);border-bottom:1px solid var(--border-soft)">${r.usage}</td>
      <td style="padding:9px 12px;color:var(--text-strong);border-bottom:1px solid var(--border-soft)">${r.name}</td>
      <td style="padding:9px 12px;font-family:var(--font-mono);border-bottom:1px solid var(--border-soft)">${r.last}</td>
      <td style="padding:9px 12px;font-family:var(--font-mono);border-bottom:1px solid var(--border-soft)">${r.min}</td>
      <td style="padding:9px 12px;font-family:var(--font-mono);border-bottom:1px solid var(--border-soft)">${r.max}</td>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border-soft)"><button class="icon-btn" data-mkmap="1" data-code="${r.usage}" data-name="${r.name}" title="Create mapping">${ICON.plus}</button></td>
    </tr>`;
  }

  /* ---------------- MACROS (32 slots, accordion) ---------------- */
  const MACRO_PREVIEW = [
    "Left Ctrl ↓ · C · Left Ctrl ↑",
    "AC Home · 200ms · Menu Select",
    "(empty)",
  ];
  let openMacro = -1;

  window.renderMacros = function (container) {
    const slots = Array.from({ length: 32 }, (_, i) => {
      const preview = MACRO_PREVIEW[i] || "(empty)";
      const open = openMacro === i;
      return `
      <div style="border:1px solid var(--border-bright);border-radius:var(--radius-sm);margin-bottom:8px;overflow:hidden;background:var(--bg-deep)">
        <button class="btn-hx" data-macro="${i}" style="width:100%;justify-content:flex-start;border:none;border-radius:0;background:${open ? "var(--hover)" : "transparent"};padding:12px 14px">
          <span style="font-family:var(--font-mono);color:var(--purple-hi);min-width:54px">Macro ${i}</span>
          <span style="color:${preview === "(empty)" ? "var(--label)" : "var(--text-strong)"};font-weight:500">${preview}</span>
          <span style="margin-left:auto;display:flex;gap:6px">
            <span class="icon-btn" title="Clone">${ICON.clone}</span>
            <span style="transform:rotate(${open ? 180 : 0}deg);transition:transform .15s;display:grid;place-items:center">${ICON.chevron}</span>
          </span>
        </button>
        ${open ? macroBody() : ""}
      </div>`;
    }).join("");

    container.innerHTML = `
    <div class="panel">
      <div class="panel-head"><div><div class="panel-title">Macros</div><div class="panel-sub">32 slots. Each macro is a sequence of usages with durations.</div></div></div>
      <div class="panel-body">${slots}</div>
    </div>`;

    $$('[data-macro]', container).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.macro; openMacro = openMacro === i ? -1 : i; window.renderMacros($("#tabContent"));
    }));
  };
  function macroBody() {
    const step = (u, d) => `
      <div style="display:flex;gap:9px;align-items:center;padding:8px 14px">
        <button class="usage-btn" style="--cat:var(--purple-hi);max-width:280px"><span class="u-cat-dot"></span><span class="u-name">${u}</span><span class="chev">${ICON.chevron}</span></button>
        <input class="input-hx" value="${d}" style="width:90px;font-family:var(--font-mono)">
        <span class="hint">ms</span>
        <button class="icon-btn del" style="margin-left:auto">${ICON.x}</button>
      </div>`;
    return `<div style="border-top:1px solid var(--border-soft);padding:6px 0">
      ${step("Left Ctrl", 0)}${step("C", 50)}
      <div style="padding:8px 14px"><button class="btn-hx btn-ghost btn-sm">${ICON.plus}<span>Add step</span></button></div>
    </div>`;
  }

  /* ---------------- EXPRESSIONS ----------------
     Rendered by js/expressions.js, which defines window.renderExpressions
     (visual block builder + RPN code editor, two-way synced). */

  /* ---------------- ACTIONS ---------------- */
  // Real release assets — filenames MUST match CI / the stock tool exactly (CLAUDE.md rule #4).
  const FW_BASE = "https://github.com/Qutaiba-Khader/hid-remapper-vx/releases/latest/download/";
  const FW_BOARDS = [
    { name: "Pico / Pico W", chip: "RP2040", led: false, files: [
      { file: "remapper.uf2", sub: "Single board" },
      { file: "remapper_dual_a.uf2", sub: "Dual · device side" },
      { file: "remapper_dual_b.uf2", sub: "Dual · host side" },
    ] },
    { name: "Pico 2 / Pico 2 W", chip: "RP2350", led: false, files: [
      { file: "remapper_pico2.uf2", sub: "Single board" },
    ] },
    { name: "RP2040-Zero", chip: "RP2040", led: true, files: [
      { file: "remapper_rp2040_zero_led.uf2", sub: "Single · onboard RGB LED", led: true },
      { file: "remapper_rp2040_zero_dual_a_led.uf2", sub: "Dual · device side · RGB LED", led: true },
      { file: "remapper_rp2040_zero_dual_b.uf2", sub: "Dual · host side" },
    ] },
    { name: "RP2350-Zero", chip: "RP2350", led: true, files: [
      { file: "remapper_pico2_led.uf2", sub: "Single · onboard RGB LED", led: true },
    ] },
  ];

  function fwFileHtml(f) {
    const dot = f.led ? `<span class="fw-led-dot" style="background:conic-gradient(#ff3b30,#ffe11a,#22c55e,#22d3ee,#3b82f6,#a855f7,#ff3b30)"></span>` : "";
    return `<a class="fw-dl" href="${FW_BASE}${f.file}" download rel="noopener">
      ${ICON.download}
      <span><span class="fw-variant">${f.sub}</span>${dot}</span>
      <span class="fw-meta">${f.file}</span>
    </a>`;
  }

  function fwBoardHtml(b) {
    return `<div class="fw-board">
      <div class="fw-board-head">
        <div class="fw-board-glyph">${ICON.chip}</div>
        <div>
          <div class="fw-board-name">${b.name}</div>
          <div class="fw-board-chip">${b.chip}</div>
        </div>
        ${b.led ? `<span class="fw-led-tag">RGB LED</span>` : ""}
      </div>
      <div class="fw-variants">${b.files.map(fwFileHtml).join("")}</div>
    </div>`;
  }

  function downloadJson() {
    const json = window.HRX_JSON.configToJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (APP.config.title || "hid-remapper-config").trim().replace(/[^\w.-]+/g, "_") + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Config exported");
  }

  function importJson() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/json,.json";
    inp.addEventListener("change", () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          window.HRX_JSON.applyJson(obj);
          if (window.HRX.setTab) window.HRX.setTab("mappings");
          toast("Imported " + ((obj.mappings && obj.mappings.length) || 0) + " mappings from " + file.name);
        } catch (e) { toast("Import failed: " + ((e && e.message) || e)); }
      };
      reader.readAsText(file);
    });
    inp.click();
  }

  function deviceAction(kind) {
    const dev = window.HRX_DEVICE;
    if (!dev.isConnected()) { toast("Connect a device first"); return; }
    if (kind === "flash") {
      if (!confirm("Reboot the device into bootloader (BOOTSEL) mode? It will disconnect so you can drop a new .uf2.")) return;
      dev.flashFirmware().then(() => toast("Device rebooting into bootloader…")).catch((e) => toast("Failed: " + ((e && e.message) || e)));
    } else if (kind === "flashb") {
      if (!confirm("Flash the B-side (host) firmware to match this device?")) return;
      dev.flashBSide().then(() => toast("Flashing B-side…")).catch((e) => toast("Failed: " + ((e && e.message) || e)));
    } else if (kind === "pair") {
      dev.pairNewDevice().then(() => toast("Pairing mode enabled on device")).catch((e) => toast("Failed: " + ((e && e.message) || e)));
    }
  }

  window.renderActions = function (container) {
    const card = (icon, title, desc, btn, danger, act) => `
      <div class="setting-card">
        <div style="display:flex;align-items:center;gap:11px;margin-bottom:9px">
          <div class="preset-icon" style="width:36px;height:36px;color:var(--purple-hi)">${icon}</div>
          <div class="sc-label" style="margin:0">${title}</div>
        </div>
        <div class="sc-help">${desc}</div>
        <button class="btn-hx ${danger ? "btn-danger" : "btn-primary"} btn-sm" data-act="${act}">${btn}</button>
      </div>`;

    container.innerHTML = `
    <div class="panel"><div class="panel-body">
      <div class="settings-grid">
        ${card(ICON.download, "Export config", "Download the full configuration (mappings, combos, expressions, settings) as a JSON file.", "Export JSON", false, "export")}
        ${card(ICON.file, "Import config", "Load a configuration from a JSON file on your computer.", "Import JSON", false, "import")}
        ${card(ICON.bolt, "Flash firmware", "Reboot into bootloader so you can drop a new .uf2 file.", "Enter bootloader", true, "flash")}
        ${card(ICON.layers, "Flash B-side", "Flash the host-side firmware for two-board (dual) devices.", "Flash B-side", true, "flashb")}
        ${card(ICON.plug, "Pair new device", "Put a Bluetooth remapper into pairing mode.", "Enable pairing", false, "pair")}
      </div>
      <div class="qa-section-head" style="margin:26px 0 14px"><h3>Firmware downloads</h3><p>Latest <code>.uf2</code> builds — grouped by board. Pick <b>single</b> or <b>dual</b> (device/host side); RGB-LED builds drive the onboard WS2812.</p></div>
      <div class="fw-grid">
        ${FW_BOARDS.map(fwBoardHtml).join("")}
      </div>
    </div></div>`;

    $$('[data-act]', container).forEach((b) => b.addEventListener("click", () => {
      const a = b.dataset.act;
      if (a === "export") downloadJson();
      else if (a === "import") importJson();
      else deviceAction(a);
    }));
    // firmware links are real <a href> downloads — no JS handler needed.
  };
})();
