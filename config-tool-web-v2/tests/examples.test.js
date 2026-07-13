/* EXAMPLES — the 72 ready-made configs ported from the original tool.

   They are stored in the DEVICE config format (older ones use the v3 shape), so they must be
   migrated and UNIT-CONVERTED before use: an example's expression constants are integers x1000
   and its scaling is x1000. Getting that wrong silently corrupts the config.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const examples = require("../js/examples.js");
const T = require("../js/translate.js");

test("the example library is present and complete", () => {
  assert.ok(Array.isArray(examples), "examples.js must export the array");
  assert.strictEqual(examples.length, 72, "all 72 examples from the original tool");
  for (const e of examples) {
    assert.ok(e.description, "every example must have a description");
    assert.ok(e.config, "and a config");
  }
});

test("it is a classic script, NOT an ES module (v2 loads plain <script> tags)", () => {
  const mine = fs.readFileSync(path.join(__dirname, "..", "js", "examples.js"), "utf8");
  assert.ok(!/^\s*export\s/m.test(mine),
    "v1's examples.js ends with `export default examples;` — an `export` in a classic script is a " +
    "SyntaxError that kills the whole file, so the Examples list would be silently EMPTY");
  assert.ok(/window\.HRX_EXAMPLES\s*=/.test(mine), "it must publish the array on window");
});

test("the example DATA matches the original tool exactly", () => {
  const orig = require("../../config-tool-web/examples.js");
  const mineArr = require("../js/examples.js");
  const list = Array.isArray(orig) ? orig : orig.default;
  assert.strictEqual(mineArr.length, list.length, "same number of examples");
  assert.deepStrictEqual(
    mineArr.map((e) => e.description),
    list.map((e) => e.description),
    "same examples, in the same order — this is a verbatim port");
});

test("quickstart loads the library and offers Add and Replace", () => {
  const qs = fs.readFileSync(path.join(__dirname, "..", "js", "quickstart.js"), "utf8");
  assert.ok(/HRX_EXAMPLES/.test(qs), "it must read the library");
  assert.ok(/data-exadd/.test(qs) && /data-exload/.test(qs), "Add (append) and Replace (whole config)");
  assert.ok(/exprToApp/.test(qs), "an example's expressions MUST be converted from device fixed point");
  assert.ok(/configMappingToApp/.test(qs), "and its mappings from the device format (scaling /1000)");
});

test("index.html loads examples.js BEFORE quickstart.js", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const ex = html.indexOf("js/examples.js");
  const qs = html.indexOf("js/quickstart.js");
  assert.ok(ex > -1, "examples.js must be loaded");
  assert.ok(ex < qs, "and before quickstart.js, which uses it");
});

test("every example survives the migration and produces a usable config", () => {
  for (const e of examples) {
    const c = JSON.parse(JSON.stringify(e.config));
    // the same migration quickstart.js does
    if (c.version === 3) {
      c.unmapped_passthrough_layers = c.unmapped_passthrough ? [0] : [];
      (c.mappings || []).forEach((m) => { m.layers = [m.layer || 0]; delete m.layer; });
      c.macros = Array.from({ length: 32 }, () => []);
    }
    (c.mappings || []).forEach((m) => {
      if ("layer" in m && !("layers" in m)) { m.layers = [m.layer]; delete m.layer; }
      if (!("layers" in m)) m.layers = [0];
      if (!("scaling" in m)) m.scaling = 1000;
    });

    const app = T.configToApp(c, {}, null);
    assert.ok(Array.isArray(app.mappings), e.description + ": must produce mappings");
    for (const row of app.mappings) {
      assert.ok(/^0x[0-9a-f]{8}$/.test(row.inputs[0]), e.description + ": bad input usage " + row.inputs[0]);
      assert.ok(/^0x[0-9a-f]{8}$/.test(row.output), e.description + ": bad output usage " + row.output);
      assert.ok(Number.isFinite(row.scale), e.description + ": scale must be a number");
      assert.strictEqual(row.layers.length, 8, e.description + ": 8 layers");
    }
  }
});

test("an example's expression constants are converted OUT of device fixed point", () => {
  // find an example that actually carries an expression
  const withExpr = examples.find((e) => (e.config.expressions || []).some((x) => x));
  assert.ok(withExpr, "at least one example uses expressions");

  const deviceExpr = withExpr.config.expressions.find((x) => x);
  const human = T.exprToApp(deviceExpr);
  // and converting back must reproduce the device form exactly
  assert.strictEqual(T.exprToDevice(human), deviceExpr,
    "device -> human -> device must round-trip, or loading an example corrupts the expression");
});

test("an example's mapping scaling is converted (x1000 <-> float)", () => {
  const scaled = examples
    .flatMap((e) => e.config.mappings || [])
    .find((m) => m.scaling != null && m.scaling !== 1000);
  assert.ok(scaled, "at least one example uses a non-default scaling");

  const row = T.configMappingToApp(scaled, null);
  assert.strictEqual(row.scale, scaled.scaling / 1000, "the UI shows the float");
  assert.strictEqual(T.appMappingToConfig(row).scaling, scaled.scaling, "and writes the integer back");
});
