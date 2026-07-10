/* ============================================================
   HID Remapper VX — App State
   ============================================================ */

// Row tint palette — used to GROUP/ORGANIZE mappings by category.
// null = no tint. Each has a soft fill + a saturated edge.
const ROW_TINTS = [
  { id: null, name: "None", edge: "transparent", fill: "transparent" },
  { id: "nav", name: "Navigation", edge: "#7c5cff", fill: "rgba(124,92,255,0.10)" },
  { id: "media", name: "Media", edge: "#f06292", fill: "rgba(240,98,146,0.10)" },
  { id: "volume", name: "Volume", edge: "#4dd0e1", fill: "rgba(77,208,225,0.10)" },
  { id: "system", name: "System", edge: "#ffb74d", fill: "rgba(255,183,77,0.10)" },
  { id: "macro", name: "Macros", edge: "#81c784", fill: "rgba(129,199,132,0.10)" },
];
function tintById(id) {
  return ROW_TINTS.find((t) => t.id === id) || ROW_TINTS[0];
}

let UID = 100;
function uid() {
  return ++UID;
}

// The firmware has 8 layers. Normalize any layer spec to a length-8 bool array
// (default: layer 0 active). The Mappings UI renders one chip per entry, so this
// is what drives the 8 layer chips.
const NLAYERS = 8;
function normLayers(a) {
  const out = new Array(NLAYERS).fill(false);
  if (Array.isArray(a)) { for (let i = 0; i < NLAYERS; i++) out[i] = !!a[i]; }
  else out[0] = true;
  return out;
}

// Emulated-output profiles, indexed by our_descriptor_number (config.cc / usages.js order).
const PROFILES = [
  "Mouse + Keyboard", "Absolute Mouse + Keyboard", "Nintendo Switch",
  "PS4 arcade stick", "Google Stadia", "XAC / Flex",
  "Corsair K55 RGB", "Logitech G213", "Xbox controller",
];

// A mapping: { id, inputs:[code,…], output, layers:[bool×8], sticky, tap, hold, scale, tint }
function mk(inputs, output, opts = {}) {
  return {
    id: uid(),
    inputs: Array.isArray(inputs) ? inputs.slice() : [inputs],
    output,
    enabled: opts.enabled !== false,
    layers: normLayers(opts.layers),
    sticky: !!opts.sticky,
    tap: !!opts.tap,
    hold: !!opts.hold,
    scale: opts.scale != null ? opts.scale : 1.0,
    tint: opts.tint || null,
  };
}

const APP = {
  connection: "disconnected", // disconnected | connecting | connected
  device: {
    name: "HID Remapper VX",
    vidpid: "CAFE:BABE",
    firmware: "v15.2.0",
    profile: "Android TV",
  },
  activeTab: "mappings",
  config: { title: "Living Room — Android TV" },
  comboLayout: "wire", // wire | inline | stacked
  groupByInput: false,
  groupDisabled: false,
  exprActive: 0, // which of the 8 expression slots is selected
  expressions: [
    "0x00010030 input_state -128 add 0.05 mul", // re-center Left Stick X + scale to cursor speed
    "0x00010033 input_state -100 100 clamp",     // clamp Right Stick X to ±100
    "0x00010030 input_state -128 add dup abs 10 gt mul 0.025 mul", // dead-zone (stack trick)
    "", "", "", "", "",
  ],
  settings: {
    emulatedDevice: 0, // our_descriptor_number (index into PROFILES)
    tapHold: 200,
    comboWindow: 50,
    scrollTimeout: 100,
    interval: 1,
    passthrough: [true, false, false, false, false, false, false, false], // 8 layers
  },
  mappings: [
    mk("0x00070052", "0x00070052"), // Cursor Up -> Arrow Up
    mk("0x00070051", "0x00070051"),
    mk("0x00070050", "0x00070050"),
    mk("0x0007004f", "0x0007004f"),
    mk("0x000c0041", "0x00070028"), // Menu Select -> Return
    mk("0x000c00e9", "0x000c00e9"), // Volume Up
    mk("0x000c00ea", "0x000c00ea"), // Volume Down
    // Showcase combo: Volume Up + Volume Down -> Mute
    mk(["0x000c00e9", "0x000c00ea"], "0x000c00e2"),
    mk("0x000c0224", "0x00070029", { enabled: false }), // AC Back -> Escape (disabled demo)
    mk("0x000c00cd", "0x000c00cd", { tap: true }), // Play/Pause
    // RGB LED per-layer status light: nothing -> LED color, one per layer
    mk("0x00000000", "0xfffa0006", { layers: [true, false, false, false] }), // Layer 0 -> LED Green
    mk("0x00000000", "0xfffa000a", { layers: [false, true, false, false] }), // Layer 1 -> LED Blue
  ],
};

window.HRX_STATE = { APP, ROW_TINTS, tintById, mk, uid, PROFILES, NLAYERS, normLayers };
