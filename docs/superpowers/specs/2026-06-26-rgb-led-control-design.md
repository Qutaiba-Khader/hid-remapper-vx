# RGB LED Control — Design Spec

**Date:** 2026-06-26
**Status:** Approved
**Target board:** RP2350-Zero (built as `PICO_BOARD=pico2`), onboard WS2812 RGB LED on **GP16**.

## Goal

Let the user drive the onboard WS2812 RGB LED from the web config tool, "just like a GPIO output but with a color." The LED becomes a **mappable output target**; each LED mapping carries a color. Ships as a **separate** `remapper_pico2_led.uf2`; the stock `remapper_pico2.uf2` stays byte-identical.

## Core mechanism: color encoded in the target usage

A usage is a `uint32_t` = `PAGE (high 16 bits) | ID (low 16 bits)`. We add a new page and pack a 16-bit **RGB565** color into the low 16 bits:

```
RGB_LED_USAGE_PAGE = 0xFFFA0000      // verified free in BOTH firmware and web tool
target_usage       = RGB_LED_USAGE_PAGE | rgb565
```

`0xFFFA0000` chosen because `0xFFF1..0xFFF9` are all taken (incl. `0xFFF7`=MIDI, `0xFFF8`=ADC). The 16-bit ID field is read with `& 0xFFFF` and never truncated below 16 bits, and the MIDI page already packs 16-bit data the same way — so this is a proven pattern.

**Consequences (all verified against the code):** no new mapping struct field, no new protocol command, no flash-format change, **`CONFIG_VERSION` stays 18**. JSON export/import works unchanged (a usage is just a number that already round-trips).

### RGB565 ↔ RGB888

- Encode (web): `rgb565 = ((r>>3)<<11) | ((g>>2)<<5) | (b>>3)`
- Decode (firmware): `r8=(r5<<3)|(r5>>2)`, `g8=(g6<<2)|(g6>>4)`, `b8=(b5<<3)|(b5>>2)` (bit-replication).
- WS2812 wants **GRB** byte order. **Color order must be confirmed by calibration** on first flash (the feasibility test showed magenta as blue — verify pure R/G/B before locking).

## Firmware (only compiled when `RGB_LED_ENABLED`)

1. **`remapper.h`** — `#define RGB_LED_USAGE_PAGE 0xFFFA0000`.
2. **`types.h`** — add runtime field `bool led_prev_active = false;` to `reverse_mapping_t` (runtime-only; no wire/flash impact).
3. **`remapper.cc`**
   - `set_mapping_from_config`: detect targets with `(target & 0xFFFF0000) == RGB_LED_USAGE_PAGE`; let them flow into `reverse_mapping` but attach **no** `out_usage_def` and do **not** touch `gpio_out_mask_`/`gpio_in_mask_` (the pin is PIO-owned). Reset LED runtime state (active list, last-sent) at the top where `reverse_mapping.clear()` happens.
   - `process_mapping` (absolute branch): after `value` is finalized and **before** the active gate, for LED targets do edge tracking and `continue`:
     - `active = (value != rev_map.default_value)` (== `value != 0`).
     - rising edge (`active && !led_prev_active`): erase target from `active_led_targets` if present, then `push_back(target)`.
     - falling edge (`!active && led_prev_active`): erase target.
     - `led_prev_active = active`.
   - Expose current color: `active_led_targets.back() & 0xFFFF` (RGB565), or "off" when empty → **last-activated wins, off when none**.
4. **`main.cc`** (all under `#ifdef RGB_LED_ENABLED`)
   - `rgb_led_init()`: claim a free PIO SM **after** the USB host claims its own (reuse the proven feasibility pattern), store PIO/sm in file-scope statics. Call it once before the main loop.
   - `write_rgb_led()`: mirror `write_gpio()`. Force LED off when `suspended`. Else compute color = last active (or off), expand RGB565→RGB888→GRB, push to PIO **only when the color changed** since last send (avoid FIFO flooding at the 1 kHz tick).
   - Call `write_rgb_led()` immediately after `write_gpio()` each tick.
5. **`remapper_single.cc`** — when `RGB_LED_ENABLED`, mask GP16 out of `get_gpio_valid_pins_mask()` so the GPIO subsystem never pulls/drives the PIO-owned LED pin.
6. **`ws2812.pio`** — standard WS2812 PIO program + `ws2812_program_init` (reused from the feasibility test).

## Web config tool (shared by all firmwares)

1. **`code.js`** — `const RGB_LED_USAGE_PAGE = 0xFFFA0000;` next to the other page constants.
   - Register a `.rgb_led_usage` container in `setup_usage_modal`'s `usage_classes` map.
   - `readable_target_usage_name`: add a decode branch → `"RGB LED #RRGGBB"`.
   - Add `hexcolor→rgb565` and `rgb565→#rrggbb` helpers.
   - Add `set_led_color_visibility(mapping, container)` (mirrors `set_forced_layers`): show the per-row color input only when the target page is `RGB_LED_USAGE_PAGE`, set its value from the decoded color; on change, re-encode into `target_usage`. Call it from the three sites that mutate `target_usage`: `add_mapping`, the modal button click, and `apply_custom_hex`.
2. **`usages.js`** — one entry in `common_target_usages`: `"0xfffa0000": { name: 'RGB LED', class: 'rgb_led_usage' }` (auto-merged into all target descriptors).
3. **`index.html`** — a `.rgb_led_usage` category container in `#target_usage_modal`, and a per-row `<input type="color" class="led_color_input">` (hidden by default) in `mapping_template`. **Distinct** from the existing cosmetic `.color_input` row-highlight (must read/write `target_usage`, not `mapping['color']`).

## Build & delivery

- **`CMakeLists.txt`** — replace nothing in the stock `remapper` definition. Add an opt-in:
  ```cmake
  option(RGB_LED_ENABLED "Drive onboard WS2812 RGB LED output on GP16" OFF)
  if(RGB_LED_ENABLED)
      pico_generate_pio_header(remapper ${CMAKE_CURRENT_LIST_DIR}/src/ws2812.pio)
      target_compile_definitions(remapper PUBLIC RGB_LED_ENABLED RGB_LED_PIN=16)
  endif()
  ```
  Default (OFF) → byte-identical to the original.
- **`.github/workflows/build-rp2040.yml`** — one new build dir after `build-pico2`:
  ```bash
  mkdir build-pico2-led && cd build-pico2-led
  PICO_BOARD=pico2 cmake .. -DRGB_LED_ENABLED=ON
  make remapper && cd ..
  ```
  and one `mv build-pico2-led/remapper.uf2 artifacts/remapper_pico2_led.uf2`. Every existing artifact untouched.

## Compatibility

- `CONFIG_VERSION` stays **18** → cross-compatible with upstream jfedor2 and stock firmware.
- An LED mapping loaded on firmware without the LED engine is inert (unknown page falls through to no output) — no crash, no corruption.

## Out of scope / ceilings

- 16-bit RGB565 only (65,536 colors; slightly lossy). Full 24-bit would require a struct/protocol/version change — not done.
- Single onboard LED only (no LED index in the usage; the 16 bits are fully consumed by color).
- Macro-triggered LED output not covered (only direct mappings).

## Verification plan

1. CI builds `remapper_pico2_led.uf2` AND an unchanged `remapper_pico2.uf2`.
2. Flash `_led`; **calibrate color order** (pure red/green/blue map correctly); lock GRB order.
3. Map a key → RGB LED, pick a color → LED shows it while active, off when released.
4. Two LED mappings → last-activated wins.
5. Export JSON, re-import → colored usage round-trips intact.
6. Confirm keyboard/host still works (no PIO/USB contention).
