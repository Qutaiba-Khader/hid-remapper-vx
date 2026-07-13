/* v1-PARITY tests — the capabilities v2 had lost, and the safety rules v1 enforces.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const T = require("../js/translate.js");

/* ---- quirks: they can now be EDITED, not just preserved ---- */

test("the quirk editor exists and is reachable as a tab", () => {
  assert.ok(/id:\s*"quirks"/.test(read("js/app.js")), "there must be a Quirks tab");
  assert.ok(/renderQuirks/.test(read("js/app.js")), "and the app must render it");
  const tabs = read("js/tabs.js");
  assert.ok(/window\.renderQuirks/.test(tabs), "tabs.js must define renderQuirks");
  for (const field of ["vendor_id", "product_id", "interface", "report_id", "usage", "bitpos", "size"]) {
    assert.ok(tabs.includes(field), `the editor must expose the quirk field "${field}"`);
  }
  assert.ok(/data-qflag="relative"/.test(tabs) && /data-qflag="signed"/.test(tabs),
    "and the relative / signed flags");
  assert.ok(/data-qdel/.test(tabs) && /qAdd/.test(tabs), "and add / delete");
});

test("a quirk survives the round trip", () => {
  const q = { vendor_id: "0x1234", product_id: "0x5678", interface: 1, report_id: 2,
              usage: "0x00090001", bitpos: 8, size: 8, relative: true, signed: true };
  const cfg = { version: 18, mappings: [], quirks: [q], macros: [], expressions: [] };
  const app = T.configToApp(cfg, {}, null);
  assert.deepStrictEqual(app.quirks, [q], "the editor sees the device's quirks");
  const back = T.appToConfig(app, { forDevice: true });
  assert.deepStrictEqual(back.quirks, [q], "and writes them back unchanged");
});

/* ---- the usages the DEVICE itself reports ---- */

test("device.js fetches the device's own usages on load", () => {
  const dev = read("js/device.js");
  assert.ok(/GET_THEIR_USAGES/.test(dev) && /GET_OUR_USAGES/.test(dev), "the commands must be used");
  assert.ok(/getUsagesFromDevice/.test(dev), "there must be an RLE fetch helper");
  assert.ok(/config\.device_usages\s*=/.test(dev), "and loadFromDevice must return them");
});

test("the picker offers the device's reported usages", () => {
  const picker = read("js/picker.js");
  assert.ok(/deviceCategory/.test(picker), "the picker must build a category from the device's usages");
  assert.ok(/APP\.deviceUsages/.test(picker), "read from APP.deviceUsages");
  assert.ok(/state\.mode === "input" \? du\.source : du\.target/.test(picker),
    "sources for an input, targets for an output");
});

test("device usages reach APP through the translation", () => {
  const cfg = { version: 18, mappings: [], quirks: [], macros: [], expressions: [],
                device_usages: { source: ["0x000c00e9"], target: ["0x00070004"] } };
  const app = T.configToApp(cfg, {}, null);
  assert.deepStrictEqual(app.deviceUsages, { source: ["0x000c00e9"], target: ["0x00070004"] });
});

/* ---- the expression editor must know EVERY firmware op ---- */

test("the expression editor knows every op the device can encode", () => {
  const devSrc = read("js/device.js");
  const b = devSrc.slice(devSrc.indexOf("const ops = {"));
  const encodable = [...b.slice(0, b.indexOf("};")).matchAll(/([A-Z_0-9]+)\s*:\s*\d+/g)]
    .map((m) => m[1].toLowerCase())
    .filter((o) => o !== "push" && o !== "push_usage");   // literals, not named ops

  const eng = read("js/expr-engine.js");
  const o = eng.slice(eng.indexOf("const OPS = {"));
  const known = [...o.slice(0, o.indexOf("\n  };")).matchAll(/^\s{4}([a-z_0-9]+)\s*:/gm)].map((m) => m[1]);

  const missing = encodable.filter((op) => !known.includes(op));
  assert.deepStrictEqual(missing, [],
    "an op the editor does not know is flagged 'Unknown operation' and DISABLES Apply, so an " +
    "expression already on the device cannot be edited: " + missing.join(", "));
});

test("the added ops use the firmware's own arities", () => {
  const eng = read("js/expr-engine.js");
  const arity = (op) => {
    const m = eng.match(new RegExp(op + "\\s*:\\s*\\{\\s*arity:\\s*(\\d+),\\s*out:\\s*(\\d+)"));
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  // from firmware/src/remapper.cc validate_expressions()
  assert.deepStrictEqual(arity("auto_repeat"), [0, 1], "auto_repeat pushes one value");
  assert.deepStrictEqual(arity("scaling"), [0, 1], "scaling pushes one value");
  assert.deepStrictEqual(arity("input_state_fp32"), [1, 1]);
  assert.deepStrictEqual(arity("prev_input_state_fp32"), [1, 1]);
  assert.deepStrictEqual(arity("debug"), [0, 0], "debug changes nothing on the stack");
  assert.deepStrictEqual(arity("eol"), [0, 0]);
  assert.deepStrictEqual(arity("print_if"), [2, 0], "print_if consumes two");
});

/* ---- layer safety (v1's set_forced_layers) ---- */

test("a layer key is forced onto the layer it activates", () => {
  const src = read("js/mappings.js");
  assert.ok(/LAYERS_PAGE\s*=\s*0xfff10000/.test(src), "the layers page must be recognised");
  assert.ok(/function applyLayerRules/.test(src), "the rule must be applied");
  assert.ok(/m\.layers\[fl\]\s*=\s*!m\.sticky/.test(src),
    "non-sticky: present on the layer it activates (or you can never leave it). sticky: absent.");
  assert.ok(/chk layer locked/.test(src), "and the chip must be locked so the UI does not lie");
});

/* ---- a v1 row colour must not be thrown away ---- */

test("a custom row colour from v1 is preserved, not silently dropped", () => {
  const cfg = { version: 18, quirks: [], macros: [], expressions: [],
    mappings: [{ source_usage: "0x000c0041", target_usage: "0x00070028", scaling: 1000,
                 layers: [0], color: "#ff00ff" }] };            // not one of the 5 tints
  const app = T.configToApp(cfg, {}, null);
  assert.strictEqual(app.mappings[0].tint, null, "we have no tint for it");
  assert.strictEqual(app.mappings[0].customColor, "#ff00ff", "but the colour must be kept");

  const back = T.appToConfig(app, { forDevice: true });
  assert.strictEqual(back.mappings[0].color, "#ff00ff", "and written back unchanged");
});

test("a known tint still round-trips as a tint", () => {
  const cfg = { version: 18, quirks: [], macros: [], expressions: [],
    mappings: [{ source_usage: "0x000c0041", target_usage: "0x00070028", scaling: 1000,
                 layers: [0], color: "#3b82f6" }] };            // = the "nav" tint
  const app = T.configToApp(cfg, {}, null);
  assert.strictEqual(app.mappings[0].tint, "nav");
  assert.strictEqual(app.mappings[0].customColor, undefined);
  assert.strictEqual(T.appToConfig(app, { forDevice: true }).mappings[0].color, "#3b82f6");
});

/* ---- smaller v1 features ---- */

test("the monitor shows the hub port", () => {
  const tabs = read("js/tabs.js");
  assert.ok(/"Port"/.test(tabs), "the monitor table must have a Port column");
  assert.ok(/r\.hub_port/.test(tabs), "and print the reported port");
});

test("the Bluetooth-only actions are hidden on a USB device", () => {
  const tabs = read("js/tabs.js");
  assert.ok(/function isBluetooth/.test(tabs));
  assert.ok(/isBluetooth\(\) \? card\(ICON\.plug, "Pair new device"/.test(tabs),
    "Pair must be Bluetooth-only");
  assert.ok(/isBluetooth\(\) \? card\(ICON\.x, "Forget all devices"/.test(tabs),
    "Clear bonds must be Bluetooth-only");
});

test("the picker's custom hex field validates and zero-pads", () => {
  const p = read("js/picker.js");
  assert.ok(/pickerCustomApply/.test(p), "there must be a real Use button, not Enter-only");
  assert.ok(/padStart\(8, "0"\)/.test(p), "a short code must be zero-padded to 8 digits");
  assert.ok(/\[0-9a-f\]\{1,8\}/i.test(p), "and junk must be rejected");
});

test("the Input labels setting actually FILTERS the picker (not a dead control)", () => {
  const p = read("js/picker.js");
  assert.ok(/labelFiltered/.test(p), "the picker must apply the input-labels setting");
  assert.ok(/settings\.inputLabels/.test(p), "reading it from settings");
  assert.ok(/mode === 1 \? "mouse" : "gamepad"/.test(p),
    "gamepad labels hide the mouse group and vice versa — a mouse and a gamepad share HID codes");
  const t = read("js/tabs.js");
  assert.ok(/id="inputLabels"/.test(t), "and there must be a control for it in Settings");
});
