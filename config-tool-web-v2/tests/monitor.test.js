/* MONITOR tests — drive a real HID input report through device.js and check what comes out.

   The monitor is the one feature that is pure wire-parsing: the device streams report 101 with
   7 slots of [u32 usage][i32 value][u8 hub_port]. If that parse is off by a byte, the Monitor
   tab silently shows nothing (or garbage) and you only find out with hardware in your hand.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");

const REPORT_ID_MONITOR = 101;
const REPORT_ID_CONFIG = 100;

function loadDevice() {
  delete require.cache[require.resolve("../js/device.js")];
  delete require.cache[require.resolve("../js/crc.js")];

  const listeners = {};
  const fake = {
    productName: "JJ8S",
    vendorId: 0xcafe,
    productId: 0xbabe,
    opened: false,
    collections: [{ usagePage: 0xff00 }],
    sentCommands: [],
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    async sendFeatureReport(id, buffer) {
      const dv = new DataView(buffer);
      this.sentCommands.push({ cmd: dv.getUint8(1), arg: dv.getUint8(2) });
    },
    async receiveFeatureReport() {
      const D = require("../js/device.js");
      const withId = new ArrayBuffer(33);
      const body = new DataView(withId, 1);
      body.setUint8(0, 18);
      D.addCrc(body);
      return new DataView(withId);
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { hid: { requestDevice: async () => [fake] } },
    configurable: true, writable: true,
  });
  const D = require("../js/device.js");
  return { D, fake, fire: (type, ev) => (listeners[type] || []).forEach((fn) => fn(ev)) };
}

// Build one monitor report exactly as the firmware sends it:
// monitor_report_t = 7 x { u32 usage, i32 value, u8 hub_port }  (9 bytes each)
function monitorReport(items) {
  const buf = new ArrayBuffer(7 * 9);
  const dv = new DataView(buf);
  items.forEach((it, i) => {
    dv.setUint32(i * 9, it.usage, true);
    dv.setInt32(i * 9 + 4, it.value, true);
    dv.setUint8(i * 9 + 8, it.hub_port || 0);
  });
  return dv;
}

test("a monitor report is decoded into usage / value / hub_port", async () => {
  const { D, fire } = loadDevice();
  await D.connect();

  const seen = [];
  D.onMonitor((rec) => seen.push(rec));

  fire("inputreport", {
    reportId: REPORT_ID_MONITOR,
    data: monitorReport([
      { usage: 0x000c00e9, value: 1, hub_port: 0 },   // Volume Up pressed
      { usage: 0x00010030, value: -42, hub_port: 2 }, // Mouse X, negative, on hub port 2
    ]),
  });

  assert.strictEqual(seen.length, 2, "both populated slots must be reported");
  assert.deepStrictEqual(seen[0], { usage: "0x000c00e9", value: 1, hub_port: 0 });
  assert.deepStrictEqual(seen[1], { usage: "0x00010030", value: -42, hub_port: 2 },
    "value must be read as SIGNED (an axis can go negative)");
  await D.disconnect();
});

test("empty slots (usage 0) are ignored", async () => {
  const { D, fire } = loadDevice();
  await D.connect();
  const seen = [];
  D.onMonitor((rec) => seen.push(rec));

  fire("inputreport", {
    reportId: REPORT_ID_MONITOR,
    data: monitorReport([{ usage: 0x000c00e9, value: 1 }]), // slots 1..6 are zero
  });
  assert.strictEqual(seen.length, 1, "the 6 empty slots must not produce phantom rows");
  await D.disconnect();
});

test("all 7 slots decode (a busy device fills the report)", async () => {
  const { D, fire } = loadDevice();
  await D.connect();
  const seen = [];
  D.onMonitor((rec) => seen.push(rec));

  const items = Array.from({ length: 7 }, (_, i) => ({ usage: 0x00070004 + i, value: i + 1, hub_port: i }));
  fire("inputreport", { reportId: REPORT_ID_MONITOR, data: monitorReport(items) });

  assert.strictEqual(seen.length, 7);
  assert.strictEqual(seen[6].usage, "0x0007000a");
  assert.strictEqual(seen[6].value, 7);
  assert.strictEqual(seen[6].hub_port, 6, "the 7th slot must land at byte offset 54");
  await D.disconnect();
});

test("reports on OTHER report ids are ignored (config replies must not reach the monitor)", async () => {
  const { D, fire } = loadDevice();
  await D.connect();
  const seen = [];
  D.onMonitor((rec) => seen.push(rec));

  fire("inputreport", {
    reportId: REPORT_ID_CONFIG, // not the monitor report
    data: monitorReport([{ usage: 0x000c00e9, value: 1 }]),
  });
  assert.strictEqual(seen.length, 0);
  await D.disconnect();
});

test("SET_MONITOR_ENABLED is actually sent to the device when the tab turns it on", async () => {
  const { D, fake } = loadDevice();
  await D.connect();
  fake.sentCommands.length = 0;

  await D.setMonitorEnabled(true);
  const on = fake.sentCommands.find((c) => c.cmd === 22); // SET_MONITOR_ENABLED
  assert.ok(on, "enabling the monitor must send command 22");
  assert.strictEqual(on.arg, 1, "with the payload 1");

  fake.sentCommands.length = 0;
  await D.setMonitorEnabled(false);
  const off = fake.sentCommands.find((c) => c.cmd === 22);
  assert.ok(off, "leaving the tab must send command 22");
  assert.strictEqual(off.arg, 0, "with the payload 0 — otherwise the device keeps streaming forever");
  await D.disconnect();
});

test("the monitor stream is re-enabled after a reconnect", async () => {
  const { D, fake } = loadDevice();
  await D.connect();
  await D.setMonitorEnabled(true);
  await D.disconnect();

  // reconnecting must restore the streaming state, not silently leave it off
  fake.sentCommands.length = 0;
  await D.connect();
  const cmd = fake.sentCommands.find((c) => c.cmd === 22);
  assert.ok(cmd, "connect() must push the monitor state to the device");
  assert.strictEqual(cmd.arg, 1, "the monitor was on before — it must come back on");
  await D.disconnect();
});

/* ---- the combo is no longer a black box on hardware ---- */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// usages.js is a classic browser script (it assigns window.HRX_USAGES), so give it a window
const loadUsages = () => {
  const sandbox = { window: {} };
  vm.runInNewContext(readSrc("js/usages.js"), sandbox);
  return sandbox.window.HRX_USAGES;
};

test("the monitor names a combo state slot instead of showing raw hex", () => {
  // The firmware reports each combo's internal state on page 0xFFFB (remapper.cc,
  // evaluate_combos -> monitor_usage) so you can see whether a combo actually LATCHED.
  // Without a label these arrive as "0xfffb0001" and mean nothing to the user.
  const { usageName } = loadUsages();
  assert.strictEqual(usageName("0xfffb0001"), "Combo 1");
  assert.strictEqual(usageName("0xfffb0003"), "Combo 3");
  assert.strictEqual(usageName("0x000c00e2"), "Mute", "and the normal catalog must still work");
});

test("Consume with a 0 window is warned about, not silently allowed", () => {
  // With no window the firmware has no deadline to defer the leading key to, so it passes
  // through for the few ms before the combo forms -- a real, brief click. See
  // firmware/sim/combo.test.js "window 0 + consume still leaks the leading press".
  const m = readSrc("js/mappings.js");
  assert.ok(/consume && Number\(win\) === 0/.test(m),
    "the row must detect the Consume + 0-window combination");
  assert.ok(/combo-warn/.test(m), "and show a warning badge");
  assert.ok(/\.combo-warn/.test(readSrc("css/mappings.css")),
    "which must actually be styled, or it is invisible");
});

test("hub port 255 is HUB_PORT_NONE — it must never be shown as a port number", () => {
  // The firmware sends 255 (HUB_PORT_NONE, remapper.cc:131) when the device is NOT behind a
  // USB hub. It means "there is no port". Printing it raw put a meaningless "255" on every
  // single row of a normal setup. v1 hides the badge for 0 and 255; v2 must too.
  const t = readSrc("js/tabs.js");
  assert.ok(/const HUB_PORT_NONE = 255/.test(t), "the sentinel must be named, not magic");
  assert.ok(/function portLabel/.test(t) && /portLabel\(r\.hub_port\)/.test(t),
    "the monitor row must render the port through portLabel, not print hub_port raw");
  assert.ok(!/\$\{r\.hub_port \|\| 0\}/.test(t),
    "the old raw render must be gone — it printed 255 on every row");

  // and the firmware really does use 255 for 'no hub'
  const cc = fs.readFileSync(path.join(__dirname, "..", "..", "firmware", "src", "remapper.cc"), "utf8");
  assert.match(cc, /#define HUB_PORT_NONE 255/);
});

test("a live monitor update must NOT rebuild the rows — it destroys the + button mid-click", () => {
  // THE BUG: paintMon did `body.innerHTML = rows.map(rowMon)` on EVERY monitor report. The
  // monitored device is usually the very mouse you are holding, so moving it toward the +
  // button streams Cursor X/Y and rebuilt the table dozens of times a second. The button was
  // destroyed between mousedown and mouseup, and a browser only fires `click` when both land
  // on the SAME element -- so the + did nothing, forever.
  //
  // Scripted clicks worked (they move no mouse), which is why unit tests AND a scripted
  // browser pass both missed it. The row must therefore be a STABLE node.
  const t = readSrc("js/tabs.js");
  assert.ok(/const monEls = new Map\(\)/.test(t), "rows must be cached as real DOM nodes");
  assert.ok(/tr\.querySelector\("\[data-mkmap\]"\)\.addEventListener/.test(t),
    "the + listener must be bound once to a node that is never replaced");
  assert.ok(/c\[3\]\.textContent = r\.last/.test(t),
    "a live update must only rewrite the number cells, not the row");
  assert.ok(!/rows\.map\(rowMon\)\.join/.test(t),
    "the old full-rebuild-on-every-report must be gone — that is what broke the + button");
  assert.ok(/monEls\.clear\(\)/.test(t), "and the cache must be dropped when the container is rebuilt");
});
