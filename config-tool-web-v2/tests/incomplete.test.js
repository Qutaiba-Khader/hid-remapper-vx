const test = require("node:test");
const assert = require("node:assert");
const T = require("../js/translate.js");
const L0 = [true,false,false,false,false,false,false,false];
const ALL = [true,true,true,true,true,true,true,true];
const app = (mappings) => ({ mappings, expressions: [], settings: { emulatedDevice: 0, passthrough: ALL } });

test("a mapping with no OUTPUT is never sent to the device", () => {
  const cfg = T.appToConfig(app([
    { id:1, inputs:["0x000c0041"], output:"0x00000000", enabled:true, layers:L0, scale:1 },
  ]), { forDevice: true });
  assert.strictEqual(cfg.mappings.length, 0, "an unfinished row must not reach the device");
  assert.strictEqual(cfg.incomplete, 1, "and the user must be told");
});

test("a COMBO with an unpicked key is never sent (an AND with a key that can never be pressed)", () => {
  const cfg = T.appToConfig(app([
    { id:1, inputs:["0x000c00e9","0x00000000"], output:"0x000c00e2", enabled:true, layers:L0,
      scale:1, comboWindow:50, comboConsume:true },
  ]), { forDevice: true });
  assert.strictEqual(cfg.mappings.length, 0, "it would silently never fire — do not write it");
  assert.strictEqual(cfg.incomplete, 1);
});

test("the RGB-LED 'always on' trick (input 0x00000000 -> LED) IS still allowed", () => {
  const cfg = T.appToConfig(app([
    { id:1, inputs:["0x00000000"], output:"0xfffa0006", enabled:true, layers:L0, scale:1 },
  ]), { forDevice: true });
  assert.strictEqual(cfg.mappings.length, 1, "a single 0x00000000 input is the always-on source");
  assert.strictEqual(cfg.incomplete, undefined);
});

test("complete rows still go through, and unfinished ones are kept in the JSON export", () => {
  const rows = [
    { id:1, inputs:["0x000c0041"], output:"0x00070028", enabled:true, layers:L0, scale:1 },
    { id:2, inputs:["0x000c00e9"], output:"0x00000000", enabled:true, layers:L0, scale:1 },
  ];
  const dev = T.appToConfig(app(rows), { forDevice: true });
  assert.strictEqual(dev.mappings.length, 1);
  assert.strictEqual(dev.incomplete, 1);

  const json = T.appToConfig(app(rows), {});
  assert.strictEqual(json.mappings.length, 2, "the export must NOT drop the work in progress");
  assert.strictEqual(json.disabled_rows.length, 2, "still aligned");
});
