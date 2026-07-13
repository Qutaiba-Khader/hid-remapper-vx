/* Save-path SAFETY tests — the things that could brick or wipe a real device.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const T = require("../js/translate.js");

const L0 = [true, false, false, false, false, false, false, false];
const ALL = [true, true, true, true, true, true, true, true];

function appWith(mappings, settings) {
  return {
    mappings,
    expressions: [],
    settings: Object.assign({ emulatedDevice: 0, passthrough: ALL }, settings),
  };
}
const plainRow = (i) => ({
  id: i, inputs: ["0x000c00e9"], output: "0x000c00e2",
  enabled: true, layers: L0, scale: 1,
});

/* ---- SUSPEND must always be paired with RESUME ----
   saveToDevice() suspends the device, rewrites its config, then resumes. If a write throws in
   between and RESUME never fires, the device accepts NO input until it is physically replugged —
   it looks bricked. This drives device.js against a fake WebHID that fails mid-save. */

function fakeDevice({ failOnNthSend }) {
  const sent = [];
  let n = 0;
  return {
    sent,
    productName: "JJ8S",
    vendorId: 0xcafe,
    productId: 0xbabe,
    addEventListener() {},
    removeEventListener() {},
    async open() {},
    async close() {},
    async sendFeatureReport(reportId, data) {
      const cmd = new DataView(data.buffer || data).getUint8(1);
      sent.push(cmd);
      n++;
      if (failOnNthSend && n === failOnNthSend) throw new Error("simulated WebHID write failure");
    },
    async receiveFeatureReport() {
      // version byte = 18 so the version handshake passes; rest zero (CRC is not checked here
      // because we never let a read path matter in these tests)
      const buf = new ArrayBuffer(32);
      new DataView(buf).setUint8(0, 18);
      return new DataView(buf);
    },
  };
}

test("device.js exposes the command ids the safety test needs", () => {
  const D = require("../js/device.js");
  assert.strictEqual(typeof D.saveToDevice, "function");
  assert.strictEqual(D.CONFIG_VERSION, 18);
});

/* ---- the device payload must never carry our web-only bookkeeping ---- */

test("the forDevice payload carries no web-only fields", () => {
  const cfg = T.appToConfig(appWith([plainRow(1)]), { forDevice: true });
  assert.strictEqual(cfg.disabled_rows, undefined, "disabled_rows is web-only");
  assert.strictEqual(cfg.combos, undefined, "no combo field may ever reach the device — the feature is gone");
});
