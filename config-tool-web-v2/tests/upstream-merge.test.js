/* Paths added by the 2026-11-24 merge of jfedor2/hid-remapper (upstream c5457f7).
   Map rows: docs/flow-map/upstream-merge.md. Each test name carries its path ID.

   - upstream's official Bluetooth firmware (remapper_bt) names itself "HID Remapper Bluetooth XXXX",
     the same marker this fork's BLE build uses, so the tool must light up Pair / Clear bonds for it
     and must keep them hidden on a wired remapper;
   - upstream rewrote the "gamepad-to-mouse" example to config version 18 with explicit ports, and the
     example must still load into the tool and write back the same device config.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");

function loadDevice(fake) {
  delete require.cache[require.resolve("../js/device.js")];
  delete require.cache[require.resolve("../js/crc.js")];
  Object.defineProperty(globalThis, "navigator", {
    value: { hid: { requestDevice: async () => [fake] } },
    configurable: true,
    writable: true,
  });
  return require("../js/device.js");
}

function fakeDevice(productName) {
  return {
    productName,
    vendorId: 0xcafe,
    productId: 0xbaf2,
    opened: false,
    collections: [{ usagePage: 0xff00 }],
    addEventListener() {},
    removeEventListener() {},
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    async sendFeatureReport() {},
    async receiveFeatureReport() {
      const D = require("../js/device.js");
      const withId = new ArrayBuffer(33);
      const body = new DataView(withId, 1);
      body.setUint8(0, 18);  // config version 18: the handshake passes
      D.addCrc(body);
      return new DataView(withId);
    },
  };
}

test("P-MRG-01 upstream remapper_bt (\"HID Remapper Bluetooth XXXX\") is recognised as a Bluetooth remapper", async () => {
  const D = loadDevice(fakeDevice("HID Remapper Bluetooth 7Q2K"));
  const info = await D.connect();
  assert.ok(info, "connect() must succeed against a v18 device");
  assert.strictEqual(info.bluetooth, true, "Pair / Clear bonds must be offered");
  assert.strictEqual(D.getInfo().bluetooth, true);
  await D.disconnect();
});

test("P-MRG-02 a wired remapper (\"HID Remapper XXXX\") is not a Bluetooth remapper", async () => {
  const D = loadDevice(fakeDevice("HID Remapper 7Q2K"));
  const info = await D.connect();
  assert.ok(info);
  assert.strictEqual(info.bluetooth, false, "Pair / Clear bonds stay hidden on USB devices");
  await D.disconnect();
});

test("P-MRG-03 a device that reports no product name is not treated as Bluetooth", async () => {
  const D = loadDevice(fakeDevice(undefined));
  const info = await D.connect();
  assert.strictEqual(info.bluetooth, false);
  assert.strictEqual(info.name, "HID Remapper", "and it gets the generic name");
  await D.disconnect();
});

test("P-MRG-04 the tabs only build the Pair / Clear-bonds cards from getInfo().bluetooth", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const tabs = fs.readFileSync(path.join(__dirname, "..", "js", "tabs.js"), "utf8");
  const fn = tabs.match(/function isBluetooth\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, "isBluetooth() exists");
  assert.ok(/info && info\.bluetooth/.test(fn[1]), "it reads the device's bluetooth flag and nothing else");
});

test("P-MRG-05 upstream's version-18 gamepad-to-mouse example loads and writes back the same device config", () => {
  const T = require("../js/translate.js");
  const examples = require("../js/examples.js");
  const ex = examples.find((e) => e.description === "expressions: gamepad-to-mouse adapter");
  assert.ok(ex, "the example is in the library");
  assert.strictEqual(ex.config.version, 18, "upstream's 2026-11 version of it");
  for (const m of ex.config.mappings) {
    assert.strictEqual(m.source_port, 0);
    assert.strictEqual(m.target_port, 0);
  }
  const app = T.configToApp(JSON.parse(JSON.stringify(ex.config)), {}, null);
  assert.strictEqual(app.mappings.length, ex.config.mappings.length, "every row arrives");
  const back = app.mappings.map((row) => T.appMappingToConfig(row));
  ex.config.mappings.forEach((m, i) => {
    assert.strictEqual(back[i].source_usage.toLowerCase(), m.source_usage.toLowerCase(), "row " + i + " input");
    assert.strictEqual(back[i].target_usage.toLowerCase(), m.target_usage.toLowerCase(), "row " + i + " output");
    assert.strictEqual(back[i].scaling, m.scaling == null ? 1000 : m.scaling, "row " + i + " scaling");
    assert.strictEqual(back[i].source_port || 0, 0, "row " + i + " source port");
    assert.strictEqual(back[i].target_port || 0, 0, "row " + i + " target port");
  });
  // expressions: device fixed point -> human -> device must round-trip
  for (const x of ex.config.expressions.filter(Boolean)) {
    assert.strictEqual(T.exprToDevice(T.exprToApp(x)), x);
  }
});

test("P-MRG-08 a pre-v18 config loads with gamepad normalization OFF, like the original tool", () => {
  const T = require("../js/translate.js");
  const base = { mappings: [], macros: [], expressions: [], quirks: [] };
  assert.strictEqual(T.configToApp(Object.assign({ version: 17 }, base), {}, null).settings.normalizeGamepad, false,
    "v1 forces it off for <18 so an old config keeps its old behaviour");
  assert.strictEqual(T.configToApp(Object.assign({ version: 6 }, base), {}, null).settings.normalizeGamepad, false);
  assert.strictEqual(T.configToApp(Object.assign({ version: 18 }, base), {}, null).settings.normalizeGamepad, true,
    "a v18 config without the field defaults to on");
  assert.strictEqual(T.configToApp(Object.assign({ version: 18, normalize_gamepad_inputs: false }, base), {}, null).settings.normalizeGamepad, false,
    "and an explicit value is kept");
});
