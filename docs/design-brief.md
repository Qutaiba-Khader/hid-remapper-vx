> **NOTE (2026-07-13): combos were REMOVED from this project.** Any combo content below is
> historical — the feature no longer exists in the firmware, the web tool or any release.

# HID Remapper VX — Web Config Tool Redesign Brief

## ⚑ How to use this brief (read first)

A first design already exists (see it here: **https://claude.ai/design/p/c3d7878f-276c-4a39-817e-23e7aa93a1c6?file=index.html** ). **This document is the source of truth — build ON that design, don't start over.** It already got a lot right; the goal now is to *keep the good parts, add what's missing, and fix a few things.*

> **⚠️ IMPORTANT: The owner LIKES the current UI. Do NOT redesign it, restyle it wholesale, change the amber theme, remove features, or rebuild from scratch. KEEP the existing design as-is and only FILL THE GAPS (add RGB LED output, the firmware download grid, and a mobile layout) plus light consistency polish across the other tabs. When in doubt — keep it.**

**KEEP (the existing design nailed these):**
- The overall dark layout, the top bar (`Load from device` / `Save to device` / `Disconnect`), and the connection state (green "Connected" pill).
- The **device/config name** as a big editable title (e.g. "Living Room — Android TV") + the info bar (device name, VID:PID, firmware, output profile).
- The **combo system** — the input "forks" into separate behavior paths, with the **Combo Layout** switch (**Wire / Inline / Stacked**) and the `2 WAYS · 1 COMBO` style summary. This is excellent — keep it.
- The **per-mapping disable toggle** (power icon in the row's edit cluster).
- The tab set and the row anatomy (input → output, layers 0–3, Sticky/Tap/Hold, scale, color, edit icons).

**ADD (missing from the current design):**
- **RGB LED color output** — a real shipped feature, not yet in the design. See its section below. **This is the #1 thing to add.**
- **Firmware download grid** for the many board/single-dual/LED builds (Actions tab).
- **Mobile / narrow layout** (see Design Rules).

**FIX / DECIDE:**
- **Accent color** — the current design uses **amber/orange**; the original brief said purple. **Keep the amber/orange** (it looks good) unless the owner says otherwise. Either way the hard rule holds: dark theme, high contrast, **never grey body text**.
- **Combos compatibility note** — combos are fine to keep in the design; see the corrected "Combos" section for how they stay compatible (they do NOT force a config-format break).

**DELIVERABLE — please include the actual code.** Export the **full front-end code** in the design files: the complete `index.html` + all **CSS** + **JS**, working and copy-pasteable, built as **vanilla JS + Bootstrap 5.1.3** (single HTML / JS / CSS, no build step, no React/Vue). The code gets integrated into the real `config-tool-web/` by hand, so working code is far more useful than a picture-only mockup. Keep the existing markup/class structure where you can so it drops in cleanly.

---

## What is this?

A browser-based configuration tool for a USB HID key-remapping device (Raspberry Pi Pico / Pico W / RP2040-Zero / RP2350-Zero). The user plugs the device in via USB, opens this page in Chrome, and configures key remappings, macros, layers, and device settings — no software install. It talks to the device over **WebHID (Chrome/Edge only)**. Config is stored **on the device**; it can also be exported/imported as JSON.

**Primary use case:** remapping USB remote controls, keyboards, and gamepads for **Android TV / Google TV**.

---

## Screen-by-screen spec

### Top bar
- **Brand**: gear icon + "HID Remapper VX" / "WEB CONFIG".
- **Actions**: `Load from device` (read config), `Save to device` (write config, primary/accent), `Disconnect` (or `Open device` when not connected).
- **Connection state**: a clear pill — green "● Connected" when a device is attached, a muted "Disconnected" otherwise.

### Configuration header
- A large **editable config/device name** (e.g. "Living Room — Android TV").
- **Info bar**: DEVICE NAME · VID:PID · FIRMWARE version · OUTPUT PROFILE (active emulated device).

### Tabs (7)
`Mappings` · `Quick Start` (a.k.a. Quick Actions) · `Monitor` · `Settings` · `Macros` · `Expressions` · `Actions`.
The current design's order (Mappings, Quick Start, Monitor, Settings, Macros, Expressions, Actions) is good — keep it. Expressions is a power feature — **do not redesign it.**

### Mappings tab (default — ~90% of usage)
A list of mapping rows. Each row maps one (or, for a combo, several) **input** key(s)/button(s) to one **output**. Row anatomy:
- Drag handle (reorder) · **Input button** (opens the usage picker) — colored left border.
- **Behavior fork** — the "+" node that turns the input into a combo (adds another input to the same behavior). Keep the Wire / Inline / Stacked layout toggle.
- `→` **Output button** (opens the usage picker).
- **Layers** `0 1 2 3` (which of the 8 layers this mapping is active on — 0–3 shown as chips; support all 8).
- **Modes** `Sticky · Tap · Hold`.
- **Scale** (numeric, e.g. `1.00`).
- **Color** — a per-row color dot (tints the *row background in the UI only*; cosmetic — see the RGB-LED note about not confusing this with the physical LED).
- **Edit cluster** — disable toggle (power icon), drag, clone, delete. All always visible (never hidden behind hover).

Rows: readable striping, drag-and-drop reorder. Below the list: `Add mapping` and `Group by Input` (groups rows that share a source).

### Usage picker modal (input & output)
A large modal opened by clicking an input or output button:
- Header + close; **Port** selector; **Input labels** preset; **Search** box + **Custom `0x____`** hex entry.
- Categorized pills: **Android TV Remote, Keyboard, Mouse, Gamepad, Media, Layers, Macros, GPIO Pins, Registers, Analog, RGB LED, Other.** The active usage is highlighted. Clicking selects + closes.
- **RGB LED** category is special — render it as color swatches, not text (see RGB LED section).

### Settings tab
Emulated device type (9 options: Mouse+Keyboard, Absolute Mouse, Switch Gamepad, PS4, Stadia, XAC, Corsair K55, Logitech G213, Xbox), Tap-hold threshold (ms), Partial-scroll timeout, Unmapped passthrough (per layer), Interval override, GPIO config, and the **Combo timing window** (ms, default 50).

### Macros tab
32 macro slots as a collapsed accordion; each header previews its steps; expand to edit step rows (usage picker + duration); clone per macro.

### Expressions tab — **KEEP AS-IS, do not redesign.**
8 RPN expression slots (textareas + snippet dropdown + copy/paste/edit). Advanced feature; leave it.

### Actions tab
Export/Import JSON · Flash firmware (bootloader) · Flash B-side · Pair/Forget device (BT models) · **Firmware download grid** (see below).

### Monitor tab
Live table of HID input activity (usage code, name, last value, min, max), real-time; a `+` per row to create a mapping from a detected usage; `Clear`.

### Quick Start / Quick Actions tab
1. **Preset fixes** (one-click: "Fix OK Button", "Remap Voice Control", …).
2. **Shortcut grids** by category (Android TV, Browser, Windows).
3. **Example configs** as color-coded cards (Keyboard, Mouse & Scroll, Macros & Tap-Hold, Windows Shortcuts) — each "+ Add" injects mappings.

---

## FEATURE (keep + refine): Combos

### What combos are
Press two (or more) inputs together within a timing window → emit a *different* output; the individual inputs are suppressed while the combo fires. Example: **Volume Up + Volume Down → Mute.**

### The design already has this — keep it
The existing **Wire / Inline / Stacked** layouts and the input-fork visual (an input branching into its "alone" behavior and its "in a combo" behavior, with a `2 WAYS · 1 COMBO` summary) are the right idea. Keep and polish. Rules:
- Click **+** to add another input to a behavior (make it a combo); **×** to remove a combo input.
- **2–4 inputs** per combo; no duplicate keys.
- Each input opens the same usage picker.
- Global **Combo timing window** in Settings (default 50 ms).

### Compatibility (important — corrected)
Combos are **not yet in firmware**, but they do **not** force a config-format break:
- Save combos as an **additive JSON field** (e.g. a `combos[]` array). Older importers and the upstream jfedor2 tool **ignore unknown fields**, so `CONFIG_VERSION` stays **18** and files remain cross-compatible.
- The device gets combos via a **new, optional command**; the web tool **feature-detects** support on connect. **On a device running old firmware, the combo UI is simply hidden/disabled and combos aren't applied** — everything else still works. New firmware → combos work.
So the combos UI can ship in the tool now and light up once firmware supports it; design it as a first-class feature.

---

## FEATURE (ADD — currently missing): RGB LED color output

Some boards (RP2040-Zero / RP2350-Zero) have an **onboard WS2812 RGB LED**. The tool drives it as a **mappable color output**: map an input — or `nothing` (always-on) / a layer — to a **color**, and the onboard LED shows it. Mainly a **status light** (a color per active layer). This is **already shipped in firmware + the tool**, but presented as plain text — it needs real visual design and isn't in the current mockup.

### How it works
- The **output** usage picker has an **"RGB LED"** category with **16 presets**:
  **LED Off, Red, Orange, Amber, Yellow, Lime, Green, Mint, Cyan, Sky, Blue, Indigo, Purple, Magenta, Pink, White.**
- You pick one as a mapping's **target**, like any output. Common patterns:
  - **Always-on** — `nothing → LED Green` = LED green whenever powered.
  - **Per-layer status** — one `nothing → LED <color>` per layer, each ticked to a different layer → the color tells you the active layer (last-activated wins; `LED Off` = off).
- Each color is one output usage on page `0xFFFA` (low 16 bits = the color). No extra control — behaves like a normal target.

### A row using it reads
```
[⋮] ● nothing        →  ● 🟩 LED Green      LAYERS 0 [1] 2 3   Sticky Tap Hold   1.00  ●  ⏻ ⧉ ×
```

### What to design
1. **Color swatch grid** in the output picker's "RGB LED" category — 16 real color squares (not text pills); `LED Off` = an outlined/empty swatch; selected swatch clearly ringed.
2. **Row display** — when the output is an LED color, show the actual **color swatch + name** in the output button.
3. **Don't confuse it with the per-row color dot** — that dot only tints the *row background in the UI* (cosmetic). This is a real hardware output. Label/tooltip them distinctly.

---

## FEATURE (keep — already in the design): Device name & Disable toggle
Both are already present and correct; documenting them as requirements:
- **Config/Device name** — the big editable title, saved as top-level `device_name` in the exported JSON. Web-only (not written to device flash; it lives in the JSON/session).
- **Disable per mapping** — the row power toggle sets a `mapping.enabled` flag. Disabled rows read as clearly "off" (e.g. dimmed + an "off" state) but stay visible and editable, and are **skipped when saving to the device**. Web-only (the disabled state lives in the JSON/session, not on the device).
Both are safe: additive JSON only, `CONFIG_VERSION` stays 18.

---

## FEATURE (ADD): Firmware download grid (Actions tab)
The device now ships in several forms. The download list should be a clean, scannable grid — **grouped by board**, with the variants as options, not a flat wall of buttons:
- **Boards:** Pico / Pico W, Pico 2 / Pico 2 W, RP2040-Zero, RP2350-Zero (+ custom boards).
- **Per board, the variants that exist:** **single** vs **dual** (two-board build), and **RGB-LED** builds.
- Recently changed to "one device per row" — build on that; make the single/dual/LED variants feel like clear sub-options per board.

---

## Color scheme (current design direction: amber on dark)

The current design uses a **warm amber/orange accent on a near-black/dark-navy base** — keep that. Approximate palette (Claude Design may keep its own exact values as long as contrast stays high):
```
Background (page):    very dark navy / near-black  (≈ #0F1320)
Background (cards):   slightly lifted dark          (≈ #161B2B)
Background (hover):   a touch lighter               (≈ #1E2540)
Accent (primary):     amber / orange                (≈ #E8963A)  ← Save to device, active tab, layer-0 chip
Accent (hover):       brighter amber                (≈ #F2A94E)
Connected indicator:  green                         (≈ #3FB877)
Text (primary):       near-white  (#E6E9F2)  — NEVER grey for readable text
Text (muted):         only for tiny labels, never body text
Borders:              subtle dark  (≈ #262C40)
Error / delete:       red  (#F85149 on #2D1117)
```
> Earlier brief said purple (`#4a00e0`); the design intentionally moved to amber — **prefer amber** unless told otherwise.

**CRITICAL rule (non-negotiable):** all readable text is white/near-white. **Never grey body text on dark backgrounds.**

---

## Design rules
1. Every button has a visible border + background — never invisible/transparent.
2. **Dark theme only**, high contrast. No light mode.
3. **Amber/orange** is the primary accent for action buttons/active states (was purple).
4. Compact layout — users may have **30+ rows**; density matters.
5. Readable row striping; drag-and-drop reorder must keep working.
6. Per-row color-tint dot stays (cosmetic UI tint — distinct from the RGB-LED output).
7. Clone / delete / disable always visible (not behind hover or a menu).
8. Keyboard/focus states visible (10-foot / accessibility friendly where reasonable).

---

## What I still need designed (priority order)
1. **RGB LED color output** — the swatch-grid picker + how an LED-color output shows in a row (see its section). **Top priority — it's missing.**
2. **Firmware download grid** — the grouped multi-board / single-dual / LED layout (Actions tab).
3. **Mobile / narrow layout** — the tool is currently ~920px min-width; make it usable on a phone. Which tabs matter most small? (Mappings, Quick Start.)
4. **Usage picker polish** — faster key finding (search, categories, recents), and the RGB-LED swatch category.
5. **Overall polish pass** — consistent spacing/typography on the amber-on-dark system, applied across *all* tabs (Settings/Macros/Actions/Monitor/Quick Start), not just Mappings.
6. **Empty / disconnected / error states** — what the page looks like before a device is connected.

*(Already handled by the existing design — no need to redo: combos UI, device name, disable toggle, connection pill, row anatomy.)*

---

## Constraints (hard)
- **Vanilla JS + Bootstrap 5.1.3** — no React/Vue/build step. Single HTML + JS + CSS.
- **Chrome/Edge only** (WebHID).
- Config lives **on the device** (JSON export/import is a file feature).
- **Expressions tab: do not redesign.**
- **`CONFIG_VERSION` must stay `18`.** Any new saved data must be **additive JSON keys** an older importer safely ignores (keeps cross-compatibility with the upstream jfedor2 tool). Device binary protocol untouched. (Combos, device name, disable — all additive.)
- Hard limits without new firmware: **8 layers, 32 macros, 8 expressions**.
- **Feature-gate firmware-dependent UI** (currently: combos, RGB LED on boards that lack the LED) by detecting device capability on connect — hide/disable rather than break when a device's firmware doesn't support it.

---

## Assets that would sharpen the result (optional but valuable)
- **Screenshots of the current live tool** (each tab + the usage picker + a real 30-row mapping list) — pins down the true current look beyond these specs.
- Confirmation on the **amber vs purple** accent and whether **mobile** is a hard requirement or nice-to-have.
