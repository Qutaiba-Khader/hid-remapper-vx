/*
 * translate.js — maps between the new UI's APP model and the device `config` model.
 *
 * APP mapping  : { id, inputs:[hex,...], output:hex, enabled, layers:[bool,...],
 *                  sticky, tap, hold, scale(float), tint }
 * config mapping: { source_usage:hex, target_usage:hex, layers:[indices 0-7],
 *                  sticky, tap, hold, scaling(int ×1000), source_port, target_port, color:'#rrggbb' }
 *
 * Rules (see docs/superpowers/plans/2026-07-08-web-redesign-phase1-blueprint.md §A/§E):
 *  - single-input APP mappings  -> device `config.mappings`
 *  - combo APP mappings (inputs>1) -> additive `config.combos[]` (NOT written to device; firmware-gated)
 *  - APP.enabled === false        -> kept in JSON, but skipped when saving to the device
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

  // cosmetic tint id <-> hex (row background tint only; not a device field per se, stored as config.color)
  const TINT_HEX = {
    nav:    "#3b82f6",
    media:  "#22c55e",
    volume: "#f59e0b",
    system: "#a855f7",
    macro:  "#ec4899",
  };
  const HEX_TINT = Object.fromEntries(Object.entries(TINT_HEX).map(([k, v]) => [v.toLowerCase(), k]));

  // coerce a value to a non-negative int; the mock stores some device-enum fields as display
  // strings (e.g. settings.emulatedDevice = "Mouse + Keyboard") — those become 0 until Phase 3
  // wires the Settings string<->enum mapping. Real numeric values pass through unchanged.
  const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

  const isHex = (s) => typeof s === "string" && /^0x[0-9a-fA-F]+$/.test(s);
  const normHex = (s) => {
    // normalize a usage to lowercase 0x + 8 hex digits (page<<16|id)
    if (typeof s === "number") s = "0x" + (s >>> 0).toString(16);
    if (!isHex(s)) return s;
    const n = parseInt(s, 16) >>> 0;
    return "0x" + n.toString(16).padStart(8, "0");
  };

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

  // ---- single mapping conversions ----
  function appMappingToConfig(m) {
    const cm = {
      source_usage: normHex(m.inputs[0]),
      target_usage: normHex(m.output),
      layers: boolLayersToIndices(m.layers),
      sticky: !!m.sticky,
      tap: !!m.tap,
      hold: !!m.hold,
      scaling: Math.round((m.scale == null ? 1 : m.scale) * 1000),
      source_port: m.source_port || 0,
      target_port: m.target_port || 0,
    };
    const color = tintToColor(m.tint);
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
      source_port: cm.source_port || 0,
      target_port: cm.target_port || 0,
    };
  }

  // combo (inputs>1) — additive JSON only. Store the extra inputs alongside a device-shaped entry.
  function appComboToJson(m) {
    return {
      inputs: m.inputs.map(normHex),
      target_usage: normHex(m.output),
      layers: boolLayersToIndices(m.layers),
      sticky: !!m.sticky, tap: !!m.tap, hold: !!m.hold,
      scaling: Math.round((m.scale == null ? 1 : m.scale) * 1000),
      enabled: m.enabled !== false,
      tint: m.tint || null,
    };
  }
  function jsonComboToApp(c, uid) {
    return {
      id: uid ? uid() : (jsonComboToApp._n = (jsonComboToApp._n || 0) + 1),
      inputs: (c.inputs || []).map(normHex),
      output: normHex(c.target_usage),
      enabled: c.enabled !== false,
      layers: indicesToBoolLayers(c.layers, NLAYERS),
      sticky: !!c.sticky, tap: !!c.tap, hold: !!c.hold,
      scale: (c.scaling == null ? DEFAULT_SCALING : c.scaling) / 1000,
      tint: c.tint || null,
    };
  }

  // ---- whole-config conversions ----
  // opts.forDevice=true  -> only what the device accepts: single-input, enabled mappings (combos excluded).
  //  Default (JSON/full) -> single mappings + additive combos[] + preserves enabled flags in a parallel array.
  function appToConfig(APP, opts) {
    opts = opts || {};
    const singles = APP.mappings.filter((m) => (m.inputs || []).length <= 1);
    const combos = APP.mappings.filter((m) => (m.inputs || []).length > 1);

    const usableSingles = opts.forDevice ? singles.filter((m) => m.enabled !== false) : singles;

    const s = APP.settings || {};
    const config = {
      version: CONFIG_VERSION,
      mappings: usableSingles.map(appMappingToConfig),
      expressions: (APP.expressions || []).slice(),
      macros: APP.macros ? APP.macros.slice() : Array.from({ length: 32 }, () => []),
      quirks: APP.quirks ? APP.quirks.slice() : [],
      // settings
      unmapped_passthrough_layers: boolLayersToIndices(s.passthrough || []),
      partial_scroll_timeout: (s.scrollTimeout == null ? 1000 : s.scrollTimeout) * 1000, // ms -> µs
      tap_hold_threshold: (s.tapHold == null ? 200 : s.tapHold) * 1000, // ms -> µs
      interval_override: toInt(s.interval),
      our_descriptor_number: toInt(s.emulatedDevice),
      gpio_debounce_time_ms: s.gpioDebounce == null ? 5 : toInt(s.gpioDebounce),
      macro_entry_duration: toInt(s.macroEntryDuration) || 10,
      // device flags + UI label set (defaults keep the exported JSON importable by the stock tool)
      ignore_auth_dev_inputs: !!s.ignoreAuthDevInputs,
      gpio_output_mode: s.gpioOutputMode ? 1 : 0,
      input_labels: toInt(s.inputLabels),
      normalize_gamepad_inputs: s.normalizeGamepad == null ? true : !!s.normalizeGamepad,
    };
    // additive, web-only: combos + per-single enabled flags (so JSON export round-trips disabled state)
    if (!opts.forDevice) {
      config.combos = combos.map(appComboToJson);
      config.disabled_singles = singles.map((m) => m.enabled === false);
      config.combo_window = s.comboWindow || 50;
    }
    return config;
  }

  function configToApp(config, base, uid) {
    base = base || {};
    const singles = (config.mappings || []).map((cm) => configMappingToApp(cm, uid));
    // restore disabled state (from our additive field) if present
    if (Array.isArray(config.disabled_singles)) {
      config.disabled_singles.forEach((off, i) => { if (singles[i] && off) singles[i].enabled = false; });
    }
    const combos = (config.combos || []).map((c) => jsonComboToApp(c, uid));
    const mappings = singles.concat(combos);

    const settings = Object.assign({}, base.settings, {
      passthrough: indicesToBoolLayers(config.unmapped_passthrough_layers, NLAYERS),
      scrollTimeout: Math.round((config.partial_scroll_timeout == null ? 1000000 : config.partial_scroll_timeout) / 1000),
      tapHold: Math.round((config.tap_hold_threshold == null ? 200000 : config.tap_hold_threshold) / 1000),
      interval: config.interval_override || 0,
      emulatedDevice: config.our_descriptor_number || 0,
      comboWindow: config.combo_window || (base.settings && base.settings.comboWindow) || 50,
      // device flags + label set (round-trip so a load->save preserves them)
      ignoreAuthDevInputs: !!config.ignore_auth_dev_inputs,
      gpioOutputMode: config.gpio_output_mode ? 1 : 0,
      inputLabels: toInt(config.input_labels),
      normalizeGamepad: config.normalize_gamepad_inputs == null ? true : !!config.normalize_gamepad_inputs,
    });

    return Object.assign({}, base, {
      mappings,
      expressions: (config.expressions || (base.expressions || [])).slice(),
      macros: config.macros ? config.macros.slice() : (base.macros || Array.from({ length: 32 }, () => [])),
      settings,
    });
  }

  const API = {
    NLAYERS, CONFIG_VERSION,
    normHex, boolLayersToIndices, indicesToBoolLayers,
    appMappingToConfig, configMappingToApp,
    appComboToJson, jsonComboToApp,
    appToConfig, configToApp,
  };

  if (typeof window !== "undefined") window.HRX_TRANSLATE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
