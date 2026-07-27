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
      note: "cross-referenced from published captures — a few are model-specific",
      // 58 buttons. Every code is derived from a published E0E0-format capture by reversing
      // the bit order of the command byte, and each one was checked two ways: the address must be
      // E0E0 and byte 4 must be the exact bitwise inverse of byte 3 (that check rejected one
      // corrupt entry, 0xE0E040FB, in the upstream database). Sources are cross-referenced --
      // Tasmota, the ESPIR-DB Samsung set, and Pronto captures from Just Add Power; HDMI 1-4 and
      // the discrete power codes agree across all of them. Four were confirmed independently
      // against real hardware: Power, Volume +, digit 1, OK.
      buttons: [
        ["Power", sam(0x02)],
        ["Power On", sam(0x99)],
        ["Power Off", sam(0x98)],
        ["Source / Input", sam(0x01)],
        ["HDMI 1", sam(0xe9)],
        ["HDMI 2", sam(0xbe)],
        ["HDMI 3", sam(0xc2)],
        ["HDMI 4", sam(0xc5)],
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
        ["Guide", sam(0x4f)],
        ["Info", sam(0x1f)],
        ["Tools", sam(0x4b)],
        ["Smart Hub / Home", sam(0x79)],
        ["Smart Hub (alt)", sam(0x76)],
        ["Play", sam(0x47)],
        ["Pause", sam(0x4a)],
        ["Play / Pause", sam(0xb9)],
        ["Stop", sam(0x46)],
        ["Rewind", sam(0x45)],
        ["Fast forward", sam(0x48)],
        ["Red (A)", sam(0x6c)],
        ["Green (B)", sam(0x14)],
        ["Yellow (C)", sam(0x15)],
        ["Blue (D)", sam(0x16)],
        ["Picture mode", sam(0x28)],
        ["Sleep timer", sam(0x03)],
        ["E-Manual", sam(0x3f)],
        ["Sound mode", sam(0x2b)],
        ["Ambient mode", sam(0xf6)],
        ["Bixby", sam(0x73)],
        ["Netflix", sam(0xf3)],
        ["Prime Video", sam(0xf4)],
        ["Hulu", sam(0xbb)],
        ["Internet browser", sam(0x37)],
        ["Number pad", sam(0x9c)],
        ["Pair Bluetooth remote", sam(0xd1)],
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
    // NEC-family devices. Unlike Samsung there is no formula: NEC is address|command<<16 with a
    // per-brand address, so these are literal 32-bit codes taken from published ESPHome captures
    // (FastEverLast/ESPIR-DB). Each was validated the same way as Samsung -- the command half must
    // be a byte followed by its exact bitwise inverse -- and duplicates were dropped.
    {
      id: "xbox-one",
      label: "Xbox One / Series — Media Remote",
      proto: PROTO.NEC,
      note: "NEC address 0xD880",
      buttons: [
        ["Power", 0xd02fd880],
        ["Home", 0x9b64d880],
        ["Down", 0xe01fd880],
        ["Left", 0xdf20d880],
        ["Right", 0xde21d880],
        ["A", 0x9966d880],
        ["B", 0x9a65d880],
        ["X", 0x9768d880],
        ["Y", 0x9867d880],
        ["Menu", 0x906fd880],
        ["Play / Pause", 0x8f70d880],
        ["Fast forward", 0xeb14d880],
        ["Rewind", 0xea15d880],
        ["Next", 0xe51ad880],
        ["Prev", 0xe41bd880],
        ["Stop", 0xe619d880],
        ["Record", 0xe817d880],
        ["Select", 0xdd22d880],
        ["Back", 0xdc23d880],
        ["OneGuide", 0xd926d880],
        ["Captions", 0xb24dd880],
        ["Xbox Movies", 0x8e71d880],
        ["Xbox TV Shows", 0x8d72d880],
        ["Mute", 0xf10ed880],
        ["Volume +", 0xef10d880],
        ["Volume −", 0xee11d880],
        ["0", 0xff00d880],
        ["1", 0xfe01d880],
        ["2", 0xfd02d880],
        ["3", 0xfc03d880],
        ["4", 0xfb04d880],
        ["5", 0xfa05d880],
        ["6", 0xf906d880],
        ["7", 0xf807d880],
        ["8", 0xf708d880],
        ["9", 0xf609d880],
      ],
    },
    {
      id: "lg-tv",
      label: "LG TV",
      proto: PROTO.NEC,
      note: "NEC address 0xFB04",
      buttons: [
        ["Power", 0xf708fb04],
        ["Input", 0xf40bfb04],
        ["Q.Menu", 0xbc43fb04],
        ["Info", 0x55aafb04],
        ["Help", 0x857afb04],
        ["1", 0xee11fb04],
        ["2", 0xed12fb04],
        ["3", 0xec13fb04],
        ["4", 0xeb14fb04],
        ["5", 0xea15fb04],
        ["6", 0xe916fb04],
        ["7", 0xe817fb04],
        ["8", 0xe718fb04],
        ["9", 0xe619fb04],
        ["0", 0xef10fb04],
        ["Guide", 0x54abfb04],
        ["Q.View", 0xe51afb04],
        ["Fav", 0xe11efb04],
        ["3d", 0x23dcfb04],
        ["Mute", 0xf609fb04],
        ["Volume +", 0xfd02fb04],
        ["Vol Dn", 0xfc03fb04],
        ["Ch Next", 0xff00fb04],
        ["Ch Prev", 0xfe01fb04],
        ["Recent", 0x4ab5fb04],
        ["Home", 0x837cfb04],
        ["My Apps", 0xbd42fb04],
        ["Up", 0xbf40fb04],
        ["Down", 0xbe41fb04],
        ["Left", 0xf807fb04],
        ["Right", 0xf906fb04],
        ["Ok", 0xbb44fb04],
        ["Back", 0xd728fb04],
        ["Live Menu", 0x619efb04],
        ["Exit", 0xa45bfb04],
        ["Red", 0x8d72fb04],
        ["Green", 0x8e71fb04],
        ["Yellow", 0x9c63fb04],
        ["Blue", 0x9e61fb04],
        ["Text", 0xdf20fb04],
        ["T.Opt", 0xde21fb04],
        ["App/*", 0x609ffb04],
        ["Stop", 0x4eb1fb04],
        ["Play", 0x4fb0fb04],
        ["Pause", 0x45bafb04],
        ["Rewind", 0x708ffb04],
        ["Forward", 0x718efb04],
        ["Rec/*", 0x42bdfb04],
        ["Subtitle", 0xc639fb04],
        ["Ad", 0x6e91fb04],
        ["Tv/Rad", 0x0ff0fb04],
      ],
    },
    // Anything else NEC-family (most TVs, STBs, AV receivers, LED strips): use the row's hex
    // field to enter a raw 32-bit code. Sony (SIRC), RC5/RC6 and Panasonic are NOT NEC and cannot
    // be sent by this firmware -- they need a protocol added to ir_output.cc.
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
