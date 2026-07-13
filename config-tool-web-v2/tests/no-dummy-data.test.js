/* The tool must boot EMPTY.

   Everything on screen has to come from the connected device or from a config the user
   imported. Inventing data is both dishonest and dangerous: saveToDevice() clears and
   rewrites the device, so fake data on screen is fake data one click away from the hardware.

   This test exists because the tool was built from a design mock that shipped a demo config,
   and that demo config kept leaking back.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const JS = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

function bootState() {
  const g = { HRX_STATE: null };
  global.window = g;
  delete require.cache[require.resolve("../js/state.js")];
  require("../js/state.js");
  return g.HRX_STATE.APP;
}

test("the app boots with NO config at all", () => {
  const APP = bootState();
  assert.deepStrictEqual(APP.mappings, [], "no demo mappings");
  assert.deepStrictEqual(APP.expressions, ["", "", "", "", "", "", "", ""], "no demo expressions");
  assert.strictEqual(APP.macros.filter((m) => m.length).length, 0, "no demo macros");
  assert.deepStrictEqual(APP.quirks, [], "no demo quirks");
});

test("the app boots with no invented device or config identity", () => {
  const APP = bootState();
  assert.strictEqual(APP.config.title, "", "no fake config name");
  assert.strictEqual(APP.device.name, "", "no fake device name");
  assert.strictEqual(APP.connection, "disconnected");
  // the mock's placeholders, which must never come back
  const blob = JSON.stringify(APP);
  for (const ghost of ["Living Room", "CAFE:BABE", "v15.2.0"]) {
    assert.ok(!blob.includes(ghost), `the mock's "${ghost}" placeholder is back in the boot state`);
  }
});

test("no source file carries a hardcoded demo config", () => {
  const ghosts = [
    "Living Room",       // the mock's config name
    "CAFE:BABE",         // fake VID:PID
    "v15.2.0",           // fake firmware version
    "MACRO_PREVIEW",     // the fake macro list
    "MON_SEED",          // the fake monitor feed
    "const EXAMPLES",    // Quick Start's fake "example configs" (added BLANK mappings)
    "const SHORTCUTS",   // Quick Start's fake shortcut grid (always added nothing->Enter)
    "const TEMPLATES",   // the expression editor's canned recipe gallery
    "__bundler_thumbnail",
  ];
  for (const f of fs.readdirSync(path.join(__dirname, "..", "js"))) {
    if (!f.endsWith(".js")) continue;
    const src = JS(f);
    for (const ghost of ghosts) {
      assert.ok(!src.includes(ghost), `js/${f} still contains the mock placeholder "${ghost}"`);
    }
  }
});

test("every Quick Start preset creates REAL mappings (no blank rows, no fake counts)", () => {
  const src = JS("quickstart.js");
  // the fake examples pushed mk("0x00000000","0x00000000") N times while claiming a real config
  assert.ok(!/mk\("0x00000000",\s*"0x00000000"\)/.test(src),
    "Quick Start must never add blank placeholder mappings");
  assert.ok(!/data-ex="/.test(src), "the mock's fake 'example configs' gallery is gone");
  assert.ok(!src.includes("data-shortcut"), "the fake shortcut grid is gone");
  // the REAL example library (72 configs ported verbatim from the original tool) is expected
  assert.ok(src.includes("data-exadd") && src.includes("data-exload"),
    "the genuine example library must be offered (Add appends, Replace swaps the whole config)");
  assert.ok(src.includes("HRX_EXAMPLES"), "and it must come from the real examples.js, not invented data");

  // every preset must map a real source usage to a real target usage
  const adds = [...src.matchAll(/mk\((\[[^\]]+\]|"0x[0-9a-f]{8}"),\s*"(0x[0-9a-f]{8})"/g)];
  assert.ok(adds.length >= 4, "presets should still exist");
  for (const [, from, to] of adds) {
    assert.ok(!/0x00000000/.test(from), "a preset's INPUT must be a real usage, not 0x00000000");
    assert.notStrictEqual(to, "0x00000000", "a preset's OUTPUT must be a real usage");
  }
});

test("the expression editor picks a real key instead of injecting a hardcoded usage", () => {
  const src = JS("expressions.js");
  // the mock's palette injected these two codes and left them there
  assert.ok(!/ins:\s*\["0x00010030"/.test(src), "the palette must not inject a hardcoded Mouse X");
  assert.ok(!/ins:\s*\["0x00090001"/.test(src), "the palette must not inject a hardcoded Button 1");
  assert.ok(src.includes("window.openPicker"), "the palette must open the real key picker");
});

test("an empty boot config produces an empty device payload (nothing invented on save)", () => {
  const APP = bootState();
  const T = require("../js/translate.js");
  const cfg = T.appToConfig(APP, { forDevice: true });
  assert.deepStrictEqual(cfg.mappings, [], "a fresh page must not send any mapping");
  assert.strictEqual(cfg.expressions.filter((e) => e).length, 0);
  assert.strictEqual(cfg.macros.filter((m) => m.length).length, 0);
  assert.deepStrictEqual(cfg.quirks, []);
  // ...and the settings it would send are the firmware's own defaults, not invented ones
  assert.deepStrictEqual(cfg.unmapped_passthrough_layers, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(cfg.partial_scroll_timeout, 1000000);
  assert.strictEqual(cfg.tap_hold_threshold, 200000);
  assert.strictEqual(cfg.macro_entry_duration, 1);
});
