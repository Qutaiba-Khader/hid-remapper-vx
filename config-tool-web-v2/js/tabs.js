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
    irOutputPin: (s) => { s.irOutputPin = DEF.irOutputPin; },
    irRepeatMs: (s) => { s.irRepeatMs = DEF.irRepeatMs; },
    passthrough: (s) => { s.passthrough = new Array(8).fill(true); }, // 0b11111111
    inputLabels: (s) => { s.inputLabels = DEF.inputLabels; },
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

        ${card("irOutputPin", "IR output pin",
          "GPIO the IR LED is wired to (only used on IR-capable firmware; saved with the config only when you have IR mappings). Avoid pins already used by USB/UART/RGB LED/Bluetooth.",
          num("irOutputPin", s.irOutputPin == null ? DEF.irOutputPin : s.irOutputPin, 0, 29,
              `GPIO 0–29 (default ${DEF.irOutputPin})`))}

        ${card("irRepeatMs", "IR hold-to-repeat",
          "How often an IR button retransmits while you hold it — this is what makes volume ramp and channel-surf work. A real remote uses about 110 ms. Set 0 to send once per press. Every other output gets its repeat from the host (a held key just stays down); IR has no held state, so it repeats here.",
          num("irRepeatMs", s.irRepeatMs == null ? DEF.irRepeatMs : s.irRepeatMs, 0, 2000,
              `milliseconds, 0 = off (default ${DEF.irRepeatMs})`))}

        ${card("passthrough", "Unmapped passthrough",
          "Pass keys with no mapping straight through, per layer. All layers are on by default — switching a layer off silences every unmapped key on it.",
          passToggles)}

        ${card("inputLabels", "Input labels",
          "Which naming scheme the picker uses for the shared button/axis codes. A gamepad and a mouse use the same HID codes, so the same number can be “Left button” or “Button 1”.",
          `<select class="select-hx" style="width:100%" id="inputLabels">
             <option value="0" ${(s.inputLabels || 0) === 0 ? "selected" : ""}>Mouse</option>
             <option value="1" ${(s.inputLabels || 0) === 1 ? "selected" : ""}>Gamepad</option>
           </select>`)}

        ${card("flags", "Device flags",
          "Lower-level switches. Leave these alone unless you know you need them.",
          `${toggleRow('data-flag-set="normalizeGamepad"', s.normalizeGamepad !== false, "Normalize gamepad inputs")}
           ${toggleRow('data-flag-set="gpioOutputMode"', !!s.gpioOutputMode, "GPIO output: open-drain (off = push-pull)")}
           ${toggleRow('data-flag-set="ignoreAuthDevInputs"', !!s.ignoreAuthDevInputs, "Ignore auth device inputs")}`)}

      </div>
      </div>
    </div>`;

    const rerender = () => window.HRX.rerenderTab();

    const il = $("#inputLabels", container);
    if (il) il.addEventListener("change", () => { s.inputLabels = parseInt(il.value, 10) || 0; });

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
    numField("irOutputPin", "irOutputPin", 0, 29);
    numField("irRepeatMs", "irRepeatMs", 0, 2000);

    $$('[data-pass]', container).forEach((t) => t.addEventListener("click", () => {
      const i = +t.dataset.pass;
      s.passthrough[i] = !s.passthrough[i];
      t.classList.toggle("on");
    }));


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
  const monData = new Map(); // `${usage}_${hub_port}` -> { usage, name, hub_port, last, min, max, seen }

  /* Usages the device reports with a CONSTANT non-zero value. These are vendor fields, not
     controls — a real button swings 0..1. They are useless as an input and POISONOUS in a
     mapping: their "press" happened once at enumeration and never again, so a mapping on one
     can never trigger. One real mouse reports 0xffa00008 at min=max=1 forever; the tool offered
     it and it silently did nothing. Save now refuses to ship one. */
  window.HRX_MON_STUCK = window.HRX_MON_STUCK || new Set();

  // Keyboard + consumer usages arrive as HID ARRAY ranges, and the firmware never sends their
  // key-up (remapper.cc ~L1707), so min===max===1 is the only reading they can ever have. They
  // must be exempt from the constant-value test below or every key looks like a vendor field.
  function isArrayRangeUsage(usage) {
    const page = (parseInt(usage, 16) >>> 16) & 0xffff;
    return page === 0x0007 || page === 0x000c;
  }

  /* Everything the Monitor has actually SEEN, exposed to the usage picker. These are the
     controls you just pressed on the hardware in front of you — far more useful for building
     a mapping than scrolling a catalog of every usage in existence. */
  window.HRX_MON_LIVE = () => [...monData.values()];
  let monRegistered = false;

  // fed by device.js -> HRX_DEVICE.onMonitor(cb); cb gets { usage, value, hub_port }
  function monIngest(rec) {
    const key = rec.usage + "_" + rec.hub_port;
    let row = monData.get(key);
    if (!row) {
      const name = (window.HRX_USAGES && window.HRX_USAGES.usageName(rec.usage)) || rec.usage;
      row = { usage: rec.usage, name, hub_port: rec.hub_port, last: rec.value, min: rec.value, max: rec.value, seen: 0 };
      monData.set(key, row);
    }
    row.seen++; // how many reports we have seen — needed before calling a usage "constant"
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
        <div><div class="panel-title">Monitor</div><div class="panel-sub">Live HID activity from the connected device. Press a button (or move the mouse) to see it here, then hit + to map it.</div></div>
        <button class="btn-hx btn-ghost btn-sm" id="monClear" style="margin-left:auto">Clear</button>
      </div>
      <div class="panel-body">
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>
            ${["Usage code", "Usage name", "Port", "Last value", "Min", "Max", ""].map((th) => `<th style="text-align:left;padding:9px 12px;font-family:var(--font-mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--label);border-bottom:1px solid var(--border)">${th}</th>`).join("")}
          </tr></thead>
          <tbody id="monBody"></tbody>
        </table>
        </div>
      </div>
    </div>`;
    monEls.clear(); // the container was just rebuilt — the cached <tr>s are no longer in the DOM
    paintMon();
    $("#monClear", container).addEventListener("click", () => { monData.clear(); monEls.clear(); paintMon(); toast("Monitor cleared"); });
  };

  /* THE + BUTTON MUST SURVIVE A LIVE REDRAW.

     This used to do `body.innerHTML = rows.map(rowMon)` on EVERY monitor report. The device
     being monitored is usually the very mouse you are holding, so moving it toward the +
     button streams Cursor X/Y and rebuilds the whole table dozens of times a second. The
     button you are pressing is destroyed between mousedown and mouseup, and the browser only
     fires `click` when both land on the same element — so the + did nothing, forever.
     (Scripted clicks worked fine, which is exactly why unit tests and a scripted browser pass
     never caught it: neither one moves a physical mouse.)

     So: build each row ONCE and keep it. Live updates only rewrite the text of the number
     cells; the <tr> and its button are stable nodes that are never replaced. */
  const monEls = new Map(); // key -> <tr>

  function mapThis(r) {
    const existing = APP.mappings.find((m) => (m.inputs || [])[0] === r.usage);
    if (existing) {
      toast(`${r.name} is already mapped — opening it`);
    } else {
      APP.mappings.push(window.HRX_STATE.mk(r.usage, "0x00000000"));
      toast(`Mapping added for ${r.name} — now pick its output`);
    }
    window.HRX.setTab("mappings");
  }

  function paintMon() {
    const body = $("#monBody");
    if (!body) return;

    if (!monData.size) {
      monEls.clear();
      body.innerHTML = `<tr><td colspan="7" style="padding:26px;text-align:center;color:var(--label)">Press a key on your device…</td></tr>`;
      return;
    }
    if (!monEls.size) body.innerHTML = ""; // drop the placeholder

    for (const [key, r] of monData) {
      let tr = monEls.get(key);
      if (!tr) {
        tr = document.createElement("tr");
        tr.innerHTML = rowMonCells(r);
        body.appendChild(tr);
        monEls.set(key, tr);
        // bound once, on a node that is never replaced
        tr.querySelector("[data-mkmap]").addEventListener("click", () => mapThis(r));
      }
      // A usage the device reports with a CONSTANT value is not a control — it is a vendor
      // field (a flag byte, a counter seed). A real button swings 0..1. Say so, loudly:
      // 0xffa00008 on one mouse sits at min=max=1 forever, so a mapping on it can NEVER
      // trigger — its "press" happened once at enumeration and never again. The tool used to
      // happily offer it and then silently do nothing.
      // ...but an ARRAY-range input can never report min=0, so this test declared every key on
      // a keyboard/remote a vendor field. remapper.cc (~L1707) hardcodes monitor_usage(usage, 1)
      // for them: "for array range inputs, key-up events (value=0) don't show up in the monitor".
      // Holding Up arrow past `seen > 40` therefore flagged it, the picker then HID it from
      // "Pressed on your device", and Save refused to ship it. Keyboard (0x0007) and consumer
      // (0x000C) are those array ranges; vendor pages like 0xFFA0 still get caught.
      const stuck = r.seen > 40 && r.min === r.max && r.min !== 0 && !isArrayRangeUsage(r.usage);
      if (stuck) window.HRX_MON_STUCK.add(r.usage); // remembered so Save can refuse to ship it
      tr.classList.toggle("mon-stuck", !!stuck);
      const nameCell = tr.children[1];
      if (stuck && !nameCell.querySelector(".mon-warn")) {
        nameCell.insertAdjacentHTML("beforeend",
          ` <span class="mon-warn" title="This usage never changes — it sits at ${r.min}. It is a vendor field, not a button, so it cannot be pressed or released. Mapping it does nothing.">always ${r.min} — not a button</span>`);
      }

      const c = tr.children;
      c[2].textContent = portLabel(r.hub_port);
      c[3].textContent = r.last;
      c[4].textContent = r.min;
      c[5].textContent = r.max;
    }
  }
  /* The firmware sends HUB_PORT_NONE (255) when the device is NOT behind a USB hub — i.e.
     "there is no port", not "port 255". Printing the raw number puts a meaningless 255 on
     every row of a normal (non-hub) setup. v1 hides the badge for 0 and 255; do the same. */
  const HUB_PORT_NONE = 255;
  function portLabel(p) {
    const n = Number(p);
    return (!n || n === HUB_PORT_NONE) ? "—" : String(n);
  }

  // cells only — the <tr> is created once by paintMon and then reused
  function rowMonCells(r) {
    const td = "padding:9px 12px;border-bottom:1px solid var(--border-soft)";
    const mono = "font-family:var(--font-mono);";
    return `
      <td style="${mono}color:var(--text-strong);${td}">${r.usage}</td>
      <td style="color:var(--text-strong);${td}">${r.name}</td>
      <td style="${mono}color:#fff;${td}">${portLabel(r.hub_port)}</td>
      <td style="${mono}${td}">${r.last}</td>
      <td style="${mono}${td}">${r.min}</td>
      <td style="${mono}${td}">${r.max}</td>
      <td style="${td}"><button class="icon-btn" data-mkmap="1" data-code="${r.usage}" data-name="${r.name}" title="Create mapping">${ICON.plus}</button></td>`;
  }

  /* ---------------- MACROS (32 slots, accordion) ----------------
     Fully editable: add/remove/reorder steps, several keys per step, clear, and copy to another
     slot. What you see is what the device returned on Load or what an imported JSON carried —
     never sample data. The data also round-trips untouched through translate.js, so a
     Load -> edit mappings -> Save cycle preserves macros you did not touch.
     (This comment used to say "read-only, editing is not built yet"; that was true before the
     editor landed and then sat here lying about it. If you change what this tab can do, change
     this too — a stale comment is how the next session concludes a feature is missing.) */
  let openMacro = -1;

  /* A macro is a SEQUENCE OF STEPS. Each step is a list of usages pressed at the same instant, and
     each step is held for `macro_entry_duration` ms (Settings). On the wire the steps are flattened
     with a 0x00 separator between them (device.js), which is why the model is
     [[usage, usage], [usage], ...].
     Fire a macro by mapping a key to "Macro N" (usage page 0xFFF2) on the Mappings tab. */
  function macroSteps(i) {
    const m = (APP.macros || [])[i];
    return Array.isArray(m) ? m : [];
  }
  function setMacro(i, steps) {
    if (!Array.isArray(APP.macros)) APP.macros = Array.from({ length: 32 }, () => []);
    APP.macros[i] = steps;
  }
  function redrawMacros() { window.renderMacros($("#tabContent")); }

  function macroPreview(i) {
    const steps = macroSteps(i);
    if (!steps.length) return "(empty)";
    return steps
      .map((step) => (step || []).map((u) => window.HRX_USAGES.usageName(u)).join(" + "))
      .join("  →  ");
  }

  window.renderMacros = function (container) {
    const used = Array.from({ length: 32 }, (_, i) => macroSteps(i).length).filter((n) => n > 0).length;
    const dur = (APP.settings && APP.settings.macroEntryDuration) || 1;

    const slots = Array.from({ length: 32 }, (_, i) => {
      const steps = macroSteps(i);
      const open = openMacro === i;
      return `
      <div class="macro-slot ${open ? "open" : ""}">
        <button class="macro-head" data-macro="${i}">
          <span class="macro-n">Macro ${i + 1}</span>
          <span class="macro-preview ${steps.length ? "" : "empty"}">${macroPreview(i)}</span>
          <span class="macro-usage">0xfff2${String(i + 1).padStart(4, "0")}</span>
          <span class="macro-chev" style="transform:rotate(${open ? 180 : 0}deg)">${ICON.chevron}</span>
        </button>
        ${open ? macroBody(i) : ""}
      </div>`;
    }).join("");

    container.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">Macros</div>
          <div class="panel-sub">32 slots · ${used} in use. A macro is a sequence of steps; every key in a step is pressed together, and each step is held for <b>${dur} ms</b> (Settings → Macro entry duration).</div>
        </div>
      </div>
      <div class="panel-body">
        <div class="setting-card" style="margin-bottom:14px">
          <div class="sc-label">How to fire a macro</div>
          <div class="sc-help" style="margin-bottom:0">Build the steps below, then go to <b>Mappings</b>, add a mapping, and set its <b>output</b> to <b>Macro 1…32</b> (they live under “Macros” in the picker). Pressing that key runs the steps in order. Nothing reaches the device until you press <b>Save to device</b>.</div>
        </div>
        ${slots}
      </div>
    </div>`;

    wireMacros(container);
  };

  function macroBody(i) {
    const steps = macroSteps(i);

    const rows = steps.map((step, n) => {
      const keys = (step || []).map((u, k) => `
        <div class="macro-key">
          <button class="usage-btn" style="--cat:${window.HRX_USAGES.usageAccent(u)}" data-mkey="1" data-mi="${i}" data-step="${n}" data-k="${k}" title="Change this key">
            <span class="u-cat-dot"></span>
            <span class="u-name">${window.HRX_USAGES.usageName(u)}</span>
            <span class="chev">${ICON.chevron}</span>
          </button>
          <button class="chip-x" data-mkeydel="1" data-mi="${i}" data-step="${n}" data-k="${k}" title="Remove this key from the step">${ICON.x}</button>
        </div>`).join('<span class="macro-plus">+</span>');

      return `
        <div class="macro-step">
          <span class="macro-step-n">${n + 1}</span>
          <div class="macro-keys">
            ${keys || `<span class="hint">empty step — add a key</span>`}
            <button class="combo-add" data-mkeyadd="1" data-mi="${i}" data-step="${n}" title="Add another key to this macro step (pressed together)">${ICON.plus}</button>
          </div>
          <div class="macro-step-ctrls">
            <button class="icon-btn" data-mstepup="1" data-mi="${i}" data-step="${n}" title="Move step up" ${n === 0 ? "disabled" : ""}>${ICON.up}</button>
            <button class="icon-btn" data-mstepdown="1" data-mi="${i}" data-step="${n}" title="Move step down" ${n === steps.length - 1 ? "disabled" : ""}>${ICON.down}</button>
            <button class="icon-btn del" data-mstepdel="1" data-mi="${i}" data-step="${n}" title="Delete this step">${ICON.x}</button>
          </div>
        </div>`;
    }).join("");

    return `
      <div class="macro-body">
        ${steps.length ? rows : `<div class="macro-empty">This macro is empty. Add a step to begin.</div>`}
        <div class="macro-actions">
          <button class="btn-hx btn-primary btn-sm" data-mstepadd="1" data-mi="${i}">${ICON.plus}<span>Add step</span></button>
          <button class="btn-hx btn-sm" data-mclone="1" data-mi="${i}" ${steps.length ? "" : "disabled"}>${ICON.clone}<span>Copy to…</span></button>
          <button class="btn-hx btn-sm" data-mclear="1" data-mi="${i}" ${steps.length ? "" : "disabled"}>${ICON.x}<span>Clear macro</span></button>
        </div>
      </div>`;
  }

  function wireMacros(root) {
    $$('[data-macro]', root).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.macro;
      openMacro = openMacro === i ? -1 : i;
      redrawMacros();
    }));

    $$('[data-mstepadd]', root).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mi;
      const steps = macroSteps(i).slice();
      steps.push([]);
      setMacro(i, steps);
      redrawMacros();
    }));

    $$('[data-mstepdel]', root).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mi, n = +b.dataset.step;
      const steps = macroSteps(i).slice();
      steps.splice(n, 1);
      setMacro(i, steps);
      redrawMacros();
    }));

    const moveStep = (attr, delta) => $$("[" + attr + "]", root).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mi, n = +b.dataset.step;
      const steps = macroSteps(i).slice();
      const to = n + delta;
      if (to < 0 || to >= steps.length) return;
      const [s] = steps.splice(n, 1);
      steps.splice(to, 0, s);
      setMacro(i, steps);
      redrawMacros();
    }));
    moveStep("data-mstepup", -1);
    moveStep("data-mstepdown", 1);

    // add a key to a step — opens the REAL usage picker
    $$('[data-mkeyadd]', root).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mi, n = +b.dataset.step;
      window.openPicker({
        mode: "output",
        current: null,
        onSelect: (code) => {
          const steps = macroSteps(i).map((s) => s.slice());
          if (steps[n].includes(code)) { toast("That key is already in this step"); return; }
          steps[n].push(code);
          setMacro(i, steps);
          redrawMacros();
        },
      });
    }));

    // change an existing key
    $$('[data-mkey]', root).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mi, n = +b.dataset.step, k = +b.dataset.k;
      window.openPicker({
        mode: "output",
        current: macroSteps(i)[n][k],
        onSelect: (code) => {
          const steps = macroSteps(i).map((s) => s.slice());
          steps[n][k] = code;
          setMacro(i, steps);
          redrawMacros();
        },
      });
    }));

    $$('[data-mkeydel]', root).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mi, n = +b.dataset.step, k = +b.dataset.k;
      const steps = macroSteps(i).map((s) => s.slice());
      steps[n].splice(k, 1);
      setMacro(i, steps);
      redrawMacros();
    }));

    $$('[data-mclear]', root).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mi;
      if (!confirm("Clear Macro " + (i + 1) + "? (The device only changes when you Save.)")) return;
      setMacro(i, []);
      redrawMacros();
      toast("Macro " + (i + 1) + " cleared");
    }));

    $$('[data-mclone]', root).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mi;
      const answer = prompt("Copy Macro " + (i + 1) + " to which slot? (1-32)");
      if (answer == null) return;
      const target = parseInt(answer, 10);
      if (!(target >= 1 && target <= 32)) { toast("Pick a slot between 1 and 32"); return; }
      if (target - 1 === i) { toast("That is the same slot"); return; }
      if (macroSteps(target - 1).length && !confirm("Macro " + target + " is not empty. Overwrite it?")) return;
      setMacro(target - 1, macroSteps(i).map((s) => s.slice()));
      openMacro = target - 1;
      redrawMacros();
      toast("Copied to Macro " + target);
    }));
  }

  /* ---------------- QUIRKS ("custom usages") ----------------
     A quirk teaches the remapper to read a field from a device whose HID descriptor is wrong or
     incomplete: for VID:PID / interface / report id, treat the bits at `bitpos` (of `size` bits) as
     the given usage. Wire format (device.js ADD_QUIRK): the size byte packs
     relative (bit 7) | signed (bit 6) | size (bits 0-5). */
  const QUIRK_BLANK = () => ({
    vendor_id: "0x0000", product_id: "0x0000", interface: 0, report_id: 0,
    usage: "0x00000000", bitpos: 0, size: 8, relative: false, signed: false,
  });

  function quirks() {
    if (!Array.isArray(APP.quirks)) APP.quirks = [];
    return APP.quirks;
  }
  function redrawQuirks() { window.renderQuirks($("#tabContent")); }

  window.renderQuirks = function (container) {
    const qs = quirks();

    const rows = qs.map((q, i) => `
      <div class="quirk-row">
        <div class="quirk-grid">
          ${qField(i, "vendor_id", "Vendor ID", q.vendor_id, "text", "0x1234")}
          ${qField(i, "product_id", "Product ID", q.product_id, "text", "0x5678")}
          ${qField(i, "interface", "Interface", q.interface, "number")}
          ${qField(i, "report_id", "Report ID", q.report_id, "number")}
          ${qField(i, "usage", "Usage", q.usage, "text", "0x00090001")}
          ${qField(i, "bitpos", "Bit position", q.bitpos, "number")}
          ${qField(i, "size", "Size (bits)", q.size, "number")}
          <div class="quirk-flags">
            <span class="chk mode word ${q.relative ? "on" : ""}" data-qflag="relative" data-qi="${i}" title="The field is a relative (delta) value">Relative</span>
            <span class="chk mode word ${q.signed ? "on" : ""}" data-qflag="signed" data-qi="${i}" title="The field is signed (two's complement)">Signed</span>
          </div>
          <button class="icon-btn del" data-qdel="1" data-qi="${i}" title="Delete this quirk">${ICON.x}</button>
        </div>
      </div>`).join("");

    container.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">Quirks</div>
          <div class="panel-sub">${qs.length} quirk${qs.length === 1 ? "" : "s"}. Teach the remapper to read a field from a device whose HID descriptor is wrong or incomplete.</div>
        </div>
      </div>
      <div class="panel-body">
        <div class="setting-card" style="margin-bottom:14px">
          <div class="sc-label">You probably don't need this</div>
          <div class="sc-help" style="margin-bottom:0">Quirks exist for devices that lie about their own descriptor — a button that reports nothing, or an axis at the wrong offset. For <b>VID:PID</b> + <b>interface</b> + <b>report ID</b>, the <b>size</b> bits at <b>bit position</b> are read as the given <b>usage</b>. Use the <b>Monitor</b> tab to find what your device is actually sending. Nothing reaches the device until you press <b>Save to device</b>.</div>
        </div>
        ${qs.length ? rows : `<div class="macro-empty">No quirks. Your devices' descriptors are being taken at face value.</div>`}
        <div class="macro-actions" style="border-top:none;margin-top:14px">
          <button class="btn-hx btn-primary btn-sm" id="qAdd">${ICON.plus}<span>Add quirk</span></button>
        </div>
      </div>
    </div>`;

    wireQuirks(container);
  };

  function qField(i, key, label, value, type, placeholder) {
    return `
      <label class="quirk-field">
        <span class="quirk-label">${label}</span>
        <input class="input-hx" type="${type}" value="${value}" data-qkey="${key}" data-qi="${i}"
               ${placeholder ? `placeholder="${placeholder}"` : ""}
               ${type === "number" ? 'min="0"' : ""}>
      </label>`;
  }

  function wireQuirks(root) {
    const add = $("#qAdd", root);
    if (add) add.addEventListener("click", () => { quirks().push(QUIRK_BLANK()); redrawQuirks(); });

    $$('[data-qdel]', root).forEach((b) => b.addEventListener("click", () => {
      quirks().splice(+b.dataset.qi, 1);
      redrawQuirks();
      toast("Quirk removed");
    }));

    $$('[data-qflag]', root).forEach((el) => el.addEventListener("click", () => {
      const q = quirks()[+el.dataset.qi];
      q[el.dataset.qflag] = !q[el.dataset.qflag];
      redrawQuirks();
    }));

    $$('[data-qkey]', root).forEach((inp) => inp.addEventListener("change", () => {
      const q = quirks()[+inp.dataset.qi];
      const key = inp.dataset.qkey;
      if (key === "vendor_id" || key === "product_id" || key === "usage") {
        const raw = inp.value.trim().replace(/^0x/i, "");
        const width = key === "usage" ? 8 : 4;
        if (!/^[0-9a-f]{1,8}$/i.test(raw)) { toast("Enter a hex value, e.g. 0x1234"); redrawQuirks(); return; }
        q[key] = "0x" + raw.toLowerCase().padStart(width, "0");
      } else {
        // the size byte packs relative|signed|size(6 bits), so size must fit in 6 bits
        const max = key === "size" ? 63 : 255;
        q[key] = Math.max(0, Math.min(max, Math.round(+inp.value) || 0));
      }
      redrawQuirks();
    }));
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
  const FW_VERSION_FALLBACK = "r2026-07-06"; // shown if the GitHub API cannot be reached

  const FW_BOARDS = [
    { name: "Pico / Pico W", chip: "RP2040", files: [
      { file: "remapper.uf2", sub: "Single board" },
      { file: "remapper_picow_usb.uf2", sub: "Pico W · wired USB input (plug your device into the Pico W)" },
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
    /* Bluetooth = the INPUT DEVICE arrives over the air instead of on a USB cable. Pair a BLE
       keyboard / mouse / TV remote and it runs through the full mapping engine, out to the PC as a
       normal USB HID device.
       The Pico W build is a different chip family (RP2040 + CYW43) but the same idea, so it belongs
       in this group, not with the wired Pico builds — someone looking for "Bluetooth" will look
       here. NOTE: the remapper is NOT pairable on its own; it only reconnects to the device it
       already knows. "Pair new device" opens a 60-second window. */
    { name: "Bluetooth", chip: "nRF52840 / Pico W", files: [
      { file: "remapper_picow_ble.uf2", sub: "Pico W · Bluetooth LE input (RP2040 + CYW43)" },
      { file: "remapper_adafruit_feather_nrf52840.uf2", sub: "Adafruit Feather nRF52840" },
      { file: "remapper_seeed_xiao_nrf52840.uf2", sub: "Seeed XIAO nRF52840" },
    ] },
    /* Infrared (IR) output = map any button to a TV/AV remote key (NEC & Samsung). Wire an IR LED to
       the IR output pin (Settings tab; default GP15) and add an IR mapping. These builds add the IR
       blaster on top of the matching board; the stock build is byte-identical and unchanged. */
    { name: "Infrared (IR) output", chip: "RP2040 / Pico W", files: [
      { file: "remapper_picow_ble_ir.uf2", sub: "Pico W · Bluetooth input + IR blaster" },
      { file: "remapper_ir.uf2", sub: "Pico / Pico W · wired USB input + IR blaster" },
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

  // The Bluetooth actions only exist on a Bluetooth remapper (v1 hides them too). Showing them
  // on a USB device is an invitation to press a button that can only fail.
  function isBluetooth() {
    const dev = window.HRX_DEVICE;
    const info = dev && dev.isConnected() && dev.getInfo();
    return !!(info && info.bluetooth);
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
    } else if (kind === "bonds") {
      // v1 parity ("Forget all devices"). clearBonds() existed but had no button.
      if (!confirm("Forget ALL Bluetooth devices paired with this remapper? They will each have to be paired again.")) return;
      dev.clearBonds().then(() => toast("All Bluetooth bonds cleared")).catch((e) => toast("Failed: " + ((e && e.message) || e)));
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
        ${card(ICON.download, "Export config", "Download the full configuration (mappings, macros, expressions, settings) as a JSON file.", "Export JSON", false, "export")}
        ${card(ICON.file, "Import config", "Load a configuration from a JSON file on your computer.", "Import JSON", false, "import")}
        ${card(ICON.bolt, "Flash firmware", "Reboot into bootloader so you can drop a new .uf2 file.", "Enter bootloader", true, "flash")}
        ${card(ICON.layers, "Flash B-side", "Flash the host-side firmware for two-board (dual) devices.", "Flash B-side", true, "flashb")}
        ${isBluetooth() ? card(ICON.plug, "Pair new device", "Put a Bluetooth remapper into pairing mode.", "Enable pairing", false, "pair") : ""}
        ${isBluetooth() ? card(ICON.x, "Forget all devices", "Clear every Bluetooth bond stored on the remapper. They must be paired again.", "Clear bonds", true, "bonds") : ""}
      </div>
      <div class="qa-section-head" style="margin:26px 0 14px">
        <h3>Firmware downloads</h3>
        <p>
          <span class="fw-release" id="fwRelease">${FW_VERSION_FALLBACK}</span>
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
