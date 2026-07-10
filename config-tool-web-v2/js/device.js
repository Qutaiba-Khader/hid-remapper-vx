/*
 * device.js — WebHID + the HID Remapper binary config protocol.
 * Ported faithfully from config-tool-web/code.js (the working tool). CONFIG_VERSION 18.
 *
 * Operates on the same `config` object shape code.js uses, which is exactly what
 * translate.js produces/consumes:
 *   config = { version, mappings:[{target_usage,source_usage,scaling,layers:[idx],sticky,tap,hold,source_port,target_port}],
 *              macros:[[["0x..",...],...]×32], expressions:[str×8], quirks:[...], + settings fields }
 *
 * Public API (window.HRX_DEVICE):
 *   connect() -> {name,vidpid,firmware} | throws        disconnect()
 *   isConnected()                                        getInfo()
 *   loadFromDevice() -> config                           saveToDevice(config) -> {ok, code}
 *   setMonitorEnabled(bool)   onMonitor(cb)  (cb({usage,value,hub_port}))
 *   flashFirmware()  flashBSide()  pairNewDevice()  clearBonds()
 *   -- pure helpers (also unit-tested in Node): buildCommand, parseFields, exprToElems,
 *      exprElemsToText, maskToLayerList, layerListToMask, addCrc, checkCrc
 */
(function () {
  const crc32 = (typeof window !== "undefined" && window.HRX_CRC32) ||
    (typeof require !== "undefined" ? require("./crc.js") : null);

  // ---- constants (verbatim from code.js) ----
  const REPORT_ID_CONFIG = 100;
  const REPORT_ID_MONITOR = 101;
  const CONFIG_SIZE = 32;
  const CONFIG_VERSION = 18;
  const NLAYERS = 8, NMACROS = 32, NEXPRESSIONS = 8, MACRO_ITEMS_IN_PACKET = 6;

  const STICKY_FLAG = 1 << 0, TAP_FLAG = 1 << 1, HOLD_FLAG = 1 << 2;
  const IGNORE_AUTH_DEV_INPUTS_FLAG = 1 << 4, GPIO_OUTPUT_MODE_FLAG = 1 << 5, NORMALIZE_GAMEPAD_INPUTS_FLAG = 1 << 6;
  const HUB_PORT_NONE = 255;
  const QUIRK_FLAG_RELATIVE_MASK = 0b10000000, QUIRK_FLAG_SIGNED_MASK = 0b01000000, QUIRK_SIZE_MASK = 0b00111111;

  const RESET_INTO_BOOTSEL = 1, SET_CONFIG = 2, GET_CONFIG = 3, CLEAR_MAPPING = 4, ADD_MAPPING = 5,
    GET_MAPPING = 6, PERSIST_CONFIG = 7, GET_OUR_USAGES = 8, GET_THEIR_USAGES = 9, SUSPEND = 10, RESUME = 11,
    PAIR_NEW_DEVICE = 12, CLEAR_BONDS = 13, FLASH_B_SIDE = 14, CLEAR_MACROS = 15, APPEND_TO_MACRO = 16,
    GET_MACRO = 17, CLEAR_EXPRESSIONS = 19, APPEND_TO_EXPRESSION = 20, GET_EXPRESSION = 21,
    SET_MONITOR_ENABLED = 22, CLEAR_QUIRKS = 23, ADD_QUIRK = 24, GET_QUIRK = 25;

  const PERSIST_CONFIG_SUCCESS = 1, PERSIST_CONFIG_CONFIG_TOO_BIG = 2;

  const U8 = "u8", U16 = "u16", U32 = "u32", I32 = "i32";

  const ops = {
    PUSH: 0, PUSH_USAGE: 1, INPUT_STATE: 2, ADD: 3, MUL: 4, EQ: 5, TIME: 6, MOD: 7, GT: 8, NOT: 9,
    INPUT_STATE_BINARY: 10, ABS: 11, DUP: 12, SIN: 13, COS: 14, DEBUG: 15, AUTO_REPEAT: 16, RELU: 17,
    CLAMP: 18, SCALING: 19, LAYER_STATE: 20, STICKY_STATE: 21, TAP_STATE: 22, HOLD_STATE: 23,
    BITWISE_OR: 24, BITWISE_AND: 25, BITWISE_NOT: 26, PREV_INPUT_STATE: 27, PREV_INPUT_STATE_BINARY: 28,
    STORE: 29, RECALL: 30, SQRT: 31, ATAN2: 32, ROUND: 33, PORT: 34, DPAD: 35, EOL: 36,
    INPUT_STATE_FP32: 37, PREV_INPUT_STATE_FP32: 38, MIN: 39, MAX: 40, IFTE: 41, DIV: 42, SWAP: 43,
    MONITOR: 44, SIGN: 45, SUB: 46, PRINT_IF: 47, TIME_SEC: 48, LT: 49, PLUGGED_IN: 50,
    INPUT_STATE_SCALED: 51, PREV_INPUT_STATE_SCALED: 52, DEADZONE: 53, DEADZONE2: 54,
  };
  const opcodes = Object.fromEntries(Object.entries(ops).map(([k, v]) => [v, k]));
  const expr_re = /((?:\/\*.*?\*\/)?)((?:(?!\/\*).)*)/gs;

  // ---- module state ----
  let device = null;
  let deviceVersion = null;
  let busy = false;
  let monitorEnabled = false;
  let monitorCb = null;

  // ---- pure helpers ----
  const hex8 = (n) => "0x" + (n >>> 0).toString(16).padStart(8, "0");
  const hex4 = (n) => "0x" + (n & 0xffff).toString(16).padStart(4, "0");

  function maskToLayerList(mask) {
    const out = [];
    for (let i = 0; i < NLAYERS; i++) if (mask & (1 << i)) out.push(i);
    return out;
  }
  function layerListToMask(layers) {
    let m = 0;
    for (const l of layers || []) m |= (1 << l);
    return m;
  }

  function writeField(dv, pos, type, value) {
    switch (type) {
      case U8: dv.setUint8(pos, value); return pos + 1;
      case U16: dv.setUint16(pos, value, true); return pos + 2;
      case U32: dv.setUint32(pos, value >>> 0, true); return pos + 4;
      case I32: dv.setInt32(pos, value | 0, true); return pos + 4;
    }
    return pos;
  }

  function addCrc(dv) { dv.setUint32(CONFIG_SIZE - 4, crc32(dv, CONFIG_SIZE - 4), true); }
  function checkCrc(dv) {
    if (dv.getUint32(CONFIG_SIZE - 4, true) !== crc32(dv, CONFIG_SIZE - 4)) throw new Error("CRC error.");
  }

  // build a 32-byte command buffer (returns ArrayBuffer). fields = [[type, value], ...]
  function buildCommand(command, fields = [], version = CONFIG_VERSION) {
    const buffer = new ArrayBuffer(CONFIG_SIZE);
    const dv = new DataView(buffer);
    dv.setUint8(0, version);
    dv.setUint8(1, command);
    let pos = 2;
    for (const [type, value] of fields) pos = writeField(dv, pos, type, value);
    addCrc(dv);
    return buffer;
  }

  // parse fields out of a response DataView (already offset past the report id). types = [U8, ...]
  function parseFields(dv, types) {
    const out = [];
    let pos = 0;
    for (const type of types) {
      switch (type) {
        case U8: out.push(dv.getUint8(pos)); pos += 1; break;
        case U16: out.push(dv.getUint16(pos, true)); pos += 2; break;
        case U32: out.push(dv.getUint32(pos, true)); pos += 4; break;
        case I32: out.push(dv.getInt32(pos, true)); pos += 4; break;
      }
    }
    return out;
  }

  function exprToElems(expr) {
    const convert = (elem) => {
      if (elem.toLowerCase().startsWith("0x")) return [ops.PUSH_USAGE, parseInt(elem, 16)];
      if (/^[0-9-]/.test(elem)) return [ops.PUSH, parseInt(elem, 10)];
      if (elem.toUpperCase() in ops) return [ops[elem.toUpperCase()]];
      throw new Error('Invalid expression: "' + elem + '"');
    };
    return [...expr.matchAll(expr_re)].map((x) => x[2]).join("").split(/\s+/).filter((x) => x.length > 0).map(convert);
  }

  // reverse: a flat list of [opcode] / [PUSH,val] / [PUSH_USAGE,val] elems -> text (matches code.js load)
  function exprElemsToText(elems) {
    const parts = [];
    for (const [op, val] of elems) {
      if (op === ops.PUSH) parts.push(String(val | 0));
      else if (op === ops.PUSH_USAGE) parts.push(hex8(val));
      else parts.push(opcodes[op].toLowerCase());
    }
    return parts.join(" ");
  }

  // ---- WebHID I/O ----
  function requireDevice() { if (!device) throw new Error("No device connected."); }

  async function sendCommand(command, fields = [], version = CONFIG_VERSION) {
    requireDevice();
    await device.sendFeatureReport(REPORT_ID_CONFIG, buildCommand(command, fields, version));
  }

  async function readFeature(types = []) {
    requireDevice();
    let attempts = 10, delay = 2, data;
    while (true) {
      const withId = await device.receiveFeatureReport(REPORT_ID_CONFIG);
      data = new DataView(withId.buffer, 1);
      if (data.byteLength > 0) break;
      if (--attempts <= 0) throw new Error("Error in read_config_feature (given up retrying).");
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
    checkCrc(data);
    return parseFields(data, types);
  }

  async function checkVersion() {
    for (const v of [CONFIG_VERSION, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) {
      await sendCommand(GET_CONFIG, [], v);
      const [received] = await readFeature([U8]);
      if (received === v) {
        deviceVersion = v;
        if (v === CONFIG_VERSION) return true;
        throw new Error("Incompatible firmware version (" + v + "). Please update your HID Remapper firmware to the latest release.");
      }
    }
    throw new Error("Could not determine device config version.");
  }

  function onInputReport(event) {
    if (event.reportId !== REPORT_ID_MONITOR || !monitorCb) return;
    for (let i = 0; i < 7; i++) {
      const usage = event.data.getUint32(i * 9, true);
      const value = event.data.getInt32(i * 9 + 4, true);
      const hub_port = event.data.getUint8(i * 9 + 8);
      if (usage !== 0) monitorCb({ usage: hex8(usage), value, hub_port });
    }
  }

  async function connect() {
    if (busy) return null;
    busy = true;
    try {
      const devices = await navigator.hid.requestDevice({ filters: [{ usagePage: 0xff00, usage: 0x0020 }] });
      const found = devices && devices.find((d) => d.collections.some((c) => c.usagePage === 0xff00));
      if (!found) return null;
      device = found;
      if (!device.opened) await device.open();
      await checkVersion();
      device.addEventListener("inputreport", onInputReport);
      await setMonitorEnabled(monitorEnabled);
      return getInfo();
    } catch (e) {
      device = null; deviceVersion = null;
      throw e;
    } finally {
      busy = false;
    }
  }

  async function disconnect() {
    if (device) {
      try { device.removeEventListener("inputreport", onInputReport); } catch (e) {}
      try { if (device.opened) await device.close(); } catch (e) {}
    }
    device = null; deviceVersion = null;
  }

  function isConnected() { return !!device; }

  function getInfo() {
    if (!device) return null;
    return {
      name: device.productName || "HID Remapper",
      vidpid: hex4(device.vendorId) + ":" + hex4(device.productId),
      firmware: deviceVersion != null ? "config v" + deviceVersion : "",
      bluetooth: !!(device.productName && device.productName.includes("Bluetooth")),
    };
  }

  // ---- load ----
  async function loadFromDevice() {
    requireDevice();
    if (busy) return null;
    busy = true;
    const config = {};
    try {
      await sendCommand(GET_CONFIG);
      const [version, flags, passMask, scrollTimeout, mappingCount, ourCount, theirCount,
        interval, tapHold, gpioDebounce, descNumber, macroDuration, quirkCount] =
        await readFeature([U8, U8, U8, U32, U16, U32, U32, U8, U32, U8, U8, U8, U16]);
      if (version !== CONFIG_VERSION) throw new Error("Incompatible version.");

      config.version = version;
      config.unmapped_passthrough_layers = maskToLayerList(passMask);
      config.partial_scroll_timeout = scrollTimeout;
      config.tap_hold_threshold = tapHold;
      config.gpio_debounce_time_ms = gpioDebounce;
      config.interval_override = interval;
      config.our_descriptor_number = descNumber;
      config.ignore_auth_dev_inputs = !!(flags & IGNORE_AUTH_DEV_INPUTS_FLAG);
      config.gpio_output_mode = flags & GPIO_OUTPUT_MODE_FLAG ? 1 : 0;
      config.normalize_gamepad_inputs = !!(flags & NORMALIZE_GAMEPAD_INPUTS_FLAG);
      config.macro_entry_duration = macroDuration + 1;

      config.mappings = [];
      for (let i = 0; i < mappingCount; i++) {
        await sendCommand(GET_MAPPING, [[U32, i]]);
        const [target, source, scaling, layerMask, mapFlags, hubPorts] = await readFeature([U32, U32, I32, U8, U8, U8]);
        config.mappings.push({
          target_usage: hex8(target), source_usage: hex8(source), scaling,
          layers: maskToLayerList(layerMask),
          sticky: !!(mapFlags & STICKY_FLAG), tap: !!(mapFlags & TAP_FLAG), hold: !!(mapFlags & HOLD_FLAG),
          source_port: hubPorts & 0x0f, target_port: (hubPorts >> 4) & 0x0f,
        });
      }

      config.macros = [];
      for (let mi = 0; mi < NMACROS; mi++) {
        let macro = [], off = 0, going = true;
        while (going) {
          await sendCommand(GET_MACRO, [[U32, mi], [U32, off]]);
          const f = await readFeature([U8, U32, U32, U32, U32, U32, U32]);
          const nitems = f[0], usagesArr = f.slice(1);
          if (nitems < MACRO_ITEMS_IN_PACKET) going = false;
          if (macro.length === 0 && nitems > 0) macro = [[]];
          for (const u of usagesArr.slice(0, nitems)) {
            if (u === 0) macro.push([]); else macro[macro.length - 1].push(hex8(u));
          }
          off += MACRO_ITEMS_IN_PACKET;
        }
        config.macros.push(macro);
      }

      config.expressions = [];
      for (let ei = 0; ei < NEXPRESSIONS; ei++) {
        const elems = [];
        let off = 0;
        while (true) {
          await sendCommand(GET_EXPRESSION, [[U32, ei], [U32, off]]);
          const f = await readFeature(new Array(28).fill(U8));
          const nelems = f[0];
          if (nelems === 0) break;
          let rest = f.slice(1);
          for (let j = 0; j < nelems; j++) {
            const op = rest[0]; rest = rest.slice(1);
            if (op === ops.PUSH || op === ops.PUSH_USAGE) {
              const val = (rest[3] << 24) | (rest[2] << 16) | (rest[1] << 8) | rest[0];
              rest = rest.slice(4);
              elems.push([op, op === ops.PUSH ? val : val >>> 0]);
            } else {
              elems.push([op]);
            }
          }
          off += nelems;
        }
        config.expressions.push(exprElemsToText(elems));
      }

      config.quirks = [];
      for (let qi = 0; qi < quirkCount; qi++) {
        await sendCommand(GET_QUIRK, [[U32, qi]]);
        const [vid, pid, iface, reportId, usage, bitpos, sizeFlags] = await readFeature([U16, U16, U8, U8, U32, U16, U8]);
        config.quirks.push({
          vendor_id: hex4(vid), product_id: hex4(pid), interface: iface, report_id: reportId,
          usage: hex8(usage), bitpos, size: sizeFlags & QUIRK_SIZE_MASK,
          relative: !!(sizeFlags & QUIRK_FLAG_RELATIVE_MASK), signed: !!(sizeFlags & QUIRK_FLAG_SIGNED_MASK),
        });
      }
      return config;
    } finally {
      busy = false;
    }
  }

  // ---- save ----
  async function saveToDevice(config) {
    requireDevice();
    if (busy) return { ok: false, code: 0 };
    busy = true;
    try {
      await sendCommand(SUSPEND);
      const flags = (config.ignore_auth_dev_inputs ? IGNORE_AUTH_DEV_INPUTS_FLAG : 0) |
        (config.gpio_output_mode ? GPIO_OUTPUT_MODE_FLAG : 0) |
        (config.normalize_gamepad_inputs ? NORMALIZE_GAMEPAD_INPUTS_FLAG : 0);
      await sendCommand(SET_CONFIG, [
        [U8, flags],
        [U8, layerListToMask(config.unmapped_passthrough_layers)],
        [U32, config.partial_scroll_timeout],
        [U8, config.interval_override || 0],
        [U32, config.tap_hold_threshold],
        [U8, config.gpio_debounce_time_ms],
        [U8, config.our_descriptor_number || 0],
        [U8, (config.macro_entry_duration || 1) - 1],
      ]);

      await sendCommand(CLEAR_MAPPING);
      for (const m of config.mappings || []) {
        await sendCommand(ADD_MAPPING, [
          [U32, parseInt(m.target_usage, 16)],
          [U32, parseInt(m.source_usage, 16)],
          [I32, m.scaling],
          [U8, layerListToMask(m.layers)],
          [U8, (m.sticky ? STICKY_FLAG : 0) | (m.tap ? TAP_FLAG : 0) | (m.hold ? HOLD_FLAG : 0)],
          [U8, ((m.target_port & 0x0f) << 4) | (m.source_port & 0x0f)],
        ]);
      }

      await sendCommand(CLEAR_MACROS);
      let mi = 0;
      for (const macro of config.macros || []) {
        if (mi >= NMACROS) break;
        const flat = macro.map((x) => x.concat(["0x00"])).flat().slice(0, -1);
        for (let i = 0; i < flat.length; i += MACRO_ITEMS_IN_PACKET) {
          const chunk = Math.min(MACRO_ITEMS_IN_PACKET, flat.length - i);
          await sendCommand(APPEND_TO_MACRO,
            [[U8, mi], [U8, chunk]].concat(flat.slice(i, i + chunk).map((x) => [U32, parseInt(x, 16)])));
        }
        mi++;
      }

      await sendCommand(CLEAR_EXPRESSIONS);
      let ei = 0;
      for (const expr of config.expressions || []) {
        if (ei >= NEXPRESSIONS) break;
        let elems = exprToElems(expr);
        while (elems.length > 0) {
          let bytesLeft = 24, items = [], nelems = 0;
          while (elems.length > 0 && bytesLeft > 0) {
            const e = elems[0];
            if (e[0] === ops.PUSH || e[0] === ops.PUSH_USAGE) {
              if (bytesLeft >= 5) { items.push([U8, e[0]], [U32, e[1] >>> 0]); bytesLeft -= 5; nelems++; elems = elems.slice(1); }
              else break;
            } else { items.push([U8, e[0]]); bytesLeft--; nelems++; elems = elems.slice(1); }
          }
          await sendCommand(APPEND_TO_EXPRESSION, [[U8, ei], [U8, nelems]].concat(items));
        }
        ei++;
      }

      await sendCommand(CLEAR_QUIRKS);
      for (const q of config.quirks || []) {
        const sizeFlags = (q.size & QUIRK_SIZE_MASK) | (q.relative ? QUIRK_FLAG_RELATIVE_MASK : 0) | (q.signed ? QUIRK_FLAG_SIGNED_MASK : 0);
        await sendCommand(ADD_QUIRK, [
          [U16, parseInt(q.vendor_id, 16)], [U16, parseInt(q.product_id, 16)],
          [U8, q.interface], [U8, q.report_id], [U32, parseInt(q.usage, 16)], [U16, q.bitpos], [U8, sizeFlags],
        ]);
      }

      await sendCommand(PERSIST_CONFIG);
      const [code] = await readFeature([U8]);
      await sendCommand(RESUME);
      if (code === PERSIST_CONFIG_SUCCESS) return { ok: true, code };
      if (code === PERSIST_CONFIG_CONFIG_TOO_BIG) return { ok: false, code, error: "Configuration too big to persist." };
      return { ok: false, code, error: "Unknown PERSIST_CONFIG return code (" + code + ")." };
    } finally {
      busy = false;
    }
  }

  // ---- monitor + firmware actions ----
  async function setMonitorEnabled(enabled) {
    monitorEnabled = enabled;
    if (device) await sendCommand(SET_MONITOR_ENABLED, [[U8, enabled ? 1 : 0]]);
  }
  function onMonitor(cb) { monitorCb = cb; }

  async function flashFirmware() { await sendCommand(RESET_INTO_BOOTSEL); }
  async function flashBSide() { await sendCommand(FLASH_B_SIDE); }
  async function pairNewDevice() { await sendCommand(PAIR_NEW_DEVICE); }
  async function clearBonds() { await sendCommand(CLEAR_BONDS); }

  const API = {
    // lifecycle
    connect, disconnect, isConnected, getInfo,
    loadFromDevice, saveToDevice,
    setMonitorEnabled, onMonitor,
    flashFirmware, flashBSide, pairNewDevice, clearBonds,
    // constants
    CONFIG_VERSION, HUB_PORT_NONE, PERSIST_CONFIG_SUCCESS, PERSIST_CONFIG_CONFIG_TOO_BIG,
    // pure helpers (tested in Node)
    buildCommand, parseFields, addCrc, checkCrc,
    exprToElems, exprElemsToText, maskToLayerList, layerListToMask,
    _types: { U8, U16, U32, I32 }, _ops: ops,
  };

  if (typeof window !== "undefined") window.HRX_DEVICE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
