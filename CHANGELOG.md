# Changelog

## RP2040-Zero onboard RGB LED — r2026-07-06

- New opt-in `RGB_LED_GRB` CMake option: onboard WS2812 (GP16) support for the **RP2040-Zero**, whose LED is standard **GRB** byte order (the RP2350-Zero is RGB). The 16 web-tool color presets are identical across boards; only the firmware's wire byte order differs, so a preset shows the same color on every board.
- New files:
  - `remapper_rp2040_zero_led.uf2` — single-board RP2040-Zero + onboard LED.
  - `remapper_rp2040_zero_dual_a_led.uf2` — dual **Side A** with the onboard LED. Side A runs the mapping engine, so its LED reacts to your mappings exactly like the single board; Side B has no LED. The RP2040-Zero dual now ships as this LED build (the plain `remapper_rp2040_zero_dual_a.uf2` is still published).
- Web-tool download buttons and `RP2040-ZERO.md` updated; new **`CODEMAP.md`** (agent/developer subsystem→file index) linked from `CLAUDE.md`.
- Stock builds and `remapper_pico2_led.uf2` stay byte-identical — both `RGB_LED_ENABLED` and `RGB_LED_GRB` default OFF.

## RP2040-Zero dual build — r2026-07-04

- New opt-in `ZERO_DUAL_SERIAL` CMake option: two-board (dual) firmware for the RP2040-Zero with the inter-board UART on the edge-accessible UART1 pins **GP8/GP9/GP10/GP11** (instead of the underside GP20/GP21 pads).
- New files: `remapper_rp2040_zero_dual_a.uf2` (device side → PC) and `remapper_rp2040_zero_dual_b.uf2` (host side → devices via USB-C OTG).
- Web-tool download buttons, README + `HARDWARE.md` wiring, a two-board wiring diagram, and the full **`RP2040-ZERO.md`** reference.
- Added repo **`CLAUDE.md`** (agent/developer guide).
- Stock `remapper_dual_a/b.uf2` and all other builds are unchanged — the option defaults OFF.

## Onboard RGB LED — r2026-06-26

- New opt-in `RGB_LED_ENABLED` CMake option: drives the RP2350-Zero onboard WS2812 (GP16) as a mappable color target — 16 presets, color encoded as RGB565 on usage page `0xFFFA`, no `CONFIG_VERSION` change. New file: `remapper_pico2_led.uf2`.

## VX — Visual Enhanced - v1.0 (2026-05-05)

### Config Tool Web UI
- Dark theme with custom CSS variables (`--bg-primary`, `--accent`, etc.)
- Categorized Android TV usages in source/target modals (Power, Navigation, Media, Volume, Apps, System)
- Quick Actions tab with one-click mappings:
  - Remap Voice Control (Google Assistant to custom key)
  - Macro combos (Home+Back, double-tap Home, etc.)
  - Layer Switcher: interactive layer toggle/cycle creation
- Layer Switcher feature:
  - Checkbox UI to select layers (0-3)
  - 2 layers: creates Sticky toggle mapping
  - 3+ layers: creates non-Sticky cycle (each layer points to next)
  - Opens source modal to pick trigger key, auto-creates mappings
- Drag-and-drop reorder mode for mappings (toggle button, grip handles)
- Improved Sticky/Tap/Hold help text:
  - Sticky labeled as "Layer targets only"
  - Tap & Hold labeled as "work with any mapping"
  - Column header tooltips with clear descriptions
- Layer help section with step-by-step example
- Added Layer 0 to target usages for cycle mappings

### Firmware
- Custom HID descriptor (`our_descriptor.cc`) with Android TV Consumer Control outputs

### Deployment
- Root `index.html` redirects to `config-tool-web/` for GitHub Pages
