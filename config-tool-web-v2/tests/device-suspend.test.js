/* Drives the REAL device.js against a fake WebHID device, to prove the one failure mode that
   would look like a bricked remapper on the bench:

     saveToDevice() sends SUSPEND, rewrites the whole config, then sends RESUME. If a write
     throws in between and RESUME never fires, the device processes NO input until it is
     physically unplugged.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");

const CMD = { SUSPEND: 10, RESUME: 11, SET_CONFIG: 2, GET_CONFIG: 3, CLEAR_MAPPING: 4,
              ADD_MAPPING: 5, PERSIST_CONFIG: 7, CLEAR_MACROS: 15, CLEAR_EXPRESSIONS: 19,
              CLEAR_QUIRKS: 23, SET_MONITOR_ENABLED: 22 };

// Load device.js with a stubbed WebHID. It is an IIFE that reads `navigator` at call time,
// so the global just has to exist before connect() runs.
function loadDevice(fake) {
  delete require.cache[require.resolve("../js/device.js")];
  delete require.cache[require.resolve("../js/crc.js")];
  // Node 22 ships a read-only global `navigator`, so plain assignment is ignored
  Object.defineProperty(globalThis, "navigator", {
    value: { hid: { requestDevice: async () => [fake] } },
    configurable: true,
    writable: true,
  });
  return require("../js/device.js");
}

// A device that answers the version handshake correctly and can be told to fail on the Nth write.
function makeFake({ failOnCommand } = {}) {
  const sent = [];
  const fake = {
    productName: "JJ8S",
    vendorId: 0xcafe,
    productId: 0xbabe,
    opened: false,
    collections: [{ usagePage: 0xff00 }],
    addEventListener() {},
    removeEventListener() {},
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    async sendFeatureReport(reportId, buffer) {
      const cmd = new DataView(buffer).getUint8(1);
      sent.push(cmd);
      if (failOnCommand != null && cmd === failOnCommand) {
        throw new Error("simulated WebHID write failure");
      }
    },
    async receiveFeatureReport() {
      // 33 bytes: [reportId][28 payload][4 crc]; device.js slices off byte 0 then checks the CRC
      const D = require("../js/device.js");
      const withId = new ArrayBuffer(33);
      const body = new DataView(withId, 1);
      body.setUint8(0, 18);     // version / first field (also the PERSIST_CONFIG success code=1 case below)
      D.addCrc(body);
      return new DataView(withId);
    },
  };
  fake.sent = sent;
  return fake;
}

const CONFIG = {
  version: 18,
  mappings: [
    { source_usage: "0x000c00e9", target_usage: "0xfffb0001", scaling: 50, layers: [0], combo_consume: true },
    { source_usage: "0x000c00ea", target_usage: "0xfffb0001", scaling: 50, layers: [0], combo_consume: true },
    { source_usage: "0xfffb0001", target_usage: "0x000c00e2", scaling: 1000, layers: [0] },
  ],
  macros: Array.from({ length: 32 }, () => []),
  expressions: ["", "", "", "", "", "", "", ""],
  quirks: [],
  unmapped_passthrough_layers: [0, 1, 2, 3, 4, 5, 6, 7],
  partial_scroll_timeout: 1000000,
  tap_hold_threshold: 200000,
  interval_override: 0,
  our_descriptor_number: 0,
  gpio_debounce_time_ms: 5,
  macro_entry_duration: 1,
};

test("a clean save suspends and resumes the device", async () => {
  const fake = makeFake();
  const D = loadDevice(fake);
  await D.connect();
  fake.sent.length = 0;

  await D.saveToDevice(CONFIG);

  assert.ok(fake.sent.includes(CMD.SUSPEND), "must suspend before rewriting the config");
  assert.ok(fake.sent.includes(CMD.RESUME), "must resume afterwards");
  assert.ok(fake.sent.lastIndexOf(CMD.RESUME) > fake.sent.indexOf(CMD.SUSPEND), "resume comes after suspend");
  await D.disconnect();
});

test("the combo is written as 3 ADD_MAPPING commands", async () => {
  const fake = makeFake();
  const D = loadDevice(fake);
  await D.connect();
  fake.sent.length = 0;

  await D.saveToDevice(CONFIG);
  const adds = fake.sent.filter((c) => c === CMD.ADD_MAPPING).length;
  assert.strictEqual(adds, 3, "2 members + 1 trigger");
  await D.disconnect();
});

/* THE BRICK TEST */
test("a save that fails midway STILL resumes the device (never leaves it suspended)", async () => {
  // blow up on the very first mapping write — right in the middle of the suspended window
  const fake = makeFake({ failOnCommand: CMD.ADD_MAPPING });
  const D = loadDevice(fake);
  await D.connect();
  fake.sent.length = 0;

  await assert.rejects(() => D.saveToDevice(CONFIG), /simulated WebHID write failure/,
    "the failure must still surface to the caller");

  assert.ok(fake.sent.includes(CMD.SUSPEND), "it did suspend");
  assert.ok(fake.sent.includes(CMD.RESUME),
    "IT MUST RESUME even though the save threw — otherwise the device is left dead until replug");
  await D.disconnect();
});

test("a save that fails on PERSIST still resumes", async () => {
  const fake = makeFake({ failOnCommand: CMD.PERSIST_CONFIG });
  const D = loadDevice(fake);
  await D.connect();
  fake.sent.length = 0;

  await assert.rejects(() => D.saveToDevice(CONFIG));
  assert.ok(fake.sent.includes(CMD.RESUME), "must resume after a failed persist");
  await D.disconnect();
});

test("a failed save does not wedge the busy flag (a retry is possible)", async () => {
  const fake = makeFake({ failOnCommand: CMD.ADD_MAPPING });
  const D = loadDevice(fake);
  await D.connect();

  await assert.rejects(() => D.saveToDevice(CONFIG));
  // if `busy` were left true, this second call would silently return {ok:false, code:0}
  // without ever talking to the device
  fake.sent.length = 0;
  await assert.rejects(() => D.saveToDevice(CONFIG));
  assert.ok(fake.sent.includes(CMD.SUSPEND), "the retry must actually reach the device");
  await D.disconnect();
});

test("save wipes-then-rewrites: CLEAR_* commands are all sent (so nothing may be dropped)", async () => {
  const fake = makeFake();
  const D = loadDevice(fake);
  await D.connect();
  fake.sent.length = 0;

  await D.saveToDevice(CONFIG);
  // these are exactly why configToApp must carry macros/expressions/quirks back
  assert.ok(fake.sent.includes(CMD.CLEAR_MAPPING), "CLEAR_MAPPING");
  assert.ok(fake.sent.includes(CMD.CLEAR_MACROS), "CLEAR_MACROS");
  assert.ok(fake.sent.includes(CMD.CLEAR_EXPRESSIONS), "CLEAR_EXPRESSIONS");
  assert.ok(fake.sent.includes(CMD.CLEAR_QUIRKS), "CLEAR_QUIRKS");
  await D.disconnect();
});
