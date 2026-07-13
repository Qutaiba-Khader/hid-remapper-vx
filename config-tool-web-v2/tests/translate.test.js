/* Node tests for the APP <-> device-config translation, incl. combos (usage page 0xFFFB).
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

/* ---------------- combo compile ---------------- */

test("combo row compiles to 2 members + 1 trigger", () => {
  const app = appWith([
    { id: 1, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: true,
      layers: L0, sticky: false, tap: false, hold: false, scale: 1,
      comboWindow: 50, comboConsume: true },
  ]);
  const cfg = T.appToConfig(app, { forDevice: true });

  assert.strictEqual(cfg.version, 18);
  assert.strictEqual(cfg.mappings.length, 3);

  const [m1, m2, trig] = cfg.mappings;
  assert.strictEqual(m1.source_usage, "0x000c00e9");
  assert.strictEqual(m1.target_usage, "0xfffb0001");
  assert.strictEqual(m1.scaling, 50);
  assert.strictEqual(m1.combo_consume, true);

  assert.strictEqual(m2.source_usage, "0x000c00ea");
  assert.strictEqual(m2.target_usage, "0xfffb0001");

  assert.strictEqual(trig.source_usage, "0xfffb0001");
  assert.strictEqual(trig.target_usage, "0x000c00e2");
  assert.strictEqual(trig.scaling, 1000);
  assert.strictEqual(trig.combo_consume, false);

  assert.strictEqual(cfg.combos, undefined); // the old additive field is gone
});

test("trigger carries sticky/tap/hold; members never do", () => {
  const app = appWith([
    { id: 1, inputs: ["0x00070004", "0x00070005"], output: "0x00070029", enabled: true,
      layers: L0, sticky: true, tap: true, hold: false, scale: 2,
      comboWindow: 0, comboConsume: false },
  ]);
  const [m1, m2, trig] = T.appToConfig(app, { forDevice: true }).mappings;
  assert.strictEqual(m1.sticky, false);
  assert.strictEqual(m2.tap, false);
  assert.strictEqual(m1.scaling, 0);            // window 0 = pure AND
  assert.strictEqual(m1.combo_consume, false);
  assert.strictEqual(trig.sticky, true);
  assert.strictEqual(trig.tap, true);
  assert.strictEqual(trig.scaling, 2000);       // ×2.0
});

test("combo ids increment per combo row; singles pass through", () => {
  const app = appWith([
    { id: 1, inputs: ["0x00070052"], output: "0x00070052", enabled: true, layers: L0, scale: 1 },
    { id: 2, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: true,
      layers: L0, scale: 1, comboWindow: 50, comboConsume: true },
    { id: 3, inputs: ["0x00070004", "0x00070005"], output: "0x00070029", enabled: true,
      layers: L0, scale: 1, comboWindow: 50, comboConsume: true },
  ]);
  const cfg = T.appToConfig(app, { forDevice: true });
  assert.strictEqual(cfg.mappings.length, 1 + 3 + 3);
  assert.strictEqual(cfg.mappings[0].target_usage, "0x00070052");
  assert.strictEqual(cfg.mappings[1].target_usage, "0xfffb0001");
  assert.strictEqual(cfg.mappings[4].target_usage, "0xfffb0002");
  assert.strictEqual(cfg.mappings[6].source_usage, "0xfffb0002");
});

test("disabled rows are not sent to the device", () => {
  const app = appWith([
    { id: 1, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: false,
      layers: L0, scale: 1, comboWindow: 50, comboConsume: true },
  ]);
  assert.strictEqual(T.appToConfig(app, { forDevice: true }).mappings.length, 0);
});

test("combos master switch OFF: combo rows are not sent, singles still are", () => {
  const app = appWith([
    { id: 1, inputs: ["0x00070052"], output: "0x00070052", enabled: true, layers: L0, scale: 1 },
    { id: 2, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: true,
      layers: L0, scale: 1, comboWindow: 50, comboConsume: true },
  ], { combosEnabled: false });
  const cfg = T.appToConfig(app, { forDevice: true });
  assert.strictEqual(cfg.mappings.length, 1);
  assert.strictEqual(cfg.mappings[0].source_usage, "0x00070052");
});

test("more than NCOMBOS combo rows: extras are dropped and reported", () => {
  const rows = [];
  for (let i = 0; i < T.NCOMBOS + 2; i++) {
    rows.push({ id: i + 1, inputs: ["0x00070004", "0x00070005"], output: "0x00070029",
      enabled: true, layers: L0, scale: 1, comboWindow: 50, comboConsume: true });
  }
  const cfg = T.appToConfig(appWith(rows), { forDevice: true });
  assert.strictEqual(cfg.mappings.length, T.NCOMBOS * 3);
  assert.strictEqual(cfg.combo_overflow, 2);
});

/* ---------------- combo fold ---------------- */

test("3 mappings fold back into 1 combo row", () => {
  const cfg = {
    version: 18,
    mappings: [
      { source_usage: "0x000c00e9", target_usage: "0xfffb0001", scaling: 50, layers: [0], combo_consume: true },
      { source_usage: "0x000c00ea", target_usage: "0xfffb0001", scaling: 50, layers: [0], combo_consume: true },
      { source_usage: "0xfffb0001", target_usage: "0x000c00e2", scaling: 1000, layers: [0], sticky: true },
    ],
  };
  const app = T.configToApp(cfg, {}, null);
  assert.strictEqual(app.mappings.length, 1);

  const row = app.mappings[0];
  assert.deepStrictEqual(row.inputs, ["0x000c00e9", "0x000c00ea"]);
  assert.strictEqual(row.output, "0x000c00e2");
  assert.strictEqual(row.comboWindow, 50);
  assert.strictEqual(row.comboConsume, true);
  assert.strictEqual(row.sticky, true);
  assert.strictEqual(row.scale, 1);
  assert.strictEqual(row.layers[0], true);
});

test("combo survives a full APP -> config -> APP round trip (3 keys)", () => {
  const app0 = appWith([
    { id: 1, inputs: ["0x00070052"], output: "0x00070052", enabled: true, layers: L0, scale: 1 },
    { id: 2, inputs: ["0x000c00e9", "0x000c00ea", "0x000c00cd"], output: "0x000c00e2", enabled: true,
      layers: L0, sticky: false, tap: true, hold: false, scale: 1,
      comboWindow: 120, comboConsume: false },
  ]);
  const back = T.configToApp(T.appToConfig(app0, { forDevice: true }), {}, null);

  assert.strictEqual(back.mappings.length, 2);
  const combo = back.mappings[1];
  assert.deepStrictEqual(combo.inputs, ["0x000c00e9", "0x000c00ea", "0x000c00cd"]);
  assert.strictEqual(combo.comboWindow, 120);
  assert.strictEqual(combo.comboConsume, false);
  assert.strictEqual(combo.tap, true);
});

test("an orphan combo member degrades to a plain row instead of vanishing", () => {
  const cfg = {
    version: 18,
    mappings: [{ source_usage: "0x000c00e9", target_usage: "0xfffb0003", scaling: 50, layers: [0] }],
  };
  const app = T.configToApp(cfg, {}, null);
  assert.strictEqual(app.mappings.length, 1);
  assert.deepStrictEqual(app.mappings[0].inputs, ["0x000c00e9"]);
  assert.strictEqual(app.mappings[0].output, "0xfffb0003");
});

test("a config with no combos is unchanged by the fold", () => {
  const cfg = {
    version: 18,
    mappings: [{ source_usage: "0x00070052", target_usage: "0x00070051", scaling: 1000, layers: [0, 1] }],
  };
  const app = T.configToApp(cfg, {}, null);
  assert.strictEqual(app.mappings.length, 1);
  assert.deepStrictEqual(app.mappings[0].inputs, ["0x00070052"]);
  assert.strictEqual(app.mappings[0].layers[1], true);
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
