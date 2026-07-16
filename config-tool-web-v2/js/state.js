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
    irCode: opts.irCode != null ? opts.irCode : null,  // raw 32-bit code, only for IR-page targets
  };
}

// The app boots EMPTY. There is no demo/sample config anywhere: every mapping, macro,
// expression and quirk you see has come either from the connected device (Open device /
// Load) or from a config file you imported. Showing invented data would be a lie, and —
// because saveToDevice() clears and rewrites everything — a dangerous one.
const APP = {
  connection: "disconnected", // disconnected | connecting | connected
  device: {
    name: "",
    vidpid: "—",
    firmware: "—",
    profile: "—",
  },
  activeTab: "mappings",
  config: { title: "" },
  groupDisabled: false,
  sortKey: null,   // 'input' | 'output' | 'layers' — set by clicking a column header
  sortDir: 1,      // 1 = A→Z, -1 = Z→A
  exprActive: 0, // which of the 8 expression slots is selected
  expressions: ["", "", "", "", "", "", "", ""],
  macros: Array.from({ length: 32 }, () => []),
  quirks: [],
  // Defaults below are the FIRMWARE's own (firmware/src/globals.cc) — a fresh device
  // behaves exactly like this. Do not "tidy" them; they are load-bearing.
  settings: {
    emulatedDevice: 0,       // our_descriptor_number
    tapHold: 200,            // ms (tap_hold_threshold = 200000 µs)
    scrollTimeout: 1000,     // ms (partial_scroll_timeout = 1000000 µs)
    interval: 0,             // interval_override: 0 = no override
    gpioDebounce: 5,         // ms
    macroEntryDuration: 1,   // ms
    passthrough: [true, true, true, true, true, true, true, true], // 0b11111111 — all 8 layers
    normalizeGamepad: true,
    gpioOutputMode: 0,       // 0 = push-pull, 1 = open-drain
    ignoreAuthDevInputs: false,
    irOutputPin: 15,         // IR LED GPIO (only persisted when the config uses IR)
  },
  mappings: [],
};

window.HRX_STATE = { APP, ROW_TINTS, tintById, mk, uid, PROFILES, NLAYERS, normLayers };
