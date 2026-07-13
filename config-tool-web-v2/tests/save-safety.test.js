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
const comboRow = (i, win) => ({
  id: i, inputs: ["0x00070004", "0x00070005"], output: "0x00070029",
  enabled: true, layers: L0, scale: 1, comboWindow: win == null ? 50 : win, comboConsume: true,
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

/* ---- combo overflow must not eat rows from a JSON export ---- */

test("more than NCOMBOS combos: withheld from the DEVICE, but ALL kept in the JSON export", () => {
  const rows = Array.from({ length: T.NCOMBOS + 3 }, (_, i) => comboRow(i + 1));
  const app = appWith(rows);

  const dev = T.appToConfig(app, { forDevice: true });
  assert.strictEqual(dev.mappings.length, T.NCOMBOS * 3, "only NCOMBOS combos reach the device");
  assert.strictEqual(dev.combo_overflow, 3, "and the caller is told how many were dropped");

  const json = T.appToConfig(app, {});
  const triggers = json.mappings.filter((m) => m.source_usage.startsWith("0xfffb"));
  assert.strictEqual(triggers.length, T.NCOMBOS + 3, "the JSON export must keep EVERY combo row");
  assert.strictEqual(json.disabled_rows.length, T.NCOMBOS + 3, "one entry per row — still aligned");

  // and every row survives a re-import, in order
  const back = T.configToApp(json, {}, null);
  assert.strictEqual(back.mappings.length, T.NCOMBOS + 3);
  assert.ok(back.mappings.every((m) => m.inputs.length === 2), "all still combos");
});

test("disabled_rows stays aligned when a row past NCOMBOS is switched off", () => {
  const rows = Array.from({ length: T.NCOMBOS + 2 }, (_, i) => comboRow(i + 1));
  rows[T.NCOMBOS + 1].enabled = false; // the very last one, past the device limit
  const json = T.appToConfig(appWith(rows), {});
  assert.strictEqual(json.disabled_rows.length, T.NCOMBOS + 2);
  assert.strictEqual(json.disabled_rows[T.NCOMBOS + 1], true);

  const back = T.configToApp(json, {}, null);
  assert.strictEqual(back.mappings.length, T.NCOMBOS + 2);
  assert.strictEqual(back.mappings[T.NCOMBOS + 1].enabled, false, "the right row comes back disabled");
});

test("a withheld combo never silently vanishes — the caller always gets a count", () => {
  // master switch off
  const off = T.appToConfig(appWith([comboRow(1)], { combosEnabled: false }), { forDevice: true });
  assert.strictEqual(off.combo_skipped, 1);
  assert.strictEqual(off.combo_overflow, undefined);

  // over the limit
  const over = T.appToConfig(appWith(Array.from({ length: T.NCOMBOS + 1 }, (_, i) => comboRow(i + 1))),
    { forDevice: true });
  assert.strictEqual(over.combo_overflow, 1);
  assert.strictEqual(over.combo_skipped, undefined);

  // nothing withheld -> no counters at all
  const fine = T.appToConfig(appWith([comboRow(1)]), { forDevice: true });
  assert.strictEqual(fine.combo_skipped, undefined);
  assert.strictEqual(fine.combo_overflow, undefined);
});

/* ---- the device payload must never carry our web-only bookkeeping ---- */

test("the forDevice payload carries no web-only fields", () => {
  const cfg = T.appToConfig(appWith([comboRow(1)]), { forDevice: true });
  assert.strictEqual(cfg.disabled_rows, undefined, "disabled_rows is web-only");
  assert.strictEqual(cfg.combos_enabled, undefined, "combos_enabled is web-only");
  assert.strictEqual(cfg.combos, undefined, "the old combos[] field is gone for good");
});
