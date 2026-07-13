/* Round-trip SAFETY tests.

   saveToDevice() sends CLEAR_MAPPING / CLEAR_MACROS / CLEAR_EXPRESSIONS / CLEAR_QUIRKS and then
   writes whatever the config object holds. So any field the device stores that we read on load
   but DROP on the way back is silent data loss on the user's device. These tests exist to make
   that impossible to regress.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const T = require("../js/translate.js");

const L0 = [true, false, false, false, false, false, false, false];
const ALL = [true, true, true, true, true, true, true, true];

function appWith(mappings, settings) {
  return {
    mappings,
    expressions: [],
    settings: Object.assign({ emulatedDevice: 0, passthrough: ALL }, settings),
  };
}

// a config shaped exactly like one a real device returns, with every field populated
const FULL_DEVICE_CONFIG = {
  version: 18,
  mappings: [
    { source_usage: "0x00070052", target_usage: "0x00070051", scaling: 1500, layers: [0, 2],
      sticky: true, tap: false, hold: false, combo_consume: false, source_port: 1, target_port: 2 },
    { source_usage: "0x000c00e9", target_usage: "0xfffb0001", scaling: 75, layers: [0], combo_consume: true },
    { source_usage: "0x000c00ea", target_usage: "0xfffb0001", scaling: 75, layers: [0], combo_consume: true },
    { source_usage: "0xfffb0001", target_usage: "0x000c00e2", scaling: 1000, layers: [0], hold: true },
  ],
  macros: [[["0x000700e0", "0x00070006"]], [["0x000c0223"]]].concat(Array.from({ length: 30 }, () => [])),
  expressions: ["0x00010030 input_state -128 add", "", "", "", "", "", "", ""],
  quirks: [{ vendor_id: "0x1234", product_id: "0x5678", interface: 0, report_id: 1,
             usage: "0x00090001", bitpos: 8, size: 8, relative: false, signed: true }],
  unmapped_passthrough_layers: [0, 1, 2, 3, 4, 5, 6, 7],
  partial_scroll_timeout: 1000000,
  tap_hold_threshold: 200000,
  interval_override: 4,
  our_descriptor_number: 3,
  gpio_debounce_time_ms: 7,
  macro_entry_duration: 2,
  ignore_auth_dev_inputs: true,
  gpio_output_mode: 1,
  normalize_gamepad_inputs: false,
};

test("a device config survives load -> save with NOTHING dropped", () => {
  const back = T.appToConfig(T.configToApp(FULL_DEVICE_CONFIG, {}, null), { forDevice: true });

  // the three data-loss traps
  assert.deepStrictEqual(back.macros, FULL_DEVICE_CONFIG.macros, "macros must survive");
  assert.deepStrictEqual(back.expressions, FULL_DEVICE_CONFIG.expressions, "expressions must survive");
  assert.deepStrictEqual(back.quirks, FULL_DEVICE_CONFIG.quirks, "quirks must survive (CLEAR_QUIRKS would wipe them)");

  // every scalar setting
  assert.deepStrictEqual(back.unmapped_passthrough_layers, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(back.partial_scroll_timeout, 1000000);
  assert.strictEqual(back.tap_hold_threshold, 200000);
  assert.strictEqual(back.interval_override, 4);
  assert.strictEqual(back.our_descriptor_number, 3);
  assert.strictEqual(back.gpio_debounce_time_ms, 7);
  assert.strictEqual(back.macro_entry_duration, 2);
  assert.strictEqual(back.ignore_auth_dev_inputs, true);
  assert.strictEqual(back.gpio_output_mode, 1);
  assert.strictEqual(back.normalize_gamepad_inputs, false);
  assert.strictEqual(back.version, 18);
});

test("a plain mapping keeps its ports, scaling and flags", () => {
  const back = T.appToConfig(T.configToApp(FULL_DEVICE_CONFIG, {}, null), { forDevice: true });
  const m = back.mappings[0];
  assert.strictEqual(m.source_usage, "0x00070052");
  assert.strictEqual(m.scaling, 1500);
  assert.strictEqual(m.sticky, true);
  assert.strictEqual(m.source_port, 1);
  assert.strictEqual(m.target_port, 2);
  assert.deepStrictEqual(m.layers, [0, 2]);
});

test("the combo inside a real device config round-trips window/consume/hold", () => {
  const app = T.configToApp(FULL_DEVICE_CONFIG, {}, null);
  const combo = app.mappings.find((m) => m.inputs.length > 1);
  assert.ok(combo, "the 3 combo mappings must fold into ONE row");
  assert.strictEqual(combo.comboWindow, 75);
  assert.strictEqual(combo.comboConsume, true);
  assert.strictEqual(combo.hold, true, "the trigger's hold flag belongs to the row");

  const back = T.appToConfig(app, { forDevice: true });
  const members = back.mappings.filter((m) => m.target_usage.startsWith("0xfffb"));
  const trigger = back.mappings.find((m) => m.source_usage.startsWith("0xfffb"));
  assert.strictEqual(members.length, 2);
  assert.strictEqual(members[0].scaling, 75);
  assert.strictEqual(members[0].combo_consume, true);
  assert.strictEqual(trigger.hold, true);
});

/* ---- the Combos master switch must not eat the user's own config file ---- */

test("Combos OFF: withheld from the DEVICE, but kept in the JSON export", () => {
  const app = appWith([
    { id: 1, inputs: ["0x00070052"], output: "0x00070052", enabled: true, layers: L0, scale: 1 },
    { id: 2, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: true,
      layers: L0, scale: 1, comboWindow: 50, comboConsume: true },
  ], { combosEnabled: false });

  const dev = T.appToConfig(app, { forDevice: true });
  assert.strictEqual(dev.mappings.length, 1, "the combo must not be sent to the device");
  assert.strictEqual(dev.combo_skipped, 1, "and the caller must be told, so it can warn");

  const json = T.appToConfig(app, {});
  const comboMappings = json.mappings.filter((m) =>
    m.target_usage.startsWith("0xfffb") || m.source_usage.startsWith("0xfffb"));
  assert.strictEqual(comboMappings.length, 3, "the JSON export must NOT delete the combo row");
  assert.strictEqual(json.combos_enabled, false);
  assert.strictEqual(json.disabled_rows.length, 2, "one entry per row -- still aligned");

  const reloaded = T.configToApp(json, {}, null);
  assert.strictEqual(reloaded.mappings.length, 2);
  assert.strictEqual(reloaded.mappings[1].inputs.length, 2);
  assert.strictEqual(reloaded.settings.combosEnabled, false);
});

test("Combos OFF keeps each combo's own window (not zeroed)", () => {
  const app = appWith([
    { id: 1, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: true,
      layers: L0, scale: 1, comboWindow: 120, comboConsume: true },
  ], { combosEnabled: false });
  const reloaded = T.configToApp(T.appToConfig(app, {}), {}, null);
  assert.strictEqual(reloaded.mappings[0].comboWindow, 120, "the master switch must not destroy the window");
});

test("disabled_rows stays aligned when a COMBO row is switched off", () => {
  const app = appWith([
    { id: 1, inputs: ["0x00070052"], output: "0x00070052", enabled: true, layers: L0, scale: 1 },
    { id: 2, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: false,
      layers: L0, scale: 1, comboWindow: 50, comboConsume: true },
    { id: 3, inputs: ["0x00070050"], output: "0x00070050", enabled: true, layers: L0, scale: 1 },
  ]);
  const json = T.appToConfig(app, {});
  assert.deepStrictEqual(json.disabled_rows, [false, true, false]);

  const back = T.configToApp(json, {}, null);
  assert.strictEqual(back.mappings.length, 3);
  assert.strictEqual(back.mappings[0].enabled, true);
  assert.strictEqual(back.mappings[1].enabled, false, "the disabled combo row must come back disabled");
  assert.strictEqual(back.mappings[2].enabled, true);
});

/* ---- garbage in must never become garbage bytes on the wire ---- */

test("a NaN / negative / absurd combo window is clamped, never NaN", () => {
  const win = (w) => T.appToConfig(appWith([
    { id: 1, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: true,
      layers: L0, scale: 1, comboWindow: w, comboConsume: true },
  ]), { forDevice: true }).mappings[0].scaling;

  assert.strictEqual(win(NaN), 0);
  assert.strictEqual(win(-50), 0);
  assert.strictEqual(win(99999), 5000);
  assert.strictEqual(win("75"), 75);
  assert.strictEqual(win(undefined), 50, "undefined falls back to the default");
});

test("combo ids are contiguous and never exceed NCOMBOS", () => {
  const rows = Array.from({ length: T.NCOMBOS }, (_, i) => ({
    id: i + 1, inputs: ["0x00070004", "0x00070005"], output: "0x00070029",
    enabled: true, layers: L0, scale: 1, comboWindow: 50, comboConsume: true,
  }));
  const cfg = T.appToConfig(appWith(rows), { forDevice: true });
  const ids = cfg.mappings
    .filter((m) => m.source_usage.startsWith("0xfffb"))
    .map((m) => parseInt(m.source_usage, 16) & 0xffff);
  assert.deepStrictEqual(ids, Array.from({ length: T.NCOMBOS }, (_, i) => i + 1));
});

test("every mapping sent to the device has finite, in-range numbers", () => {
  const cfg = T.appToConfig(T.configToApp(FULL_DEVICE_CONFIG, {}, null), { forDevice: true });
  for (const m of cfg.mappings) {
    assert.ok(Number.isFinite(m.scaling), "scaling must be a number, not NaN");
    assert.ok(m.scaling >= -2147483648 && m.scaling <= 2147483647, "scaling must fit i32");
    assert.ok(/^0x[0-9a-f]{8}$/.test(m.source_usage), "source usage must be 8 hex digits");
    assert.ok(/^0x[0-9a-f]{8}$/.test(m.target_usage), "target usage must be 8 hex digits");
    assert.ok(m.layers.every((l) => l >= 0 && l < 8), "layer indices must be 0-7");
    assert.ok(m.source_port >= 0 && m.source_port <= 15, "source_port must fit a nibble");
    assert.ok(m.target_port >= 0 && m.target_port <= 15, "target_port must fit a nibble");
  }
});
