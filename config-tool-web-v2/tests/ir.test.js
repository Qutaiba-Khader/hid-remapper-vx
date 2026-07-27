/* IR OUTPUT tests — the code rides the mapping's `scaling` field RAW (not ×1000), the protocol
   rides the target's low byte, and the global IR pin rides a synthetic 0xFFFB00FF mapping.
   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const T = require("../js/translate.js");
const IR = require("../js/ir-codes.js");

const ROOT = path.join(__dirname, "..", "..");
const FW = (f) => fs.readFileSync(path.join(ROOT, "firmware", "src", f), "utf8");

const SAMSUNG = "0xfffb0002";
const NEC = "0xfffb0001";
const POWER = 0xfd020707 >>> 0;  // Samsung power (cmd 0x02) — computed by the catalog

test("catalog codes match the firmware-validated formula (anchor: digit 1 = 0xFB040707)", () => {
  const sam = IR.DEVICES.find((d) => d.id === "samsung-tv");
  const one = sam.buttons.find((b) => b[0] === "1");
  assert.equal(one[1] >>> 0, 0xfb040707, "Samsung '1' must be 0xFB040707 (published anchor)");
  const power = sam.buttons.find((b) => b[0] === "Power");
  assert.equal(power[1] >>> 0, POWER);
});

test("isIrTarget: send targets yes, pin+other pages no", () => {
  assert.equal(T.isIrTarget(SAMSUNG), true);
  assert.equal(T.isIrTarget(NEC), true);
  assert.equal(T.isIrTarget("0xfffb00ff"), false); // the pin pseudo-mapping is not a send target
  assert.equal(T.isIrTarget("0xfffa0000"), false); // RGB LED
  assert.equal(T.isIrTarget("0x00090001"), false); // a real button
});

test("app->config writes the IR code RAW into scaling (not ×1000)", () => {
  const cm = T.appMappingToConfig({ inputs: ["0x00090001"], output: SAMSUNG, irCode: POWER, scale: 1 });
  assert.equal(cm.target_usage, "0xfffb0002");
  assert.equal(cm.scaling | 0, POWER | 0, "scaling must be the raw code, two's-complement int32");
  assert.notEqual(cm.scaling, 1000, "must NOT be scale×1000");
});

test("config->app reads the raw code back into irCode (unsigned), scale stays 1", () => {
  const app = T.configMappingToApp({ source_usage: "0x00090001", target_usage: SAMSUNG, scaling: POWER | 0 });
  assert.equal(app.irCode >>> 0, POWER, "high-bit code must survive the int32 round-trip");
  assert.equal(app.scale, 1);
});

test("whole-config round-trip preserves the IR code and the pin", () => {
  const APP = {
    mappings: [{ id: 1, inputs: ["0x00090001"], output: SAMSUNG, irCode: POWER, scale: 1, enabled: true, layers: [true] }],
    settings: { irOutputPin: 18 },
  };
  const cfg = T.appToConfig(APP, { forDevice: true });
  // one IR send mapping + one injected pin mapping
  const pin = cfg.mappings.find((m) => m.target_usage === "0xfffb00ff");
  assert.ok(pin, "a pin mapping must be injected when IR is used");
  assert.equal(pin.scaling | 0, 18);
  assert.equal(pin.source_usage, "0x00000000");

  const back = T.configToApp(cfg, {}, null);
  assert.equal(back.mappings.length, 1, "the pin mapping must NOT appear as a user row");
  assert.equal(back.mappings[0].irCode >>> 0, POWER);
  assert.equal(back.settings.irOutputPin, 18);
});

test("no pin mapping is injected when the config has no IR mappings", () => {
  const APP = { mappings: [{ id: 1, inputs: ["0x00090001"], output: "0x00070004", scale: 1, enabled: true, layers: [true] }], settings: {} };
  const cfg = T.appToConfig(APP, { forDevice: true });
  assert.ok(!cfg.mappings.some((m) => m.target_usage === "0xfffb00ff"), "no IR => no pin mapping");
});

test("an IR row with no code chosen is incomplete and is not sent to the device", () => {
  const APP = { mappings: [{ id: 1, inputs: ["0x00090001"], output: SAMSUNG, irCode: null, scale: 1, enabled: true, layers: [true] }], settings: {} };
  const cfg = T.appToConfig(APP, { forDevice: true });
  assert.equal(cfg.mappings.length, 0, "IR target with null code must be dropped");
  assert.equal(cfg.incomplete, 1);
});

test("firmware<->web contract: page + pin usage agree with remapper.h", () => {
  const h = FW("remapper.h");
  assert.match(h, /IR_USAGE_PAGE\s+0xFFFB0000/, "firmware IR page must be 0xFFFB0000");
  assert.match(h, /IR_CONFIG_PIN_USAGE.*0xFF/, "firmware pin usage must be IR page | 0xFF");
  assert.equal(IR.PAGE, 0xfffb);
  assert.equal(IR.PIN_USAGE, "0xfffb00ff");
  // protocol ids the web sends must match the firmware constants
  const irh = fs.readFileSync(path.join(ROOT, "firmware", "src", "ir_output.h"), "utf8");
  assert.match(irh, /IR_PROTO_NEC\s+1/);
  assert.match(irh, /IR_PROTO_SAMSUNG\s+2/);
  assert.equal(IR.PROTO.NEC, 1);
  assert.equal(IR.PROTO.SAMSUNG, 2);
});

/* ---- hold-to-repeat (0xFFFB00FE carries the interval, like 0xFFFB00FF carries the pin) ---- */

test("the repeat carrier is NOT a send target (0xFE, like 0xFF, is config not a protocol)", () => {
  // If this ever returns true the tool renders an IR command editor on the settings carrier and
  // appToConfig writes a bogus code into the interval.
  assert.equal(T.isIrTarget("0xfffb00fe"), false);
  assert.equal(T.isIrConfigUsage("0xfffb00fe"), true);
  assert.equal(T.isIrConfigUsage("0xfffb00ff"), true);
  assert.equal(T.isIrConfigUsage(SAMSUNG), false);
});

test("whole-config round-trip preserves the hold-repeat interval", () => {
  const app = T.configToApp({
    version: 18,
    mappings: [
      { source_usage: "0x00070052", target_usage: SAMSUNG, scaling: 0xf8070707 | 0, layers: [0] },
      { source_usage: "0x00000000", target_usage: "0xfffb00ff", scaling: 15, layers: [] },
      { source_usage: "0x00000000", target_usage: "0xfffb00fe", scaling: 250, layers: [] },
    ],
  }, undefined, () => 1);

  assert.equal(app.mappings.length, 1, "both config carriers must be filtered out of the rows");
  assert.equal(app.settings.irOutputPin, 15);
  assert.equal(app.settings.irRepeatMs, 250);

  const back = T.appToConfig(app, { forDevice: true });
  const rep = back.mappings.find((m) => m.target_usage === "0xfffb00fe");
  assert.ok(rep, "the repeat carrier must be written back");
  assert.equal(rep.scaling, 250, "interval must survive RAW — not ×1000 like a normal scale");
  assert.equal(rep.source_usage, "0x00000000");
});

test("repeat interval defaults when the device config predates the feature", () => {
  const app = T.configToApp({
    version: 18,
    mappings: [
      { source_usage: "0x00070052", target_usage: SAMSUNG, scaling: 0xf8070707 | 0, layers: [0] },
      { source_usage: "0x00000000", target_usage: "0xfffb00ff", scaling: 15, layers: [] },
    ],
  }, undefined, () => 1);
  assert.equal(app.settings.irRepeatMs, 110, "an older config must inherit the firmware default");
});

test("repeat of 0 (once per press) round-trips and is not mistaken for 'unset'", () => {
  const app = T.configToApp({
    version: 18,
    mappings: [
      { source_usage: "0x00070052", target_usage: SAMSUNG, scaling: 1, layers: [0] },
      { source_usage: "0x00000000", target_usage: "0xfffb00fe", scaling: 0, layers: [] },
    ],
  }, undefined, () => 1);
  assert.equal(app.settings.irRepeatMs, 0);
  const back = T.appToConfig(app, { forDevice: true });
  assert.equal(back.mappings.find((m) => m.target_usage === "0xfffb00fe").scaling, 0);
});

test("firmware<->web contract: the repeat carrier usage agrees with remapper.h", () => {
  const h = FW("remapper.h");
  assert.match(h, /IR_CONFIG_REPEAT_USAGE\s*\(IR_USAGE_PAGE\s*\|\s*0xFE\)/,
    "remapper.h must define the repeat carrier as page|0xFE to match translate.js");
  const irh = FW("ir_output.h");
  assert.match(irh, /IR_OUTPUT_REPEAT_MS\s+110/,
    "the firmware default must stay 110 ms or translate.js DEFAULTS.irRepeatMs drifts from it");
});

/* ---- catalog integrity ---------------------------------------------------------------
   Every IR code is a NEC-family frame: the command half is a byte followed by its exact
   bitwise inverse. That single check is what caught a corrupt entry (0xE0E040FB) in the
   upstream database this catalog was built from, and it is the only automatic defence
   against a typo'd code shipping as a button that silently does nothing. */
test("every catalog code is a structurally valid NEC frame", () => {
  let checked = 0;
  for (const d of IR.DEVICES) {
    for (const [label, code] of d.buttons) {
      const c = code >>> 0;
      const cmd = (c >>> 16) & 0xff;
      const inv = (c >>> 24) & 0xff;
      assert.equal(((~cmd) & 0xff), inv,
        `${d.id} "${label}" = 0x${c.toString(16).padStart(8, "0")}: command byte 0x` +
        `${cmd.toString(16)} but inverse byte is 0x${inv.toString(16)} (expected 0x` +
        `${((~cmd) & 0xff).toString(16)}) — typo'd or not a NEC frame`);
      checked++;
    }
  }
  assert.ok(checked > 100, `expected a populated catalog, only checked ${checked}`);
});

test("no duplicate codes within a device, and Samsung keeps its hardware-confirmed anchors", () => {
  for (const d of IR.DEVICES) {
    const seen = new Map();
    for (const [label, code] of d.buttons) {
      const c = code >>> 0;
      assert.ok(!seen.has(c),
        `${d.id}: "${label}" and "${seen.get(c)}" share code 0x${c.toString(16)}`);
      seen.set(c, label);
    }
  }
  // confirmed against the owner's real hardware / published dumps — these must never drift
  const sam = IR.DEVICES.find((d) => d.id === "samsung-tv").buttons;
  const get = (n) => (sam.find((b) => b[0] === n) || [])[1] >>> 0;
  assert.equal(get("Power"), 0xfd020707);
  assert.equal(get("Volume +"), 0xf8070707);   // verified live on the S90C
  assert.equal(get("1"), 0xfb040707);
  assert.equal(get("OK / Enter"), 0x97680707);
});

test("every NEC device declares a single consistent address (low 16 bits)", () => {
  for (const d of IR.DEVICES) {
    if (d.proto !== 1 || !d.buttons.length) continue;   // 1 = NEC
    const addrs = new Set(d.buttons.map(([, c]) => (c >>> 0) & 0xffff));
    assert.equal(addrs.size, 1,
      `${d.id} mixes NEC addresses: ${[...addrs].map((a) => "0x" + a.toString(16)).join(", ")}` +
      ` — a device's buttons all come from one remote, so this means codes from two remotes got mixed`);
  }
});
