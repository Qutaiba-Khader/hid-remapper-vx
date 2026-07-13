# CODEMAP.md — HID Remapper VX firmware & web tool

A subsystem → **file:symbol** index so you can jump straight to the right code instead of re-deriving the layout every session. Pairs with [`CLAUDE.md`](CLAUDE.md) (rules, build/release flow) and [`RP2040-ZERO.md`](RP2040-ZERO.md) (board reference).

**How to use:** find your subsystem below, open the named file, and `grep` the named symbol. Line numbers drift — **anchor on the symbol name, not a line number**, and verify against current code before asserting (same caveat as the memory reminders).

---

## Firmware entry points (one `main` per role)

The firmware is one codebase compiled into several executables. Board/role-specific hooks (`read_report`, `get_gpio_valid_pins_mask`, `extra_init`, out-report queueing) are provided by each entry `.cc`; the shared logic lives in `main.cc` + `remapper.cc`.

| Executable | Entry file | Has own `main()`? | Runs mapping engine? | USB role |
| --- | --- | --- | --- | --- |
| `remapper` (single) | `src/remapper_single.cc` | shares `main.cc::main()` | ✅ yes | device→PC + PIO-USB host (GP0/GP1) |
| `remapper_dual_a` | `src/remapper_dual_a.cc` | shares `main.cc::main()` | ✅ yes (holds config) | device→PC; input arrives over UART from B |
| `remapper_dual_b` | `src/remapper_dual_b.cc` | **own `main()`** | ❌ no — thin capture node | native USB **host**→devices |
| `remapper_serial` | `src/remapper_serial.cc` | shares `main.cc::main()` | ✅ yes | device→PC over external serial |
| `flash_b_side` | `src/flash_b_side.cc` | own | n/a | one-shot: flashes Board B over SWD |

**Key consequence:** anything driven by the mapping engine (GPIO output, **RGB LED**, macros) works on `remapper` / `remapper_dual_a` / `remapper_serial` automatically because they share `main.cc::main()`. It does **not** exist on `remapper_dual_b`.

---

## Subsystem → file : symbol

| Subsystem | File | Symbol(s) |
| --- | --- | --- |
| Shared main loop | `src/main.cc` | `main()` — calls `read_report()` (board hook) → engine → `write_gpio()` → `write_rgb_led()` |
| Mapping engine | `src/remapper.cc` | `set_mapping_from_config()`, `process_mapping()`, `input_state[]`, sticky/tap/hold tables |
| Combo engine (AND gate) | `src/remapper.cc` | `evaluate_combos()`, `combos[]`, `combo_consumed[]`, `MAPPING_FLAG_COMBO_CONSUME`, `NCOMBOS`, all under `#ifdef COMBO_ENABLED` |
| Combo usage page | `src/remapper.h` | `COMBO_USAGE_PAGE 0xFFFB0000` |
| Combos (web) | `config-tool-web-v2/js/translate.js` | `appComboToConfigMappings()`, `isComboUsage()`, `configToApp()` fold |
| Web v2: device I/O | `config-tool-web-v2/js/device.js` | `connect()`, `loadFromDevice()`, `saveToDevice()` (SUSPEND→CLEAR_*→ADD_*→PERSIST→**RESUME in a finally**), `onMonitor()`, `onDisconnect()` |
| Web v2: unit conversions | `config-tool-web-v2/js/translate.js` | `exprToDevice()`/`exprToApp()` (expression constants are **×1000 fixed point**), ms↔µs, `scale`↔`scaling` |
| Web v2: usage picker | `config-tool-web-v2/js/picker.js` | `openPicker({mode,current,onSelect,port,onPort})` — uses `.picker-scrim`, **not** `.modal-scrim` (which expressions.css overrides) |
| Web v2: tests | `config-tool-web-v2/tests/` | `flow.test.js` (whole user journey vs a fake device), `contract.test.js` (reads the firmware source), `no-dummy-data.test.js`, `ui-guards.test.js` |
| Persisted config + commands | `src/config.cc` | `CONFIG_VERSION` (**18**), config get/set command handlers |
| Custom usage pages | `src/remapper.h` | `RGB_LED_USAGE_PAGE 0xFFFA0000`, GPIO/MACRO/EXPR/… page defines |
| RGB LED driver | `src/main.cc` | `rgb565_to_wire()`, `rgb_led_init()`, `write_rgb_led()`, `RGB_LED_BRIGHTNESS` (64), `#ifdef RGB_LED_ENABLED` block |
| RGB LED presets (web) | `config-tool-web/usages.js` | `0xfffa****` entries, `class:'rgb_led_usage'` |
| WS2812 PIO program | `src/ws2812.pio` | `ws2812_program`, `ws2812_program_init` |
| GPIO input (buttons) | `src/main.cc` | `read_gpio()` — active-low, `GPIO_USAGE_PAGE \| i`, debounced |
| GPIO output | `src/main.cc` | `write_gpio()`, `set_gpio_inout_masks()`, `gpio_output_mode` (0=push-pull, 1=open-drain) |
| GPIO output state | `src/globals.cc` | `gpio_out_state[4]`, `gpio_output_mode` |
| Valid GPIO pins (per board) | each entry `.cc` | `get_gpio_valid_pins_mask()` (excludes UART/SWD/serial pins) |
| Dual UART link | `src/serial.cc`, `src/serial.h` | `serial_init/read/write`, `#ifndef`-guarded `SERIAL_{TX,RX,CTS,RTS}_PIN` (defaults 20/21/26/27) |
| Dual protocol commands | `src/dual.h` | `DualCommand` enum, `*_t` message structs |
| USB descriptors (emulated out) | `src/our_descriptor.cc/.h` | `our_descriptors[]`, `NOUR_DESCRIPTORS` |
| Out/feature reports | `src/out_report.cc` | `do_queue_out_report()`, `do_send_out_report()` |

---

## Dual (two-board) data flow

```
  input device ──USB──▶  Board B (remapper_dual_b)          Board A (remapper_dual_a)  ──USB──▶ PC
                         tuh_hid_report_received_cb  ──UART(REPORT_RECEIVED)──▶  serial_callback
                                                                                  → handle_received_report()
                                                                                  → process_mapping()  (the engine)
                         do_queue_out_report()      ◀──UART(SEND_OUT_REPORT)───  queue_out_report()
                         → tuh_hid_set_report()
```

- **Board A** = brains: holds config, runs `process_mapping()`, is the USB device the PC + config tool see. Its GPIO/LED/macro outputs work.
- **Board B** = capture only: reads HID reports and streams raw bytes to A; applies output/feature reports A sends back. No config, no engine → **no LED/GPIO mapping output.**
- `flash_b_side()` in `remapper_dual_a.cc` programs B over SWD (the combined image path). **RP2040-Zero exposes no SWD pads → flash each board separately.**
- Inter-board UART pins are `#ifndef`-guarded in `serial.h`; `ZERO_DUAL_SERIAL` moves them to GP8/9/10/11 (see CMake).

---

## RGB LED (onboard WS2812, GP16)

- **Mappable OUTPUT target.** Color = **RGB565 in the low 16 bits** of a usage on page **`0xFFFA`** (`fffaf800` = red, `fffaffff` = white, `fffa0000` = off). No `CONFIG_VERSION` change — inert on non-LED firmware.
- **Byte order is per board, chosen at compile time** by `RGB_LED_GRB` in `rgb565_to_wire()` (`src/main.cc`):

  | Board | Flag | Wire pack | Confirmed |
  | --- | --- | --- | --- |
  | RP2350-Zero | (default, RGB_LED_GRB OFF) | `(r<<16)\|(g<<8)\|b` | on hardware |
  | RP2040-Zero | `-DRGB_LED_GRB=ON` | `(g<<16)\|(r<<8)\|b` | on hardware 2026-07-06 (MicroPython neopixel) |

- **The 16 web-tool presets (`usages.js`) are identical for every board** — only the firmware wire pack differs, so presets land in the same positions. The web tool never needs to know the board.
- Brightness capped at `RGB_LED_BRIGHTNESS=64`/255 (~25%).
- **"nothing" source** (usage 0) with layer checkboxes = always-on / per-layer color; last-activated wins (`process_mapping()` LED block).
- Enabled by `RGB_LED_ENABLED` on both `remapper` (single) **and** `remapper_dual_a` (Board A). `remapper_dual_b` has no LED.
- PIO note: `rgb_led_init()` claims a free SM **after** the USB host. On the RP2040-Zero **single** build it shares 2 PIO blocks with PIO-USB (silently disables if none free); on **dual Board A** there is no PIO-USB, so it's contention-free.

---

## Firmware feature flags (CMake, `firmware/CMakeLists.txt`) — all default OFF

| Option | Effect | Applied to |
| --- | --- | --- |
| `RGB_LED_ENABLED` | compile the WS2812 driver, `RGB_LED_PIN=16` | `remapper`, `remapper_dual_a` |
| `RGB_LED_GRB` | GRB wire order (RP2040-Zero); OFF = RGB (RP2350-Zero) | same |
| `ZERO_DUAL_SERIAL` | dual UART → GP8/9/10/11 (RP2040-Zero edge pins) | `remapper_dual_a`, `remapper_dual_b` |

**Golden rule:** default (all OFF) builds are **byte-identical to upstream**. Add features as opt-in options, never by editing the default path. Firmware only builds in **CI** (`.github/workflows/build-rp2040.yml`) — each variant in its own `build-*` dir, renamed on `mv`. Release: push tag `rYYYY-MM-DD` → `release.yml` draft → `gh release edit <tag> --draft=false --latest`.

---

## Web tool (`config-tool-web/`)

| Thing | File | Anchor |
| --- | --- | --- |
| UI + firmware download buttons | `index.html` | `id="fw_download_*"` anchors → `releases/latest/download/*.uf2` |
| App logic | `code.js` | (does **not** reference the `fw_download_*` ids — they're plain links) |
| Usage definitions incl. LED presets | `usages.js` | `0xfffa****` = `rgb_led_usage` |

Served via GitHub Pages (root `index.html` redirects to `config-tool-web/`); goes live on push to `master`.

---

## Grep recipes (one-shot jumps)

```bash
# RGB LED wire order / brightness
grep -n "rgb565_to_wire\|RGB_LED_BRIGHTNESS\|RGB_LED_GRB" firmware/src/main.cc
# Which custom usage pages are taken
grep -n "USAGE_PAGE" firmware/src/remapper.h
# LED color presets in the web tool
grep -n "rgb_led_usage" config-tool-web/usages.js
# Dual protocol messages
grep -n "DualCommand" firmware/src/dual.h
# Who runs the mapping engine (process_mapping call sites)
grep -rn "process_mapping" firmware/src
# GPIO output path
grep -n "write_gpio\|gpio_out_state\|gpio_output_mode" firmware/src/main.cc firmware/src/globals.cc
# Dual serial pin defaults / overrides
grep -n "SERIAL_.*_PIN" firmware/src/serial.h
# Firmware feature flags
grep -n "option(" firmware/CMakeLists.txt
# CI build/rename steps
grep -n "build-\|mv build" .github/workflows/build-rp2040.yml
```

---

## Usage-page registry

Custom output pages are listed in [`CLAUDE.md`](CLAUDE.md) ("Custom output usage pages") and defined in `firmware/src/remapper.h`. Currently `0xFFF1`–`0xFFFA` are used; **next free is `0xFFFB`**. Verify in `remapper.h` before claiming one.
