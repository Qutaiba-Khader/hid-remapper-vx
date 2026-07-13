/* Node tests for the device wire protocol (32-byte feature reports).
   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const D = require("../js/device.js");

const ADD_MAPPING = 5;

/* ADD_MAPPING frame layout:
   [0] u8  version (18)      [1]  u8 command
   [2] u32 target_usage      [6]  u32 source_usage
   [10] i32 scaling          [14] u8 layer_mask
   [15] u8 flags             [16] u8 hub_ports        [28] u32 crc32 */

test("frame layout and version are unchanged (regression guard)", () => {
  const dv = new DataView(D.buildCommand(ADD_MAPPING, [
    ["u32", 0x000c00e2], ["u32", 0x000c00e9], ["i32", 1000],
    ["u8", 0b00000001], ["u8", 0], ["u8", 0],
  ]));
  assert.strictEqual(dv.getUint8(0), 18);              // CONFIG_VERSION must stay 18
  assert.strictEqual(dv.getUint8(1), ADD_MAPPING);
  assert.strictEqual(dv.getUint32(2, true), 0x000c00e2);
  assert.strictEqual(dv.getUint32(6, true), 0x000c00e9);
  assert.strictEqual(dv.getInt32(10, true), 1000);
  assert.strictEqual(dv.getUint8(14), 0b00000001);
});

test("the CRC guards every command frame", () => {
  // checkCrc takes a DataView and throws on mismatch
  const dv = new DataView(D.buildCommand(ADD_MAPPING, [
    ["u32", 0x000c00e2], ["u32", 0x000c00ea], ["i32", 1000],
    ["u8", 0b00000001], ["u8", 0], ["u8", 0],
  ]));
  assert.doesNotThrow(() => D.checkCrc(dv));

  dv.setUint8(15, 0xff);  // tamper with the flags byte
  assert.throws(() => D.checkCrc(dv), /CRC error/);
});
