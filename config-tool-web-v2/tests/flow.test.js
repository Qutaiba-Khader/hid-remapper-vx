/* END-TO-END FLOW — the exact journey the user will make on JJ8S, driven in code.

   No hardware: a fake WebHID device stands in for JJ8S, and we assert on the real bytes
   device.js writes to it. This is the "pretend the device is plugged in" test.

     open device -> auto-load -> add a mapping -> pick input -> pick output
     -> set layers -> make it a combo -> set window + consume -> save
     -> read it back and confirm the device would return the same thing

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");

const CMD = { SET_CONFIG: 2, GET_CONFIG: 3, CLEAR_MAPPING: 4, ADD_MAPPING: 5, GET_MAPPING: 6,
              PERSIST_CONFIG: 7, SUSPEND: 10, RESUME: 11, CLEAR_MACROS: 15, CLEAR_EXPRESSIONS: 19,
              SET_MONITOR_ENABLED: 22, CLEAR_QUIRKS: 23 };
const STICKY = 1 << 0, TAP = 1 << 1, HOLD = 1 << 2, CONSUME = 1 << 3;

/* ---- a stand-in for JJ8S: it stores what we write and reads it back ---- */
function makeJJ8S() {
  let D;
  const state = { mappings: [], config: null, monitor: 0 };
  const sent = [];
  let pending = null; // what the next receiveFeatureReport() should answer

  const fake = {
    productName: "JJ8S",
    vendorId: 0xcafe, productId: 0xbabe,
    opened: false,
    collections: [{ usagePage: 0xff00 }],
    addEventListener() {}, removeEventListener() {},
    async open() { this.opened = true; },
    async close() { this.opened = false; },

    async sendFeatureReport(reportId, buffer) {
      const dv = new DataView(buffer);
      const cmd = dv.getUint8(1);
      sent.push(cmd);

      if (cmd === CMD.CLEAR_MAPPING) state.mappings = [];
      if (cmd === CMD.ADD_MAPPING) {
        state.mappings.push({
          target: dv.getUint32(2, true), source: dv.getUint32(6, true),
          scaling: dv.getInt32(10, true), layerMask: dv.getUint8(14),
          flags: dv.getUint8(15), hubPorts: dv.getUint8(16),
        });
      }
      if (cmd === CMD.SET_MONITOR_ENABLED) state.monitor = dv.getUint8(2);
      if (cmd === CMD.GET_CONFIG) pending = "config";
      if (cmd === CMD.GET_MAPPING) pending = { mapping: dv.getUint32(2, true) };
      if (cmd === CMD.PERSIST_CONFIG) pending = "persist";
    },

    async receiveFeatureReport() {
      const buf = new ArrayBuffer(33);
      const body = new DataView(buf, 1);

      if (pending === "config") {
        // [u8 version][u8 flags][u8 passMask][u32 scroll][u16 mapCount][u32 our][u32 their]
        // [u8 interval][u32 tapHold][u8 gpioDebounce][u8 descNum][u8 macroDur][u16 quirkCount]
        body.setUint8(0, 18);
        body.setUint8(1, 1 << 6);           // normalize_gamepad_inputs
        body.setUint8(2, 0b11111111);       // passthrough: all 8 layers
        body.setUint32(3, 1000000, true);   // partial scroll timeout (µs)
        body.setUint16(7, state.mappings.length, true);
        body.setUint32(9, 0, true);
        body.setUint32(13, 0, true);
        body.setUint8(17, 0);               // interval override
        body.setUint32(18, 200000, true);   // tap-hold threshold (µs)
        body.setUint8(22, 5);               // gpio debounce
        body.setUint8(23, 0);               // our_descriptor_number
        body.setUint8(24, 0);               // macro_entry_duration - 1
        body.setUint16(25, 0, true);        // quirk count
      } else if (pending && pending.mapping !== undefined) {
        const m = state.mappings[pending.mapping];
        body.setUint32(0, m.target, true);
        body.setUint32(4, m.source, true);
        body.setInt32(8, m.scaling, true);
        body.setUint8(12, m.layerMask);
        body.setUint8(13, m.flags);
        body.setUint8(14, m.hubPorts);
      } else if (pending === "persist") {
        body.setUint8(0, 1); // PERSIST_CONFIG_SUCCESS
      }
      pending = null;
      D.addCrc(body);
      return new DataView(buf);
    },
  };

  delete require.cache[require.resolve("../js/device.js")];
  delete require.cache[require.resolve("../js/crc.js")];
  Object.defineProperty(globalThis, "navigator", {
    value: { hid: { requestDevice: async () => [fake] } },
    configurable: true, writable: true,
  });
  D = require("../js/device.js");
  return { D, fake, state, sent };
}

// a fresh APP, exactly as state.js boots it
function freshApp() {
  const g = {};
  global.window = g;
  delete require.cache[require.resolve("../js/state.js")];
  require("../js/state.js");
  return g.HRX_STATE;
}

const T = require("../js/translate.js");

test("FULL FLOW: open device -> add -> remap -> combo -> save -> read back", async () => {
  const { D, state, sent } = makeJJ8S();
  const { APP, mk, uid } = freshApp();

  /* 1. the page boots empty — nothing invented */
  assert.strictEqual(APP.mappings.length, 0, "boots with no mappings");

  /* 2. open the device; the app loads its real config */
  const info = await D.connect();
  assert.strictEqual(info.name, "JJ8S", "we are talking to the test device, not CUSS");

  const loaded = await D.loadFromDevice();
  Object.assign(APP, T.configToApp(loaded, APP, uid));
  assert.strictEqual(APP.mappings.length, 0, "the device is empty to start with");
  assert.deepStrictEqual(APP.settings.passthrough, [true, true, true, true, true, true, true, true],
    "the device's real passthrough (all 8 layers) is what we show");

  /* 3. add a mapping (the "Add mapping" button) */
  APP.mappings.push(mk("0x00000000", "0x00000000"));
  assert.strictEqual(APP.mappings.length, 1);

  /* 4. pick the input, then the output (the picker's onSelect) */
  const row = APP.mappings[0];
  row.inputs[0] = "0x000c0041";  // Menu Select
  row.output = "0x00070028";     // Return (Enter)

  /* 5. make it fire only on layers 0 and 2, and only on a tap */
  row.layers = [true, false, true, false, false, false, false, false];
  row.tap = true;
  row.scale = 1;

  /* 6. add a second row and turn it into a COMBO */
  const combo = mk(["0x000c00e9", "0x000c00ea"], "0x000c00e2"); // Vol+ & Vol- -> Mute
  combo.comboWindow = 50;
  combo.comboConsume = true;
  APP.mappings.push(combo);

  /* 7. save to the device */
  const cfg = T.appToConfig(APP, { forDevice: true });
  const res = await D.saveToDevice(cfg);
  assert.strictEqual(res.ok, true, "the save must succeed");

  /* the device must have been suspended, wiped and resumed */
  assert.ok(sent.includes(CMD.SUSPEND) && sent.includes(CMD.RESUME), "suspend/resume around the write");
  assert.ok(sent.includes(CMD.CLEAR_MAPPING), "old mappings cleared");
  assert.ok(sent.includes(CMD.PERSIST_CONFIG), "config persisted to flash");

  /* 8. check the exact bytes that landed on the device */
  assert.strictEqual(state.mappings.length, 4, "1 plain mapping + (2 combo members + 1 trigger)");

  const plain = state.mappings[0];
  assert.strictEqual(plain.source, 0x000c0041);
  assert.strictEqual(plain.target, 0x00070028);
  assert.strictEqual(plain.layerMask, 0b00000101, "layers 0 and 2");
  assert.strictEqual(plain.flags & TAP, TAP, "tap flag set");
  assert.strictEqual(plain.flags & CONSUME, 0, "a plain mapping must NOT carry the combo flag");
  assert.strictEqual(plain.scaling, 1000, "scale x1.0");

  const m1 = state.mappings[1], m2 = state.mappings[2], trig = state.mappings[3];
  assert.strictEqual(m1.target, 0xfffb0001, "member 1 targets combo 1");
  assert.strictEqual(m1.source, 0x000c00e9);
  assert.strictEqual(m1.scaling, 50, "the timing window rides in scaling (ms)");
  assert.strictEqual(m1.flags & CONSUME, CONSUME, "consume flag on the member");
  assert.strictEqual(m2.target, 0xfffb0001);
  assert.strictEqual(m2.source, 0x000c00ea);
  assert.strictEqual(trig.source, 0xfffb0001, "the trigger reads the combo");
  assert.strictEqual(trig.target, 0x000c00e2, "and fires Mute");
  assert.strictEqual(trig.flags & CONSUME, 0, "the trigger is not a member");

  /* 9. read it all back — the device returns what we wrote, and it folds to the same UI rows */
  const back = await D.loadFromDevice();
  const app2 = T.configToApp(back, {}, null);

  assert.strictEqual(app2.mappings.length, 2, "4 device mappings fold back into 2 UI rows");

  const r1 = app2.mappings[0];
  assert.deepStrictEqual(r1.inputs, ["0x000c0041"]);
  assert.strictEqual(r1.output, "0x00070028");
  assert.deepStrictEqual(r1.layers, [true, false, true, false, false, false, false, false]);
  assert.strictEqual(r1.tap, true);

  const r2 = app2.mappings[1];
  assert.deepStrictEqual(r2.inputs, ["0x000c00e9", "0x000c00ea"], "the combo comes back as ONE row");
  assert.strictEqual(r2.output, "0x000c00e2");
  assert.strictEqual(r2.comboWindow, 50);
  assert.strictEqual(r2.comboConsume, true);

  await D.disconnect();
});

test("FLOW: a mapping's hub port survives the round trip (v1 parity)", async () => {
  const { D, state } = makeJJ8S();
  const { APP, mk, uid } = freshApp();
  await D.connect();
  Object.assign(APP, T.configToApp(await D.loadFromDevice(), APP, uid));

  const row = mk("0x000c0041", "0x00070028");
  row.source_port = 2;   // what the picker's Port dropdown sets
  row.target_port = 1;
  APP.mappings.push(row);

  await D.saveToDevice(T.appToConfig(APP, { forDevice: true }));
  assert.strictEqual(state.mappings[0].hubPorts, (1 << 4) | 2, "ports packed into one byte: target<<4 | source");

  const app2 = T.configToApp(await D.loadFromDevice(), {}, null);
  assert.strictEqual(app2.mappings[0].source_port, 2);
  assert.strictEqual(app2.mappings[0].target_port, 1);
  await D.disconnect();
});

test("FLOW: editing an existing device config does not destroy the rest of it", async () => {
  const { D, state } = makeJJ8S();
  const { APP, uid } = freshApp();
  await D.connect();

  // pretend the device already holds a mapping, a macro, an expression and a quirk
  const seeded = {
    version: 18,
    mappings: [{ source_usage: "0x00070052", target_usage: "0x00070051", scaling: 1000, layers: [0] }],
    macros: [[["0x000700e0", "0x00070006"]]].concat(Array.from({ length: 31 }, () => [])),
    expressions: ["0x00010030 input_state 2 mul", "", "", "", "", "", "", ""],
    quirks: [{ vendor_id: "0x1234", product_id: "0x5678", interface: 0, report_id: 1,
               usage: "0x00090001", bitpos: 8, size: 8, relative: false, signed: true }],
    unmapped_passthrough_layers: [0, 1, 2, 3, 4, 5, 6, 7],
    partial_scroll_timeout: 1000000, tap_hold_threshold: 200000, interval_override: 0,
    our_descriptor_number: 0, gpio_debounce_time_ms: 5, macro_entry_duration: 1,
  };
  Object.assign(APP, T.configToApp(seeded, APP, uid));

  // the user changes ONE mapping's output and saves
  APP.mappings[0].output = "0x00070050";
  const cfg = T.appToConfig(APP, { forDevice: true });

  // the macro / expression / quirk must still be in the payload — saveToDevice CLEARS them first
  assert.deepStrictEqual(cfg.macros[0], [["0x000700e0", "0x00070006"]], "the device's macro survives");
  assert.strictEqual(cfg.expressions[0], "0x00010030 input_state 2 mul", "the expression survives");
  assert.strictEqual(cfg.quirks.length, 1, "the quirk survives");

  await D.saveToDevice(cfg);
  assert.strictEqual(state.mappings[0].target, 0x00070050, "the edit landed");
  await D.disconnect();
});
