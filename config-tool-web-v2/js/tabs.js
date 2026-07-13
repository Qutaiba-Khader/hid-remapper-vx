/* ============================================================
   HID Remapper VX — Settings · Monitor · Macros · Expressions · Actions
   ============================================================ */
(function () {
  const { APP } = window.HRX_STATE;
  const { $, $$, toast } = window.HRX;

  /* ---------------- SETTINGS ---------------- */
  const EMU = window.HRX_STATE.PROFILES; // index = our_descriptor_number

  // Factory defaults. These are the FIRMWARE's own defaults (firmware/src/globals.cc),
  // not invented ones — the reset buttons restore exactly what a freshly-flashed device uses.
  const DEF = window.HRX_TRANSLATE.DEFAULTS;

  // one setting -> how to reset it
  const RESETTERS = {
    emulatedDevice: (s) => { s.emulatedDevice = DEF.emulatedDevice; APP.device.profile = EMU[DEF.emulatedDevice]; },
    tapHold: (s) => { s.tapHold = DEF.tapHold; },
    scrollTimeout: (s) => { s.scrollTimeout = DEF.scrollTimeout; },
    interval: (s) => { s.interval = DEF.interval; },
    gpioDebounce: (s) => { s.gpioDebounce = DEF.gpioDebounce; },
    macroEntryDuration: (s) => { s.macroEntryDuration = DEF.macroEntryDuration; },
    passthrough: (s) => { s.passthrough = new Array(8).fill(true); }, // 0b11111111
    combos: (s) => { s.combosEnabled = DEF.combosEnabled; },
    flags: (s) => {
      s.normalizeGamepad = DEF.normalizeGamepad;
      s.gpioOutputMode = DEF.gpioOutputMode;
      s.ignoreAuthDevInputs = DEF.ignoreAuthDevInputs;
    },
  };

  const resetBtn = (key) =>
    `<button class="btn-reset" data-reset="${key}" title="Reset to default">${ICON.undo}</button>`;

  const card = (key, label, help, body, cls) => `
    <div class="setting-card ${cls || ""}">
      <div class="sc-head">
        <div class="sc-label">${label}</div>
        ${resetBtn(key)}
      </div>
      <div class="sc-help">${help}</div>
      ${body}
    </div>`;

  const num = (id, val, min, max, unit) => `
    <div class="sc-input-row">
      <input class="input-hx" type="number" min="${min}" max="${max == null ? "" : max}" value="${val}"
             id="${id}" style="width:90px;font-family:var(--font-mono)">
      <span class="hint">${unit}</span>
    </div>`;

  const toggleRow = (attr, on, label) =>
    `<div class="toggle-row"><span class="toggle ${on ? "on" : ""}" ${attr}></span><span>${label}</span></div>`;

  window.renderSettings = function (container) {
    const s = APP.settings;
    const emuOpts = EMU.map((e, i) => `<option value="${i}" ${i === s.emulatedDevice ? "selected" : ""}>${e}</option>`).join("");
    const passToggles = s.passthrough.map((on, i) => toggleRow(`data-pass="${i}"`, on, "Layer " + i)).join("");
    const combosOn = s.combosEnabled !== false;

    container.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div><div class="panel-title">Settings</div><div class="panel-sub">Device-wide behavior. Every value can be reset to the firmware default.</div></div>
        <button class="btn-hx btn-sm" id="resetAll" style="margin-left:auto">${ICON.undo}<span>Reset all</span></button>
        <button class="btn-hx btn-sm" id="editJson">${ICON.file}<span>Edit config JSON</span></button>
      </div>
      <div class="panel-body">
      <div class="settings-grid">

        ${card("emulatedDevice", "Emulated device type",
          "What the remapper presents itself as to the host.",
          `<select class="select-hx" style="width:100%" id="emu">${emuOpts}</select>`)}

        ${card("combos", `Combos <span class="section-tag" style="margin-left:6px">New</span>`,
          "Fire one output when several inputs are held together. Each combo row carries its own timing window and Consume switch — set them on the Mappings tab. Turn this off and no combo is sent to the device.",
          `${toggleRow('data-combos="1"', combosOn, combosOn ? "Combos enabled" : "Combos disabled")}
           <div class="hint" style="margin-top:6px">Requires VX firmware with combo support (r2026-07-13 or newer). On older firmware combos are simply ignored.</div>`,
          "highlight")}

        ${card("tapHold", "Tap-hold threshold",
          "Global timing that separates a tap from a hold.",
          num("tapHold", s.tapHold, 0, null, `milliseconds (default ${DEF.tapHold})`))}

        ${card("scrollTimeout", "Partial scroll timeout",
          "How long partial scroll accumulation persists.",
          num("scrollTimeout", s.scrollTimeout, 0, null, `milliseconds (default ${DEF.scrollTimeout})`))}

        ${card("interval", "Interval override",
          "USB polling interval. 0 keeps the device default.",
          num("interval", s.interval, 0, 255, `0 = default`))}

        ${card("gpioDebounce", "GPIO debounce time",
          "Debounce window for buttons wired directly to GPIO pins.",
          num("gpioDebounce", s.gpioDebounce == null ? DEF.gpioDebounce : s.gpioDebounce, 0, 255,
              `milliseconds (default ${DEF.gpioDebounce})`))}

        ${card("macroEntryDuration", "Macro entry duration",
          "How long each step of a macro is held down.",
          num("macroEntryDuration", s.macroEntryDuration == null ? DEF.macroEntryDuration : s.macroEntryDuration, 1, 255,
              `milliseconds (default ${DEF.macroEntryDuration})`))}

        ${card("passthrough", "Unmapped passthrough",
          "Pass keys with no mapping straight through, per layer. All layers are on by default — switching a layer off silences every unmapped key on it.",
          passToggles)}

        ${card("flags", "Device flags",
          "Lower-level switches. Leave these alone unless you know you need them.",
          `${toggleRow('data-flag-set="normalizeGamepad"', s.normalizeGamepad !== false, "Normalize gamepad inputs")}
           ${toggleRow('data-flag-set="gpioOutputMode"', !!s.gpioOutputMode, "GPIO output: open-drain (off = push-pull)")}
           ${toggleRow('data-flag-set="ignoreAuthDevInputs"', !!s.ignoreAuthDevInputs, "Ignore auth device inputs")}`)}

      </div>
      </div>
    </div>`;

    const rerender = () => window.HRX.rerenderTab();

    $("#emu", container).addEventListener("change", (e) => {
      s.emulatedDevice = +e.target.value;
      APP.device.profile = EMU[s.emulatedDevice] || ("Profile " + s.emulatedDevice);
      toast("Emulated device: " + EMU[s.emulatedDevice]);
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
    numField("gpioDebounce", "gpioDebounce", 0, 255);
    numField("macroEntryDuration", "macroEntryDuration", 1, 255);

    $$('[data-pass]', container).forEach((t) => t.addEventListener("click", () => {
      const i = +t.dataset.pass;
      s.passthrough[i] = !s.passthrough[i];
      t.classList.toggle("on");
    }));

    const combosToggle = $('[data-combos]', container);
    if (combosToggle) combosToggle.addEventListener("click", () => {
      s.combosEnabled = s.combosEnabled === false;
      toast(s.combosEnabled ? "Combos enabled" : "Combos disabled — combo rows will not be sent to the device");
      rerender();
    });

    $$('[data-flag-set]', container).forEach((t) => t.addEventListener("click", () => {
      const k = t.dataset.flagSet;
      s[k] = !s[k];
      t.classList.toggle("on");
    }));

    $$('[data-reset]', container).forEach((b) => b.addEventListener("click", () => {
      const fn = RESETTERS[b.dataset.reset];
      if (!fn) return;
      fn(s);
      rerender();
      toast("Reset to default");
    }));

    const ra = $("#resetAll", container);
    if (ra) ra.addEventListener("click", () => {
      Object.values(RESETTERS).forEach((fn) => fn(s));
      rerender();
      toast("All settings reset to firmware defaults");
    });

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
      // Create the mapping AND take the user to it. Previously this pushed the row and stayed
      // on the Monitor tab, so nothing visible happened and the button looked dead.
      const code = b.dataset.code;
      const existing = APP.mappings.find((m) => (m.inputs || [])[0] === code);
      if (existing) {
        toast(`${b.dataset.name} is already mapped — opening it`);
      } else {
        APP.mappings.push(window.HRX_STATE.mk(code, "0x00000000"));
        toast(`Mapping added for ${b.dataset.name} — now pick its output`);
      }
      window.HRX.setTab("mappings");
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

  /* ---------------- MACROS (32 slots, accordion) ----------------
     READ-ONLY for now: this shows the macros actually held in APP.macros (i.e. what the
     device returned on Load, or what an imported JSON carried), NOT sample data. Editing
     is not built yet — but the data round-trips untouched through translate.js, so a
     Load -> edit mappings -> Save cycle preserves the device's macros exactly. */
  let openMacro = -1;

  // one macro = [[usage, usage, ...], ...] — each inner array is one simultaneous step
  function macroSteps(i) {
    const m = (APP.macros || [])[i];
    return Array.isArray(m) ? m : [];
  }
  function macroPreview(i) {
    const steps = macroSteps(i);
    if (!steps.length) return "(empty)";
    return steps
      .map((step) => (step || []).map((u) => window.HRX_USAGES.usageName(u)).join(" + "))
      .join(" · ");
  }

  window.renderMacros = function (container) {
    const used = Array.from({ length: 32 }, (_, i) => macroSteps(i).length).filter((n) => n > 0).length;

    const slots = Array.from({ length: 32 }, (_, i) => {
      const preview = macroPreview(i);
      const empty = preview === "(empty)";
      const open = openMacro === i;
      return `
      <div style="border:1px solid var(--border-bright);border-radius:var(--radius-sm);margin-bottom:8px;overflow:hidden;background:var(--bg-deep)">
        <button class="btn-hx" data-macro="${i}" style="width:100%;justify-content:flex-start;border:none;border-radius:0;background:${open ? "var(--hover)" : "transparent"};padding:12px 14px">
          <span style="font-family:var(--font-mono);color:var(--purple-hi);min-width:54px">Macro ${i}</span>
          <span style="color:${empty ? "var(--label)" : "var(--text-strong)"};font-weight:500">${preview}</span>
          <span style="margin-left:auto;display:flex;gap:6px">
            <span style="transform:rotate(${open ? 180 : 0}deg);transition:transform .15s;display:grid;place-items:center">${ICON.chevron}</span>
          </span>
        </button>
        ${open ? macroBody(i) : ""}
      </div>`;
    }).join("");

    container.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">Macros</div>
          <div class="panel-sub">32 slots · ${used} in use. Each macro is a sequence of steps; a step can hold several usages at once.</div>
        </div>
      </div>
      <div class="panel-body">
        <div class="setting-card" style="margin-bottom:12px">
          <div class="sc-label">Read-only for now</div>
          <div class="sc-help" style="margin-bottom:0">This shows the macros currently on the device (after <b>Load from device</b>) or in an imported config — not sample data. A macro editor isn't built yet, but your macros are <b>preserved exactly</b> through a Load → edit → Save cycle. To change them, use the stock config tool or <b>Edit config JSON</b> in Settings.</div>
        </div>
        ${slots}
      </div>
    </div>`;

    $$('[data-macro]', container).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.macro; openMacro = openMacro === i ? -1 : i; window.renderMacros($("#tabContent"));
    }));
  };

  function macroBody(i) {
    const steps = macroSteps(i);
    if (!steps.length) {
      return `<div style="border-top:1px solid var(--border-soft);padding:12px 14px;color:var(--label)">This macro slot is empty.</div>`;
    }
    const rows = steps.map((step, n) => {
      const usages = (step || []).map((u) => `
        <button class="usage-btn" style="--cat:var(--purple-hi);max-width:260px" disabled>
          <span class="u-cat-dot"></span><span class="u-name">${window.HRX_USAGES.usageName(u)}</span>
        </button>`).join("");
      return `
        <div style="display:flex;gap:9px;align-items:center;padding:8px 14px">
          <span style="font-family:var(--font-mono);color:var(--label);min-width:36px">${n + 1}</span>
          ${usages}
        </div>`;
    }).join("");
    return `<div style="border-top:1px solid var(--border-soft);padding:6px 0">${rows}</div>`;
  }

  /* ---------------- EXPRESSIONS ----------------
     Rendered by js/expressions.js, which defines window.renderExpressions
     (visual block builder + RPN code editor, two-way synced). */

  /* ---------------- ACTIONS ---------------- */
  // Real release assets — filenames MUST match CI exactly (CLAUDE.md rule #4). Every file
  // below was checked against the published release; a typo here is a 404 for the user.
  //
  // DUAL BOARDS (verified against firmware/CMakeLists.txt, not from memory):
  //   Side A builds with tusb_config_device -> it is the USB DEVICE, it plugs into the PC,
  //                                            it holds the config and runs the mapping engine.
  //   Side B builds with tusb_config_host   -> it is the USB HOST, your keyboard/remote plugs
  //                                            into it; it just streams reports to A over UART.
  const FW_REPO = "https://github.com/Qutaiba-Khader/hid-remapper-vx";
  const FW_BASE = FW_REPO + "/releases/latest/download/";
  const FW_VERSION_FALLBACK = "r2026-07-13"; // shown if the GitHub API can't be reached

  const FW_BOARDS = [
    { name: "Pico / Pico W", chip: "RP2040", files: [
      { file: "remapper.uf2", sub: "Single board" },
      { file: "remapper_dual_a.uf2", sub: "Dual · side A — plugs into the PC" },
      { file: "remapper_dual_b.uf2", sub: "Dual · side B — your device plugs in here" },
      { file: "remapper_dual_combined.uf2", sub: "Dual · combined (A flashes B over SWD)" },
      { file: "remapper_serial.uf2", sub: "Serial (input over an external serial link)" },
    ] },
    { name: "Pico 2 / Pico 2 W", chip: "RP2350", files: [
      { file: "remapper_pico2.uf2", sub: "Single board" },
      { file: "remapper_pico2_dual_a.uf2", sub: "Dual · side A — plugs into the PC" },
      { file: "remapper_pico2_dual_b.uf2", sub: "Dual · side B — your device plugs in here" },
      { file: "remapper_pico2_dual_combined.uf2", sub: "Dual · combined (A flashes B over SWD)" },
    ] },
    { name: "RP2040-Zero", chip: "RP2040", led: true, files: [
      { file: "remapper.uf2", sub: "Single board (no LED)" },
      { file: "remapper_rp2040_zero_led.uf2", sub: "Single · onboard RGB LED", led: true },
      { file: "remapper_rp2040_zero_dual_a.uf2", sub: "Dual · side A — plugs into the PC" },
      { file: "remapper_rp2040_zero_dual_a_led.uf2", sub: "Dual · side A · onboard RGB LED", led: true },
      { file: "remapper_rp2040_zero_dual_b.uf2", sub: "Dual · side B — your device plugs in here" },
    ] },
    { name: "RP2350-Zero", chip: "RP2350", led: true, files: [
      { file: "remapper_pico2.uf2", sub: "Single board (no LED)" },
      { file: "remapper_pico2_led.uf2", sub: "Single · onboard RGB LED", led: true },
    ] },
    { name: "Bluetooth", chip: "nRF52840", files: [
      { file: "remapper_adafruit_feather_nrf52840.uf2", sub: "Adafruit Feather nRF52840" },
      { file: "remapper_seeed_xiao_nrf52840.uf2", sub: "Seeed XIAO nRF52840" },
    ] },
    { name: "Other boards", chip: "RP2040 / RP2350", files: [
      { file: "remapper_board.uf2", sub: "Custom JLCPCB board" },
      { file: "remapper_board_v7.uf2", sub: "Custom board v7" },
      { file: "remapper_board_v8.uf2", sub: "Custom board v8" },
      { file: "remapper_feather.uf2", sub: "Adafruit Feather RP2040 USB Host" },
      { file: "remapper_waveshare_rp2040_pizero.uf2", sub: "Waveshare RP2040-PiZero" },
      { file: "remapper_waveshare_rp2350_pizero.uf2", sub: "Waveshare RP2350-PiZero" },
      { file: "remapper_waveshare_rp2350_usb_a.uf2", sub: "Waveshare RP2350 USB-A" },
      { file: "remapper_flatbox_rev4.uf2", sub: "Flatbox rev4" },
      { file: "remapper_flatbox_rev8.uf2", sub: "Flatbox rev8" },
      { file: "remapper_meisterconverter.uf2", sub: "MeisterConverter" },
      { file: "remapper_rp2040abb.uf2", sub: "RP2040 ABB" },
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
      <div class="qa-section-head" style="margin:26px 0 14px">
        <h3>Firmware downloads</h3>
        <p>
          <span class="fw-release" id="fwRelease">${FW_VERSION_FALLBACK}</span>
          <span class="fw-release-note">includes native combos</span>
          — every link below is that release.
        </p>
        <p>
          Pick <b>single</b> board, or for a two-board build: <b>side A</b> plugs into the PC (it
          holds the config and runs the mapping engine), <b>side B</b> is what your keyboard or
          remote plugs into. RGB-LED builds drive the onboard WS2812.
        </p>
      </div>
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

    // Show the ACTUAL tag the /releases/latest/ links resolve to, rather than a number baked
    // into this file that can silently go stale.
    fetch("https://api.github.com/repos/Qutaiba-Khader/hid-remapper-vx/releases/latest")
      .then((r) => (r.ok ? r.json() : null))
      .then((rel) => {
        const el = $("#fwRelease", container);
        if (el && rel && rel.tag_name) el.textContent = rel.tag_name;
      })
      .catch(() => { /* offline, or rate-limited — the fallback tag stays */ });
  };
})();
