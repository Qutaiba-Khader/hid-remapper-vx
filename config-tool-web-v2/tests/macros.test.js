/* MACRO tests — a macro built in the editor must reach the device intact.

   A macro is a sequence of STEPS; every usage in a step is pressed at the same instant. On the
   wire the steps are flattened with a 0x00 separator between them (device.js), so the encode/decode
   here is easy to get subtly wrong — e.g. an empty step vanishes, or the separator is dropped.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");

const CMD = { CLEAR_MACROS: 15, APPEND_TO_MACRO: 16, GET_MACRO: 17 };

function makeDevice() {
  let D;
  // what the fake device has stored: macro index -> flat list of usages (0 = step separator)
  const stored = {};
  let pending = null;

  const fake = {
    productName: "JJ8S", vendorId: 0xcafe, productId: 0xbabe, opened: false,
    collections: [{ usagePage: 0xff00 }],
    addEventListener() {}, removeEventListener() {},
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    async sendFeatureReport(id, buffer) {
      const dv = new DataView(buffer);
      const cmd = dv.getUint8(1);
      if (cmd === CMD.CLEAR_MACROS) { for (const k of Object.keys(stored)) delete stored[k]; }
      if (cmd === CMD.APPEND_TO_MACRO) {
        const macro = dv.getUint8(2);
        const nitems = dv.getUint8(3);
        stored[macro] = stored[macro] || [];
        for (let i = 0; i < nitems; i++) stored[macro].push(dv.getUint32(4 + i * 4, true));
      }
      if (cmd === 3) pending = "config";
      if (cmd === CMD.GET_MACRO) pending = { macro: dv.getUint32(2, true), item: dv.getUint32(6, true) };
      if (cmd === 7) pending = "persist";
    },
    async receiveFeatureReport() {
      const buf = new ArrayBuffer(33);
      const body = new DataView(buf, 1);
      if (pending === "config") {
        body.setUint8(0, 18);
        body.setUint8(2, 0b11111111);
        body.setUint32(3, 1000000, true);
        body.setUint16(7, 0, true);   // no mappings
        body.setUint32(18, 200000, true);
        body.setUint8(22, 5);
        body.setUint8(24, 0);
      } else if (pending && pending.macro !== undefined) {
        // get_macro_response_t: [u8 nitems][u32 usages[6]]
        const items = (stored[pending.macro] || []).slice(pending.item, pending.item + 6);
        body.setUint8(0, items.length);
        items.forEach((u, i) => body.setUint32(1 + i * 4, u >>> 0, true));
      } else if (pending === "persist") {
        body.setUint8(0, 1);
      }
      pending = null;
      D.addCrc(body);
      return new DataView(buf);
    },
  };

  delete require.cache[require.resolve("../js/device.js")];
  delete require.cache[require.resolve("../js/crc.js")];
  Object.defineProperty(globalThis, "navigator", {
    value: { hid: { requestDevice: async () => [fake] } }, configurable: true, writable: true,
  });
  D = require("../js/device.js");
  return { D, stored };
}

const T = require("../js/translate.js");
const baseCfg = (macros) => ({
  version: 18, mappings: [], macros, expressions: ["", "", "", "", "", "", "", ""], quirks: [],
  unmapped_passthrough_layers: [0, 1, 2, 3, 4, 5, 6, 7],
  partial_scroll_timeout: 1000000, tap_hold_threshold: 200000, interval_override: 0,
  our_descriptor_number: 0, gpio_debounce_time_ms: 5, macro_entry_duration: 1,
});

// Ctrl+C : step 1 = LeftCtrl + C held together, step 2 = release (a second step)
const CTRL_C = [["0x000700e0", "0x00070006"], ["0x000c00b0"]];

test("a macro built in the editor is written to the device with its steps intact", async () => {
  const { D, stored } = makeDevice();
  await D.connect();

  const macros = Array.from({ length: 32 }, () => []);
  macros[0] = CTRL_C;
  await D.saveToDevice(baseCfg(macros));

  // steps are flattened with 0 between them: [e0, 06, 0, b0]
  assert.deepStrictEqual(stored[0], [0x000700e0, 0x00070006, 0x00000000, 0x000c00b0],
    "each step's keys, with a 0 separator between steps");
  await D.disconnect();
});

test("the macro comes back off the device as the same steps", async () => {
  const { D } = makeDevice();
  await D.connect();

  const macros = Array.from({ length: 32 }, () => []);
  macros[0] = CTRL_C;
  await D.saveToDevice(baseCfg(macros));

  const back = await D.loadFromDevice();
  assert.deepStrictEqual(back.macros[0], CTRL_C, "steps must survive the round trip");
  assert.deepStrictEqual(back.macros[1], [], "untouched slots stay empty");
  await D.disconnect();
});

test("a long macro is chunked correctly (more than one packet)", async () => {
  const { D } = makeDevice();
  await D.connect();

  // 10 single-key steps -> 10 usages + 9 separators = 19 items > MACRO_ITEMS_IN_PACKET (6)
  const long = Array.from({ length: 10 }, (_, i) => ["0x0007000" + (i + 4).toString(16)]);
  const macros = Array.from({ length: 32 }, () => []);
  macros[3] = long;
  await D.saveToDevice(baseCfg(macros));

  const back = await D.loadFromDevice();
  assert.deepStrictEqual(back.macros[3], long, "a macro spanning several packets must not lose steps");
  await D.disconnect();
});

test("a macro survives the APP <-> config translation", () => {
  const macros = Array.from({ length: 32 }, () => []);
  macros[5] = CTRL_C;
  const app = T.configToApp(baseCfg(macros), {}, null);
  assert.deepStrictEqual(app.macros[5], CTRL_C, "the editor sees the device's steps");

  const back = T.appToConfig(app, { forDevice: true });
  assert.deepStrictEqual(back.macros[5], CTRL_C, "and writes them back unchanged");
});

test("editing macro 1 does not disturb the others", async () => {
  const { D } = makeDevice();
  await D.connect();

  const macros = Array.from({ length: 32 }, () => []);
  macros[0] = CTRL_C;
  macros[7] = [["0x000c0223"]];
  await D.saveToDevice(baseCfg(macros));

  const app = T.configToApp(await D.loadFromDevice(), {}, null);
  app.macros[0] = [["0x00070004"]];            // the user rewrites macro 1 in the editor
  await D.saveToDevice(T.appToConfig(app, { forDevice: true }));

  const back = await D.loadFromDevice();
  assert.deepStrictEqual(back.macros[0], [["0x00070004"]], "the edit landed");
  assert.deepStrictEqual(back.macros[7], [["0x000c0223"]], "the other macro is untouched");
  await D.disconnect();
});

test("an EMPTY step (a pause / key release) survives the round trip", async () => {
  const { D, stored } = makeDevice();
  await D.connect();

  // press Ctrl+C, release everything, then press Home
  const withPause = [["0x000700e0", "0x00070006"], [], ["0x000c0223"]];
  const macros = Array.from({ length: 32 }, () => []);
  macros[0] = withPause;
  await D.saveToDevice(baseCfg(macros));

  assert.deepStrictEqual(stored[0], [0x000700e0, 0x00070006, 0, 0, 0x000c0223],
    "an empty step is two adjacent separators on the wire");

  const back = await D.loadFromDevice();
  assert.deepStrictEqual(back.macros[0], withPause,
    "the empty step is a real pause — it must not be swallowed");
  await D.disconnect();
});

test("a trailing empty step (user clicked Add step and stopped) round-trips too", async () => {
  const { D } = makeDevice();
  await D.connect();
  const macros = Array.from({ length: 32 }, () => []);
  macros[0] = [["0x00070004"], []];
  await D.saveToDevice(baseCfg(macros));
  const back = await D.loadFromDevice();
  assert.deepStrictEqual(back.macros[0], [["0x00070004"], []]);
  await D.disconnect();
});
