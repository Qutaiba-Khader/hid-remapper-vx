/* Node tests for the APP <-> device-config translation.
   Run: cd config-tool-web-v2 && node --test tests/ */
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

test("disabled rows are not sent to the device", () => {
  const app = appWith([
    { id: 1, inputs: ["0x000c00e9"], output: "0x000c00e2", enabled: false, layers: L0, scale: 1 },
  ]);
  assert.strictEqual(T.appToConfig(app, { forDevice: true }).mappings.length, 0);
});



/* ---------------- settings defaults (must match the firmware) ---------------- */

test("DEFAULTS match firmware/src/globals.cc + the stock tool", () => {
  assert.deepStrictEqual(T.DEFAULTS.passthroughLayers, [0, 1, 2, 3, 4, 5, 6, 7]); // 0b11111111
  assert.strictEqual(T.DEFAULTS.scrollTimeout, 1000);      // 1000000 µs
  assert.strictEqual(T.DEFAULTS.tapHold, 200);             // 200000 µs
  assert.strictEqual(T.DEFAULTS.interval, 0);
  assert.strictEqual(T.DEFAULTS.gpioDebounce, 5);
  assert.strictEqual(T.DEFAULTS.macroEntryDuration, 1);
  assert.strictEqual(T.DEFAULTS.normalizeGamepad, true);
});

test("default settings serialize to the firmware's own default values", () => {
  const app = appWith([], {
    passthrough: ALL,
    scrollTimeout: T.DEFAULTS.scrollTimeout,
    tapHold: T.DEFAULTS.tapHold,
    interval: T.DEFAULTS.interval,
    gpioDebounce: T.DEFAULTS.gpioDebounce,
    macroEntryDuration: T.DEFAULTS.macroEntryDuration,
  });
  const cfg = T.appToConfig(app, { forDevice: true });
  assert.deepStrictEqual(cfg.unmapped_passthrough_layers, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(cfg.partial_scroll_timeout, 1000000); // µs
  assert.strictEqual(cfg.tap_hold_threshold, 200000);      // µs
  assert.strictEqual(cfg.interval_override, 0);
  assert.strictEqual(cfg.gpio_debounce_time_ms, 5);
  assert.strictEqual(cfg.macro_entry_duration, 1);
});

test("settings survive a config -> APP -> config round trip", () => {
  const cfg0 = {
    version: 18, mappings: [],
    unmapped_passthrough_layers: [0, 1, 2, 3, 4, 5, 6, 7],
    partial_scroll_timeout: 1000000,
    tap_hold_threshold: 200000,
    interval_override: 0,
    our_descriptor_number: 2,
    gpio_debounce_time_ms: 5,
    macro_entry_duration: 1,
    normalize_gamepad_inputs: true,
  };
  const cfg1 = T.appToConfig(T.configToApp(cfg0, {}, null), { forDevice: true });
  assert.deepStrictEqual(cfg1.unmapped_passthrough_layers, cfg0.unmapped_passthrough_layers);
  assert.strictEqual(cfg1.partial_scroll_timeout, cfg0.partial_scroll_timeout);
  assert.strictEqual(cfg1.tap_hold_threshold, cfg0.tap_hold_threshold);
  assert.strictEqual(cfg1.our_descriptor_number, 2);
  assert.strictEqual(cfg1.gpio_debounce_time_ms, 5);
  assert.strictEqual(cfg1.macro_entry_duration, 1);
});
