/* CONTRACT tests — the web tool and the firmware must agree, byte for byte.

   These read the actual firmware source. If an upstream sync (or a careless edit) moves an
   opcode, renumbers a flag, or bumps the config version on one side only, the tool will write
   garbage to a real device. That failure is invisible until hardware misbehaves — so it is
   pinned here instead.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const FW = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "firmware", "src", f), "utf8");

const T = require("../js/translate.js");
const D = require("../js/device.js");

test("CONFIG_VERSION matches the firmware (must stay 18 — combos add no persisted field)", () => {
  const m = FW("config.cc").match(/CONFIG_VERSION\s*=\s*(\d+)/);
  assert.ok(m, "could not find CONFIG_VERSION in firmware/src/config.cc");
  const fwVersion = Number(m[1]);
  assert.strictEqual(fwVersion, 18, "the whole combo design depends on this staying 18");
  assert.strictEqual(D.CONFIG_VERSION, fwVersion, "device.js disagrees with the firmware");
  assert.strictEqual(T.CONFIG_VERSION, fwVersion, "translate.js disagrees with the firmware");
});

test("the combo usage page matches the firmware", () => {
  const m = FW("remapper.h").match(/#define\s+COMBO_USAGE_PAGE\s+(0x[0-9A-Fa-f]+)/);
  assert.ok(m, "COMBO_USAGE_PAGE not found in firmware/src/remapper.h");
  const fwPage = parseInt(m[1], 16) >>> 0;
  assert.strictEqual(fwPage, 0xfffb0000);
  assert.strictEqual(T.COMBO_USAGE_PAGE, fwPage, "translate.js targets a different page than the firmware reads");
});

test("the mapping flag bits match the firmware (consume MUST be bit 3)", () => {
  const src = FW("remapper.cc");
  const bit = (name) => {
    const m = src.match(new RegExp("MAPPING_FLAG_" + name + "\\s*=\\s*1\\s*<<\\s*(\\d+)"));
    assert.ok(m, "MAPPING_FLAG_" + name + " not found in firmware/src/remapper.cc");
    return 1 << Number(m[1]);
  };
  assert.strictEqual(D.STICKY_FLAG, bit("STICKY"));
  assert.strictEqual(D.TAP_FLAG, bit("TAP"));
  assert.strictEqual(D.HOLD_FLAG, bit("HOLD"));
  assert.strictEqual(D.COMBO_CONSUME_FLAG, bit("COMBO_CONSUME"),
    "the consume bit moved — every combo would be written with the wrong flag");
});

test("NCOMBOS matches the firmware (the web tool must not offer more than the device holds)", () => {
  const m = FW("remapper.cc").match(/#define\s+NCOMBOS\s+(\d+)/);
  assert.ok(m, "NCOMBOS not found in firmware/src/remapper.cc");
  assert.strictEqual(T.NCOMBOS, Number(m[1]));
});

test("the expression opcode table matches the firmware Op enum exactly", () => {
  const enumSrc = FW("types.h");
  const start = enumSrc.indexOf("enum class Op");
  const block = enumSrc.slice(start, enumSrc.indexOf("};", start));
  const fwOps = {};
  for (const m of block.matchAll(/([A-Z_0-9]+)\s*=\s*(\d+)/g)) fwOps[m[1]] = Number(m[2]);

  // device.js's private table, read from source (it is the encoder used on every save)
  const devSrc = fs.readFileSync(path.join(__dirname, "..", "js", "device.js"), "utf8");
  const b = devSrc.slice(devSrc.indexOf("const ops = {"));
  const opsBlock = b.slice(0, b.indexOf("};"));
  const devOps = {};
  for (const m of opsBlock.matchAll(/([A-Z_0-9]+)\s*:\s*(\d+)/g)) devOps[m[1]] = Number(m[2]);

  assert.strictEqual(Object.keys(devOps).length, Object.keys(fwOps).length,
    "the web tool and the firmware know a different number of ops");
  for (const [name, code] of Object.entries(fwOps)) {
    assert.strictEqual(devOps[name], code,
      `opcode ${name}: firmware says ${code}, device.js says ${devOps[name]} — expressions would be corrupted`);
  }
});

test("every op the expression EDITOR offers can actually be encoded", () => {
  const engSrc = fs.readFileSync(path.join(__dirname, "..", "js", "expr-engine.js"), "utf8");
  const o = engSrc.slice(engSrc.indexOf("const OPS = {"));
  const uiBlock = o.slice(0, o.indexOf("\n  };"));
  const uiOps = [...uiBlock.matchAll(/^\s{4}([a-z_0-9]+)\s*:/gm)].map((m) => m[1]);
  assert.ok(uiOps.length > 30, "did not parse the editor's OPS table");

  const devSrc = fs.readFileSync(path.join(__dirname, "..", "js", "device.js"), "utf8");
  const b = devSrc.slice(devSrc.indexOf("const ops = {"));
  const opsBlock = b.slice(0, b.indexOf("};"));
  const encodable = [...opsBlock.matchAll(/([A-Z_0-9]+)\s*:\s*\d+/g)].map((m) => m[1].toLowerCase());

  const orphans = uiOps.filter((op) => !encodable.includes(op));
  assert.deepStrictEqual(orphans, [],
    "the editor offers ops the device cannot encode — building one of these would fail on save");
});

test("the 8 layers agree across firmware, state and translation", () => {
  assert.strictEqual(T.NLAYERS, 8);
  const m = FW("globals.cc").match(/unmapped_passthrough_layer_mask\s*=\s*(0b[01]+)/);
  assert.ok(m, "could not read the passthrough default from globals.cc");
  assert.strictEqual(m[1], "0b11111111", "the firmware passes through all 8 layers by default");
  assert.deepStrictEqual(T.DEFAULTS.passthroughLayers, [0, 1, 2, 3, 4, 5, 6, 7],
    "the web default must match the firmware's, or a fresh save changes behaviour");
});
