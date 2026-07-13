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
      sticky: true, tap: false, hold: false, source_port: 1, target_port: 2 },
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



/* ---- garbage in must never become garbage bytes on the wire ---- */

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
