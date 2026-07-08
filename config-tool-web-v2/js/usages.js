/* ============================================================
   HID Remapper VX — Usage Catalog
   A "usage" is a single HID input/output (key, button, axis…).
   Each has: code (hex string), name, and lives in a category.
   ============================================================ */

const USAGE_CATEGORIES = [
  {
    id: "remote",
    label: "Android TV Remote",
    accent: "#7c5cff",
    usages: [
      ["0x000c0041", "Menu Select"],
      ["0x000c0042", "Menu Back"],
      ["0x000c0223", "AC Home"],
      ["0x000c0224", "AC Back"],
      ["0x000c0225", "AC Forward"],
      ["0x000c00cd", "Play / Pause"],
      ["0x000c00b7", "Stop"],
      ["0x000c00b5", "Scan Next"],
      ["0x000c00b6", "Scan Prev"],
      ["0x00070052", "Cursor Up"],
      ["0x00070051", "Cursor Down"],
      ["0x00070050", "Cursor Left"],
      ["0x0007004f", "Cursor Right"],
      ["0x000c00e9", "Volume Up"],
      ["0x000c00ea", "Volume Down"],
      ["0x000c00e2", "Mute"],
      ["0x000c009c", "Channel Up"],
      ["0x000c009d", "Channel Down"],
      ["0x000c0221", "AC Search"],
      ["0x000c0095", "Help"],
    ],
  },
  {
    id: "keyboard",
    label: "Keyboard",
    accent: "#4db6ac",
    usages: (() => {
      const out = [];
      // Letters
      for (let i = 0; i < 26; i++) {
        out.push(["0x000700" + (0x04 + i).toString(16).padStart(2, "0"), String.fromCharCode(65 + i)]);
      }
      // Top row numbers
      const nums = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
      nums.forEach((n, i) => out.push(["0x000700" + (0x1e + i).toString(16).padStart(2, "0"), n]));
      // Named keys
      const named = [
        ["0x00070028", "Return (Enter)"],
        ["0x00070029", "Escape"],
        ["0x0007002a", "Backspace"],
        ["0x0007002b", "Tab"],
        ["0x0007002c", "Space"],
        ["0x00070052", "Arrow Up"],
        ["0x00070051", "Arrow Down"],
        ["0x00070050", "Arrow Left"],
        ["0x0007004f", "Arrow Right"],
        ["0x0007004a", "Home"],
        ["0x0007004d", "End"],
        ["0x0007004b", "Page Up"],
        ["0x0007004e", "Page Down"],
        ["0x0007004c", "Delete"],
        ["0x00070049", "Insert"],
        ["0x000700e0", "Left Ctrl"],
        ["0x000700e1", "Left Shift"],
        ["0x000700e2", "Left Alt"],
        ["0x000700e3", "Left GUI"],
        ["0x000700e4", "Right Ctrl"],
        ["0x000700e6", "Right Alt"],
      ];
      for (let i = 1; i <= 12; i++) out.push(["0x000700" + (0x3a + i - 1).toString(16).padStart(2, "0"), "F" + i]);
      return out.concat(named);
    })(),
  },
  {
    id: "mouse",
    label: "Mouse",
    accent: "#4dd0e1",
    usages: [
      ["0x00010030", "Cursor X"],
      ["0x00010031", "Cursor Y"],
      ["0x00010038", "Wheel"],
      ["0x000c0238", "AC Pan (H-Wheel)"],
      ["0x00090001", "Button 1 (Left)"],
      ["0x00090002", "Button 2 (Right)"],
      ["0x00090003", "Button 3 (Middle)"],
      ["0x00090004", "Button 4 (Back)"],
      ["0x00090005", "Button 5 (Fwd)"],
    ],
  },
  {
    id: "gamepad",
    label: "Gamepad",
    accent: "#ffb74d",
    usages: [
      ["0x00050037", "Button South (A)"],
      ["0x00050038", "Button East (B)"],
      ["0x00050039", "Button West (X)"],
      ["0x0005003a", "Button North (Y)"],
      ["0x00010090", "Hat Up"],
      ["0x00010091", "Hat Down"],
      ["0x00010092", "Hat Left"],
      ["0x00010093", "Hat Right"],
      ["0x00050001", "L1 (Bumper)"],
      ["0x00050002", "R1 (Bumper)"],
      ["0x00050003", "L2 (Trigger)"],
      ["0x00050004", "R2 (Trigger)"],
      ["0x00010030", "Left Stick X"],
      ["0x00010031", "Left Stick Y"],
    ],
  },
  {
    id: "media",
    label: "Media",
    accent: "#f06292",
    usages: [
      ["0x000c00b0", "Play"],
      ["0x000c00b1", "Pause"],
      ["0x000c00b3", "Fast Forward"],
      ["0x000c00b4", "Rewind"],
      ["0x000c0183", "Media Select"],
      ["0x000c0192", "Calculator"],
      ["0x000c018a", "Email"],
      ["0x000c0196", "Browser"],
    ],
  },
  {
    id: "layers",
    label: "Layers",
    accent: "#9575cd",
    usages: [
      ["0xffff0000", "Layer 0"],
      ["0xffff0001", "Layer 1"],
      ["0xffff0002", "Layer 2"],
      ["0xffff0003", "Layer 3"],
      ["0xfffe0000", "Toggle Layer 1"],
      ["0xfffe0001", "Toggle Layer 2"],
    ],
  },
  {
    id: "macros",
    label: "Macros",
    accent: "#4fc3f7",
    usages: [
      ["0xfff10000", "Macro 0"],
      ["0xfff10001", "Macro 1"],
      ["0xfff10002", "Macro 2"],
      ["0xfff10003", "Macro 3"],
    ],
  },
  {
    id: "gpio",
    label: "GPIO Pins",
    accent: "#81c784",
    usages: [
      ["0xfff20000", "GPIO 0"],
      ["0xfff20001", "GPIO 1"],
      ["0xfff20002", "GPIO 2"],
      ["0xfff20003", "GPIO 3"],
    ],
  },
  {
    id: "rgbled",
    label: "RGB LED",
    accent: "#ffb74d",
    led: true, // rendered as color swatches, not text pills
    usages: [
      ["0xfffa0000", "Off"],
      ["0xfffa0001", "Red"],
      ["0xfffa0002", "Orange"],
      ["0xfffa0003", "Amber"],
      ["0xfffa0004", "Yellow"],
      ["0xfffa0005", "Lime"],
      ["0xfffa0006", "Green"],
      ["0xfffa0007", "Mint"],
      ["0xfffa0008", "Cyan"],
      ["0xfffa0009", "Sky"],
      ["0xfffa000a", "Blue"],
      ["0xfffa000b", "Indigo"],
      ["0xfffa000c", "Purple"],
      ["0xfffa000d", "Magenta"],
      ["0xfffa000e", "Pink"],
      ["0xfffa000f", "White"],
    ],
  },
  {
    id: "other",
    label: "Other",
    accent: "#a1a8c3",
    usages: [
      ["0x00000000", "No Output"],
      ["0xfff00000", "Register 0"],
      ["0xfff00001", "Register 1"],
      ["0xfff30000", "Analog In"],
    ],
  },
];

// RGB LED output — real hardware colors on HID page 0xFFFA (low 16 bits = color).
// hex = the actual color shown by the onboard WS2812 LED; "Off" = no light (null).
const LED_HEX = {
  "0xfffa0000": null,       // Off
  "0xfffa0001": "#ff3b30", // Red
  "0xfffa0002": "#ff8c1a", // Orange
  "0xfffa0003": "#ffb300", // Amber
  "0xfffa0004": "#ffe11a", // Yellow
  "0xfffa0005": "#a3e635", // Lime
  "0xfffa0006": "#22c55e", // Green
  "0xfffa0007": "#3ee6a0", // Mint
  "0xfffa0008": "#22d3ee", // Cyan
  "0xfffa0009": "#38bdf8", // Sky
  "0xfffa000a": "#3b82f6", // Blue
  "0xfffa000b": "#6366f1", // Indigo
  "0xfffa000c": "#a855f7", // Purple
  "0xfffa000d": "#e935d6", // Magenta
  "0xfffa000e": "#ff5fa2", // Pink
  "0xfffa000f": "#ffffff", // White
};
function isLed(code) { return !!code && code.indexOf("0xfffa") === 0; }
function ledColor(code) { return LED_HEX[code] || null; }

// Flat lookup: code -> { name, categoryId, accent }
const USAGE_BY_CODE = (() => {
  const map = {};
  USAGE_CATEGORIES.forEach((cat) => {
    cat.usages.forEach(([code, name]) => {
      if (!map[code]) map[code] = { name, categoryId: cat.id, accent: cat.accent, label: cat.label };
    });
  });
  return map;
})();

function usageName(code) {
  if (!code || code === "0x00000000") return "Unmapped";
  return (USAGE_BY_CODE[code] && USAGE_BY_CODE[code].name) || code;
}
function usageAccent(code) {
  if (isLed(code)) return ledColor(code) || "#8a90b0";
  return (USAGE_BY_CODE[code] && USAGE_BY_CODE[code].accent) || "#a1a8c3";
}
function usageCategoryLabel(code) {
  return (USAGE_BY_CODE[code] && USAGE_BY_CODE[code].label) || "Custom";
}

window.HRX_USAGES = { USAGE_CATEGORIES, USAGE_BY_CODE, usageName, usageAccent, usageCategoryLabel, isLed, ledColor, LED_HEX };
