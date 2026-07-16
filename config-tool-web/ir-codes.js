// Shared IR code catalog for the hid-remapper IR-output feature (firmware page 0xFFFB).
//
// A mapping's target usage carries the PROTOCOL in its low bits (0xFFFB0001 = NEC, 0xFFFB0002 =
// Samsung); the 32-bit CODE is stored in the mapping's `scaling` field (raw, not ×1000). The
// firmware transmits the code LSB-first, so these 32-bit values are exactly what goes on the wire.
//
// SAMSUNG codes are computed, not copy-pasted: Samsung is NEC-timing with a 4.5 ms leader, customer
// code 0x07, frame bytes [0x07][0x07][cmd][~cmd] each LSB-first. So code = 0x0707 | cmd<<16 |
// (~cmd & 0xFF)<<24. Anchor check: digit "1" (cmd 0x04) = 0xFB040707, which matches published
// Samsung dumps. The command bytes for power/digits/volume/mute/channel/source/menu are the classic
// documented Samsung set; the navigation/home/guide bytes are the common values but SHOULD BE
// VERIFIED on the actual TV (they vary a little across model years). The editable hex field in the
// mapping row is the escape hatch for anything that doesn't match.
(function () {
  "use strict";

  var PROTO = { NEC: 1, SAMSUNG: 2 };
  var PAGE = 0xfffb;
  var PIN_USAGE = "0xfffb00ff"; // set-pin pseudo-mapping target; its scaling = the GPIO pin

  // Build a Samsung 32-bit code from its command byte.
  function sam(cmd) {
    var code = (0x0707 | (cmd << 16) | ((~cmd & 0xff) << 24)) >>> 0;
    return code;
  }

  // Devices, grouped by protocol. Each button is [label, code32].
  var DEVICES = [
    {
      id: "samsung-tv",
      label: "Samsung TV",
      proto: PROTO.SAMSUNG,
      note: "starter set — verify on your TV",
      buttons: [
        ["Power", sam(0x02)],
        ["Source / Input", sam(0x01)],
        ["Volume +", sam(0x07)],
        ["Volume −", sam(0x0b)],
        ["Mute", sam(0x0f)],
        ["Channel +", sam(0x12)],
        ["Channel −", sam(0x10)],
        ["Up", sam(0x60)],
        ["Down", sam(0x61)],
        ["Left", sam(0x65)],
        ["Right", sam(0x62)],
        ["OK / Enter", sam(0x68)],
        ["Return / Back", sam(0x58)],
        ["Exit", sam(0x2d)],
        ["Menu", sam(0x1a)],
        ["Home / Smart Hub", sam(0x79)],
        ["Guide", sam(0x4f)],
        ["Info", sam(0x1f)],
        ["Channel List", sam(0x6c)],
        ["Tools", sam(0x4b)],
        ["1", sam(0x04)],
        ["2", sam(0x05)],
        ["3", sam(0x06)],
        ["4", sam(0x08)],
        ["5", sam(0x09)],
        ["6", sam(0x0a)],
        ["7", sam(0x0c)],
        ["8", sam(0x0d)],
        ["9", sam(0x0e)],
        ["0", sam(0x11)],
      ],
    },
    // Xbox and generic NEC devices are the same protocol (NEC). Codes are device-specific and not
    // yet verified here, so these start empty -- use the row's hex field to enter a NEC code. Once a
    // code is confirmed on hardware, add it here as [label, 0xXXXXXXXX].
    { id: "nec-generic", label: "NEC (custom code)", proto: PROTO.NEC, custom: true, buttons: [] },
  ];

  var PROTO_NAME = {};
  PROTO_NAME[PROTO.NEC] = "NEC";
  PROTO_NAME[PROTO.SAMSUNG] = "Samsung";

  // Target usage string for a protocol, e.g. protoTarget(2) -> "0xfffb0002".
  function protoTarget(proto) {
    return "0xfffb" + ("000" + (proto & 0xffff).toString(16)).slice(-4);
  }

  // The protocol id in a target usage, or 0 if not an IR target.
  function targetProto(usage) {
    var u = typeof usage === "string" ? parseInt(usage, 16) : usage >>> 0;
    if ((u >>> 16) !== PAGE) return 0;
    return u & 0xff;
  }

  // Is this usage an IR *send* target (an IR page target that isn't the set-pin pseudo-mapping)?
  function isIrTarget(usage) {
    var p = targetProto(usage);
    return p !== 0 && p !== 0xff;
  }

  // Friendly name for an (protocol, code) pair: a matched button label, else "NEC 0x…".
  function codeName(proto, code) {
    var c = code >>> 0;
    for (var i = 0; i < DEVICES.length; i++) {
      if (DEVICES[i].proto !== proto) continue;
      for (var j = 0; j < DEVICES[i].buttons.length; j++) {
        if ((DEVICES[i].buttons[j][1] >>> 0) === c) return DEVICES[i].buttons[j][0];
      }
    }
    return (PROTO_NAME[proto] || "IR") + " 0x" + ("0000000" + c.toString(16)).slice(-8).toUpperCase();
  }

  var API = {
    PROTO: PROTO,
    PAGE: PAGE,
    PIN_USAGE: PIN_USAGE,
    DEVICES: DEVICES,
    PROTO_NAME: PROTO_NAME,
    protoTarget: protoTarget,
    targetProto: targetProto,
    isIrTarget: isIrTarget,
    codeName: codeName,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API; // Node (tests)
  }
  if (typeof window !== "undefined") {
    window.HRX_IR = API; // browser
  }
})();
