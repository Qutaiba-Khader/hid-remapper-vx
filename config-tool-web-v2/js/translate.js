/*
 * translate.js — maps between the new UI's APP model and the device `config` model.
 *
 * APP mapping  : { id, inputs:[hex,...], output:hex, enabled, layers:[bool,...],
 *                  sticky, tap, hold, scale(float), tint, comboWindow(ms), comboConsume }
 * config mapping: { source_usage:hex, target_usage:hex, layers:[indices 0-7],
 *                  sticky, tap, hold, combo_consume, scaling(int ×1000),
 *                  source_port, target_port, color:'#rrggbb' }
 *
 * COMBOS (see docs/superpowers/specs/2026-07-13-firmware-combos-design.md)
 * A combo is an AND-gate on usage page 0xFFFB — the firmware ANDs the sources of a
 * combo-page target, where every other target sums (ORs) them. One combo row persists
 * as three ordinary mappings, so CONFIG_VERSION stays 18:
 *   key A  -> 0xfffb0001   scaling = window in ms, flags bit 3 = consume   (member)
 *   key B  -> 0xfffb0001   ditto                                           (member)
 *   0xfffb0001 -> output   scaling = ×1000, sticky/tap/hold as usual       (trigger)
 *
 * Other rules:
 *  - APP.enabled === false -> kept in JSON (disabled_rows), skipped when saving to the device
 *  - layers: bool array <-> index array (up to NLAYERS)
 *  - scale float <-> scaling int (×1000)
 *  - tint(id) <-> color(#hex): cosmetic only, best-effort
 *
 * Pure functions; no DOM. Works in the browser (window.HRX_TRANSLATE) and in Node (module.exports).
 */
(function () {
  const NLAYERS = 8;
  const DEFAULT_SCALING = 1000;
  const CONFIG_VERSION = 18;

  // combos
  const COMBO_USAGE_PAGE = 0xfffb0000;
  const NCOMBOS = 16;
  const DEFAULT_COMBO_WINDOW_MS = 50;

  // Firmware defaults — authoritative, from firmware/src/globals.cc + config-tool-web/code.js.
  // The Settings tab's "reset to default" buttons restore exactly these.
  const DEFAULTS = {
    passthroughLayers: [0, 1, 2, 3, 4, 5, 6, 7], // unmapped_passthrough_layer_mask = 0b11111111
    scrollTimeout: 1000, // ms (partial_scroll_timeout = 1000000 µs)
    tapHold: 200,        // ms (tap_hold_threshold = 200000 µs)
    interval: 0,         // interval_override = 0 (no override)
    gpioDebounce: 5,     // gpio_debounce_time_ms
    macroEntryDuration: 1, // ms
    emulatedDevice: 0,   // our_descriptor_number
    normalizeGamepad: true,
    ignoreAuthDevInputs: false,
    gpioOutputMode: 0,
    inputLabels: 0,
    combosEnabled: true,
    comboWindow: DEFAULT_COMBO_WINDOW_MS,
    comboConsume: true,
  };

  // cosmetic tint id <-> hex (row background tint only; not a device field per se, stored as config.color)
  const TINT_HEX = {
    nav:    "#3b82f6",
    media:  "#22c55e",
    volume: "#f59e0b",
    system: "#a855f7",
    macro:  "#ec4899",
  };
  const HEX_TINT = Object.fromEntries(Object.entries(TINT_HEX).map(([k, v]) => [v.toLowerCase(), k]));

  // coerce a value to an int, falling back to 0 for junk
  const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

  const isHex = (s) => typeof s === "string" && /^0x[0-9a-fA-F]+$/.test(s);
  const normHex = (s) => {
    // normalize a usage to lowercase 0x + 8 hex digits (page<<16|id)
    if (typeof s === "number") s = "0x" + (s >>> 0).toString(16);
    if (!isHex(s)) return s;
    const n = parseInt(s, 16) >>> 0;
    return "0x" + n.toString(16).padStart(8, "0");
  };

  const comboUsage = (id) => normHex((COMBO_USAGE_PAGE | id) >>> 0);
  const isComboUsage = (u) => {
    const n = parseInt(normHex(u), 16) >>> 0;
    return Number.isFinite(n) && (n & 0xffff0000) >>> 0 === COMBO_USAGE_PAGE;
  };
  const comboId = (u) => (parseInt(normHex(u), 16) >>> 0) & 0xffff;

  /* ---- expression numbers are FIXED POINT on the device ----
     The device stores an expression's numeric constants as integers scaled by 1000 (the firmware's
     PUSH operand is ×1000 fixed point), while a human writes "0.05". v1 converts at the UI edge
     (code.js: ui_to_json does round(x*1000), json_to_ui does parseInt(x)/1000).

     v2 keeps APP.expressions in HUMAN units (that is what the editor reads and writes) and converts
     here, at the config boundary — exactly like ms<->µs and scale<->scaling. Getting this wrong is
     silent corruption: "0.05 mul" would be written to the device as "0 mul" (parseInt("0.05") === 0),
     multiplying the whole expression by zero, and a device value of 50 would display as "50". */
  // a NUMBER, not a usage: "0x00010030" also starts with a digit, so hex must be excluded or the
  // usage itself gets rescaled to 0
  const isNumTok = (t) => /^-?[0-9]/.test(t) && !/^-?0x/i.test(t);
  // Rescale numbers, but NEVER inside a /* comment */ — "/* scale 0.5 */" must stay as written.
  const mapExprNums = (expr, fn) => String(expr || "")
    .split(/(\/\*[\s\S]*?\*\/)/)          // keep comment blocks whole and untouched
    .map((chunk) => (chunk.startsWith("/*")
      ? chunk
      : chunk
        .split(/(\s+)/)                   // keep the whitespace so formatting survives
        .map((t) => (isNumTok(t) ? fn(t) : t))
        .join("")))
    .join("");

  // human "0.05"  ->  device "50"
  const exprToDevice = (expr) => mapExprNums(expr, (t) => {
    const x = parseFloat(t);
    return Number.isFinite(x) ? String(Math.round(x * 1000)) : t;
  });
  // device "50"  ->  human "0.05"
  const exprToApp = (expr) => mapExprNums(expr, (t) => {
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? String(n / 1000) : t;
  });

  function boolLayersToIndices(layers) {
    const out = [];
    (layers || []).forEach((on, i) => { if (on) out.push(i); });
    return out;
  }
  function indicesToBoolLayers(indices, n = NLAYERS) {
    const out = new Array(n).fill(false);
    (indices || []).forEach((i) => { if (i >= 0 && i < n) out[i] = true; });
    return out;
  }

  function tintToColor(tint) { return tint && TINT_HEX[tint] ? TINT_HEX[tint] : undefined; }
  function colorToTint(color) { return color && HEX_TINT[color.toLowerCase()] ? HEX_TINT[color.toLowerCase()] : null; }
  // v1 lets a row be ANY colour. v2 offers 5 named tints — but a colour it doesn't recognise must be
  // KEPT, not silently discarded, or importing a v1 config quietly loses the user's colour coding.
  const keepColor = (color) => (color && !HEX_TINT[String(color).toLowerCase()] ? color : undefined);

  // ---- single mapping conversions ----
  function appMappingToConfig(m) {
    const cm = {
      source_usage: normHex(m.inputs[0]),
      target_usage: normHex(m.output),
      layers: boolLayersToIndices(m.layers),
      sticky: !!m.sticky,
      tap: !!m.tap,
      hold: !!m.hold,
      combo_consume: false,
      scaling: Math.round((m.scale == null ? 1 : m.scale) * 1000),
      source_port: m.source_port || 0,
      target_port: m.target_port || 0,
    };
    const color = tintToColor(m.tint) || m.customColor;
    if (color) cm.color = color;
    return cm;
  }

  function configMappingToApp(cm, uid) {
    return {
      id: uid ? uid() : (configMappingToApp._n = (configMappingToApp._n || 0) + 1),
      inputs: [normHex(cm.source_usage)],
      output: normHex(cm.target_usage),
      enabled: true, // device doesn't store an "enabled" flag; everything on device is enabled
      layers: indicesToBoolLayers(cm.layers, NLAYERS),
      sticky: !!cm.sticky,
      tap: !!cm.tap,
      hold: !!cm.hold,
      scale: (cm.scaling == null ? DEFAULT_SCALING : cm.scaling) / 1000,
      tint: colorToTint(cm.color),
      customColor: keepColor(cm.color),   // a v1 colour we have no tint for — do not lose it
      source_port: cm.source_port || 0,
      target_port: cm.target_port || 0,
      comboWindow: DEFAULT_COMBO_WINDOW_MS,
      comboConsume: true,
    };
  }

  // ---- combo: one APP row -> N member mappings + 1 trigger mapping ----
  // The window rides in the members' `scaling` (ms; 0 = no timing check) and the
  // consume flag in `combo_consume` (device.js writes it to flags bit 3).
  function appComboToConfigMappings(m, id) {
    const layers = boolLayersToIndices(m.layers);
    const raw = m.comboWindow == null ? DEFAULT_COMBO_WINDOW_MS : m.comboWindow;
    const windowMs = Math.max(0, Math.min(5000, Math.round(raw) || 0));
    const consume = m.comboConsume !== false;
    const target = comboUsage(id);

    const members = m.inputs.map((code) => ({
      source_usage: normHex(code),
      target_usage: target,
      layers,
      sticky: false,
      tap: false,
      hold: false,
      combo_consume: consume,
      scaling: windowMs,
      source_port: m.source_port || 0,
      target_port: 0,
    }));

    const trigger = {
      source_usage: target,
      target_usage: normHex(m.output),
      layers,
      sticky: !!m.sticky,
      tap: !!m.tap,
      hold: !!m.hold,
      combo_consume: false,
      scaling: Math.round((m.scale == null ? 1 : m.scale) * 1000),
      source_port: 0,
      target_port: m.target_port || 0,
    };
    const color = tintToColor(m.tint);
    if (color) trigger.color = color;

    return members.concat([trigger]);
  }

  // ---- whole-config conversions ----
  // opts.forDevice=true -> only enabled rows (the device has no "disabled" concept).
  //  Default (JSON/full)-> every row, plus the additive `disabled_rows` array.
  // Combo rows are compiled into real mappings in BOTH cases — they are device state now.
  function appToConfig(APP, opts) {
    opts = opts || {};
    const s = APP.settings || {};
    const combosEnabled = s.combosEnabled !== false;

    const rows = APP.mappings || [];
    const usable = opts.forDevice ? rows.filter((m) => m.enabled !== false) : rows;

    // An UNFINISHED row must never reach the device.
    //   * output 0x00000000  -> the mapping fires nothing.
    //   * a COMBO key left at 0x00000000 -> the combo is an AND with a key that can never be
    //     pressed, so it silently never fires. (Clicking "+" inserts exactly this placeholder.)
    // NOTE: a SINGLE input of 0x00000000 is legitimate — it is the "always on" source used to
    // drive the RGB LED — so it is deliberately allowed through.
    const isIncomplete = (m) => {
      const out = normHex(m.output);
      if (out === "0x00000000") return true;
      const ins = m.inputs || [];
      if (ins.length > 1 && ins.some((c) => normHex(c) === "0x00000000")) return true;
      return false;
    };

    const mappings = [];
    let nextComboId = 1;
    let comboOverflow = 0;
    let comboSkipped = 0;
    let incomplete = 0;
    usable.forEach((m) => {
      if (opts.forDevice && isIncomplete(m)) { incomplete++; return; }
      if ((m.inputs || []).length > 1) {
        // A combo row may be withheld from the DEVICE (master switch off, or past the
        // firmware's NCOMBOS limit) — but it must NEVER be stripped from a JSON export.
        // Doing so would delete the user's combo rows from their own config file and
        // misalign disabled_rows (one entry per row) on re-import.
        if (opts.forDevice && !combosEnabled) { comboSkipped++; return; }
        if (opts.forDevice && nextComboId > NCOMBOS) { comboOverflow++; return; }
        // ids past NCOMBOS only ever appear in an export, which the firmware never sees
        mappings.push(...appComboToConfigMappings(m, nextComboId++));
      } else {
        mappings.push(appMappingToConfig(m));
      }
    });

    const config = {
      version: CONFIG_VERSION,
      mappings,
      expressions: (APP.expressions || []).map(exprToDevice),   // human -> device fixed point
      macros: APP.macros ? APP.macros.slice() : Array.from({ length: 32 }, () => []),
      quirks: APP.quirks ? APP.quirks.slice() : [],
      // settings
      unmapped_passthrough_layers: boolLayersToIndices(s.passthrough || []),
      partial_scroll_timeout: (s.scrollTimeout == null ? DEFAULTS.scrollTimeout : s.scrollTimeout) * 1000, // ms -> µs
      tap_hold_threshold: (s.tapHold == null ? DEFAULTS.tapHold : s.tapHold) * 1000, // ms -> µs
      interval_override: toInt(s.interval),
      our_descriptor_number: toInt(s.emulatedDevice),
      gpio_debounce_time_ms: s.gpioDebounce == null ? DEFAULTS.gpioDebounce : toInt(s.gpioDebounce),
      macro_entry_duration: toInt(s.macroEntryDuration) || DEFAULTS.macroEntryDuration,
      // device flags + UI label set (defaults keep the exported JSON importable by the stock tool)
      ignore_auth_dev_inputs: !!s.ignoreAuthDevInputs,
      gpio_output_mode: s.gpioOutputMode ? 1 : 0,
      input_labels: toInt(s.inputLabels),
      normalize_gamepad_inputs: s.normalizeGamepad == null ? true : !!s.normalizeGamepad,
    };
    // additive, web-only: which rows are switched off, and the combo master switch
    if (!opts.forDevice) {
      config.disabled_rows = rows.map((m) => m.enabled === false);
      config.combos_enabled = combosEnabled;
    }
    // non-persisted hints for the caller (app.js warns the user); stripped from JSON exports
    if (comboOverflow) config.combo_overflow = comboOverflow;
    if (comboSkipped) config.combo_skipped = comboSkipped;
    if (incomplete) config.incomplete = incomplete;
    return config;
  }

  function configToApp(config, base, uid) {
    base = base || {};
    const raw = config.mappings || [];

    // members, grouped by combo id, in wire order
    const membersById = {};
    raw.forEach((cm) => {
      if (isComboUsage(cm.target_usage)) {
        const id = comboId(cm.target_usage);
        (membersById[id] = membersById[id] || []).push(cm);
      }
    });
    const hasTrigger = (id) => raw.some((cm) => isComboUsage(cm.source_usage) && comboId(cm.source_usage) === id);

    const mappings = [];
    raw.forEach((cm) => {
      if (isComboUsage(cm.target_usage)) return; // member — folded into its trigger below

      if (isComboUsage(cm.source_usage)) {
        const id = comboId(cm.source_usage);
        const members = membersById[id];
        if (members && members.length) {
          const row = configMappingToApp(cm, uid); // trigger supplies output/scale/flags/layers
          row.inputs = members.map((mm) => normHex(mm.source_usage));
          row.comboWindow = members[0].scaling == null ? DEFAULT_COMBO_WINDOW_MS : members[0].scaling;
          row.comboConsume = members.some((mm) => !!mm.combo_consume);
          mappings.push(row);
          return;
        }
        // a trigger with no members: keep it as a plain row so it is visible, not lost
      }
      mappings.push(configMappingToApp(cm, uid));
    });

    // members whose trigger never arrived -> keep as plain rows so nothing silently vanishes
    Object.keys(membersById).forEach((k) => {
      const id = Number(k);
      if (!hasTrigger(id)) membersById[id].forEach((cm) => mappings.push(configMappingToApp(cm, uid)));
    });

    // restore which rows were switched off (additive, web-only)
    if (Array.isArray(config.disabled_rows)) {
      config.disabled_rows.forEach((off, i) => { if (mappings[i] && off) mappings[i].enabled = false; });
    }

    const settings = Object.assign({}, base.settings, {
      passthrough: indicesToBoolLayers(
        config.unmapped_passthrough_layers == null ? DEFAULTS.passthroughLayers : config.unmapped_passthrough_layers,
        NLAYERS),
      scrollTimeout: Math.round((config.partial_scroll_timeout == null ? DEFAULTS.scrollTimeout * 1000 : config.partial_scroll_timeout) / 1000),
      tapHold: Math.round((config.tap_hold_threshold == null ? DEFAULTS.tapHold * 1000 : config.tap_hold_threshold) / 1000),
      interval: config.interval_override || 0,
      emulatedDevice: config.our_descriptor_number || 0,
      gpioDebounce: config.gpio_debounce_time_ms == null ? DEFAULTS.gpioDebounce : toInt(config.gpio_debounce_time_ms),
      macroEntryDuration: config.macro_entry_duration == null ? DEFAULTS.macroEntryDuration : toInt(config.macro_entry_duration),
      combosEnabled: config.combos_enabled == null
        ? (base.settings && base.settings.combosEnabled !== false)
        : !!config.combos_enabled,
      // device flags + label set (round-trip so a load->save preserves them)
      ignoreAuthDevInputs: !!config.ignore_auth_dev_inputs,
      gpioOutputMode: config.gpio_output_mode ? 1 : 0,
      inputLabels: toInt(config.input_labels),
      normalizeGamepad: config.normalize_gamepad_inputs == null ? true : !!config.normalize_gamepad_inputs,
    });

    return Object.assign({}, base, {
      mappings,
      expressions: (config.expressions || (base.expressions || [])).map(exprToApp), // device -> human
      macros: config.macros ? config.macros.slice() : (base.macros || Array.from({ length: 32 }, () => [])),
      // quirks MUST be carried back: saveToDevice() sends CLEAR_QUIRKS and then writes
      // config.quirks, so dropping them here would erase the device's quirks on the next save.
      quirks: config.quirks ? config.quirks.slice() : (base.quirks || []),
      // the usages THIS device reports (not persisted — it is what the hardware told us)
      deviceUsages: config.device_usages || base.deviceUsages || null,
      settings,
    });
  }

  const API = {
    NLAYERS, CONFIG_VERSION, DEFAULTS,
    COMBO_USAGE_PAGE, NCOMBOS, DEFAULT_COMBO_WINDOW_MS,
    normHex, boolLayersToIndices, indicesToBoolLayers,
    comboUsage, isComboUsage, comboId,
    appMappingToConfig, configMappingToApp, appComboToConfigMappings,
    exprToDevice, exprToApp,
    appToConfig, configToApp,
  };

  if (typeof window !== "undefined") window.HRX_TRANSLATE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
