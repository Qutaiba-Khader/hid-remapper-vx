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
