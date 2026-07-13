/* EXPRESSION FIXED-POINT tests.

   The device stores an expression's numeric constants as integers scaled by 1000. A human writes
   "0.05". v1 converts at the UI edge; v2 converts in translate.js. Getting this wrong is SILENT
   CORRUPTION: parseInt("0.05") === 0, so "0.05 mul" would be written to the device as "0 mul" —
   multiplying the whole expression by zero — and a device value of 50 would display as "50".

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const T = require("../js/translate.js");
const D = require("../js/device.js");

const ALL = [true, true, true, true, true, true, true, true];
const app = (expressions) => ({ mappings: [], expressions, settings: { emulatedDevice: 0, passthrough: ALL } });

test("a fractional constant survives the trip to the device", () => {
  const cfg = T.appToConfig(app(["0x00010030 input_state 0.05 mul", "", "", "", "", "", "", ""]), { forDevice: true });
  assert.strictEqual(cfg.expressions[0], "0x00010030 input_state 50 mul",
    "0.05 must become 50 — writing 0 would multiply the expression by zero");
});

test("a device value comes back as the human number", () => {
  const back = T.configToApp({ version: 18, mappings: [],
    expressions: ["0x00010030 input_state 50 mul", "", "", "", "", "", "", ""] }, {}, null);
  assert.strictEqual(back.expressions[0], "0x00010030 input_state 0.05 mul",
    "50 must display as 0.05, not 50");
});

test("expressions round-trip exactly (human -> device -> human)", () => {
  const exprs = [
    "0x00010030 input_state -128 add 0.05 mul",
    "0x00010033 input_state -100 100 clamp",
    "0x00010030 input_state -128 add dup abs 10 gt mul 0.025 mul",
    "", "", "", "", "",
  ];
  const cfg = T.appToConfig(app(exprs), { forDevice: true });
  const back = T.configToApp({ version: 18, mappings: [], expressions: cfg.expressions }, {}, null);
  assert.deepStrictEqual(back.expressions, exprs, "a full round trip must be lossless");
});

test("usages and operators are NOT touched by the scaling", () => {
  const cfg = T.appToConfig(app(["0x000c00e9 input_state_binary 0x00090001 input_state_binary mul", "", "", "", "", "", "", ""]), { forDevice: true });
  assert.strictEqual(cfg.expressions[0], "0x000c00e9 input_state_binary 0x00090001 input_state_binary mul",
    "hex usages must not be rescaled, and op names must be untouched");
});

test("negative constants scale correctly", () => {
  const cfg = T.appToConfig(app(["-128 -0.5 mul", "", "", "", "", "", "", ""]), { forDevice: true });
  assert.strictEqual(cfg.expressions[0], "-128000 -500 mul");
  const back = T.configToApp({ version: 18, mappings: [], expressions: cfg.expressions }, {}, null);
  assert.strictEqual(back.expressions[0], "-128 -0.5 mul");
});

test("what device.js actually writes on the wire is an integer", () => {
  // device.js does parseInt on the config's expression text, so the config MUST already be scaled
  const cfg = T.appToConfig(app(["0.05 mul", "", "", "", "", "", "", ""]), { forDevice: true });
  const elems = D.exprToElems(cfg.expressions[0]);
  const push = elems[0];
  assert.strictEqual(push[0], 0, "first element is PUSH");
  assert.strictEqual(push[1], 50, "and it must carry 50, not 0");
});

test("an empty expression stays empty", () => {
  const cfg = T.appToConfig(app(["", "", "", "", "", "", "", ""]), { forDevice: true });
  assert.deepStrictEqual(cfg.expressions, ["", "", "", "", "", "", "", ""]);
});
