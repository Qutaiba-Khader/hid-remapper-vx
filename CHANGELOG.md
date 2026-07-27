# Changelog

## IR (infrared) output — turn any button into a TV remote key (2026-07-27)

Map any button on your input device to a **TV/AV remote key**. The Pico drives an IR LED directly,
so a Bluetooth remote can control a TV that has no network control at all.

Download **`remapper_ir.uf2`** (wired USB) or **`remapper_picow_ble_ir.uf2`** (Pico W + Bluetooth)
from the config tool (**Actions → Infrared**). Wire the LED to **GP15** (changeable in Settings).

- **NEC and Samsung** protocols, on a **PWM carrier + hardware alarm** — never PIO, so it never
  contends with the PIO-USB host or the WS2812 RGB LED, on any board. Non-blocking: a ~68 ms frame
  cannot stall core-0 USB.
- **145 codes built in**: Samsung TV (58, including discrete **HDMI 1–4** and Power On/Off), Xbox
  One / Series Media Remote (36) and LG TV (51). Any other NEC-family device works by typing a raw
  32-bit code into the row.
- **Hold to repeat**, like a real remote — retransmits every 110 ms while held, so volume ramps and
  channels surf. Adjustable in Settings (0 = once per press). This is the one output that needs it:
  every other mapping just holds its output bit at 1 and lets the host auto-repeat, but IR is
  fire-and-forget pulses with no held state to report.
- **Opt-in at compile time** (`-DIR_OUTPUT_ENABLED=ON`), so every existing `.uf2` is unchanged, and
  `CONFIG_VERSION` stays **18** — the IR code rides the mapping's existing `scaling` field and the
  two settings ride pseudo-mappings on `0xFFFB00FE` / `0xFFFB00FF`.

Two things worth knowing. **Range is set by your LED circuit, not the firmware:** a bare module like
the KY-005 has no driver transistor, so its LED runs at about 9.5 mA against a real remote's
100–500 mA — expect well under a metre until you add a transistor. And **the IR pin must be excluded
from the GPIO scanner**: `main.cc` treats every pin that isn't a declared GPIO *output* as an input
"so that the monitor works", which sampled our 38 kHz carrier and reported it as a phantom `GPIO 15`
input while putting a pull-up on the drive pin.

Also fixed in the web tool: keyboard and consumer keys were all flagged **"always 1 — not a button"**
and hidden from the picker. They are HID *array* inputs and the firmware never sends their key-up
(`remapper.cc`, "for array range inputs, key-up events don't show up in the monitor"), so
`min == max == 1` is the only reading they can ever have. New **`?debug=1`** mode dumps the raw
device config, the save payload and the Monitor for bug reports.

## Bluetooth input on a Pico W (2026-07-14)

A **Pico W** can now take its input over **Bluetooth LE** instead of a USB cable. Pair a BLE keyboard,
mouse or TV remote and it runs through the **full mapping engine** — layers, macros, expressions,
quirks, every output profile — and out to the PC as an ordinary USB HID device. The PC sees a
**HID Remapper**, not your remote.

Download **`remapper_picow_ble.uf2`** from the config tool (**Actions → Bluetooth**). Full reference:
[`BLUETOOTH-PICOW.md`](BLUETOOTH-PICOW.md).

- BTstack owns **core 1**; hid-remapper's engine + TinyUSB device own **core 0**. They meet only in a
  small lock-free bridge. A BLE device enters the engine through the *same two calls* a wired USB
  device makes, so everything downstream is identical.
- **Auto-connects to its paired device, always**, and once paired it will never bond with anything
  else. *Pair new device* opens a 3-minute window.
- The build has no serial output, so the **LED is the status**: solid = connected, fast = connecting,
  **double blink = pairing window open**, slow = idle.

**Source lives on `feature/picow-bt-input` and is not merged.** The `.uf2` was uploaded by hand to the
`r2026-07-06` release; `build-picow` is not in the release pipeline yet.

The one that will waste your evening: **a BLE HID device serves its HID service to ONE bonded host.**
If the remote is still paired to a TV or a phone it will accept the connection and then refuse to
talk. Re-pair the remote. (Verified the hard way — a third-party bridge that is known to work failed
on the same remote in the same way.) And **never** clear the bond on our side only: the remote keeps
its key, and the half-bond deadlock that follows is unrecoverable in firmware.

## Combos removed (2026-07-13)

The native combo feature (usage page `0xFFFB`) has been **removed entirely** — from the firmware,
the web tool, the docs and the releases. Releases `r2026-07-13`, `r2026-07-13b` and `r2026-07-13c`
were deleted; **`r2026-07-06` is `latest` again**, so every firmware download link in the config
tool serves combo-free firmware. `firmware/src/remapper.cc` is back to its pre-combo state.

The redesigned web tool (`config-tool-web-v2/`) stays, minus combos — and keeps the fixes found
while combos were being debugged:

- the Monitor's **`+` button** works (it was being destroyed mid-click by its own live redraw —
  the monitored device is the very mouse you are holding);
- the Monitor no longer prints **`Port 255`** on every row (255 is `HUB_PORT_NONE` — "no hub");
- usages the device reports at a **constant value** (one mouse sits at `0xffa00008` = 1 forever)
  are flagged as "not a button" and are no longer offered as something to map;
- the input picker lists **the buttons you actually pressed** ("Pressed on your device") first.

If combos are ever wanted again, the work is in git history (`db2580b`..`2640dcc`).

## Web config tool v2 — the redesigned tool goes live (2026-07-13)

`config-tool-web-v2/` is now a real, working tool (it was a static mock). Live at
**https://qutaiba-khader.github.io/hid-remapper-vx/config-tool-web-v2/** — the original tool at
`/config-tool-web/` is untouched and still works.

- **Combos** (see below), a **live Monitor**, per-field **reset to firmware default** in Settings,
  Import/Export JSON, the full firmware download grid (all 27 builds, with the release tag fetched
  live), Flash / Flash B-side / Pair / **Forget all devices**.
- **The tool now boots EMPTY.** Everything on screen comes from your device or a config you
  imported — the design mock's fake config, fake macros and fake "example" presets (which added
  *blank* mappings while claiming otherwise) are gone.
- **Fixed: settings had drifted from the firmware's own defaults** — unmapped passthrough is
  **all 8 layers** (was layer 0 only), scroll timeout **1000 ms** (was 100), interval **0** (was 1),
  macro entry duration **1 ms** (was 10).
- **Fixed: several ways to lose your config.** A save now always resumes the device even if it
  fails midway (an unresumed device accepts no input and looks bricked); macros, expressions and
  quirks survive a load→save; a config that did not come from the device needs confirmation before
  it overwrites one; and an unfinished row (no output, or a combo key not picked yet) is never
  written.
- **Fixed: expression constants are ×1000 fixed point on the device.** `0.05 mul` was being written
  as `0 mul` — multiplying the whole expression by zero.
- **Fixed: every toast was invisible** (Bootstrap's `.toast:not(.show){display:none}` beat ours), so
  failed saves and errors passed silently. Bootstrap is gone; it was never used.
- **Macro editor** — build a macro as a sequence of steps (several keys per step are pressed
  together; an empty step is a pause), copy a macro to another slot, and fire it by mapping a key's
  output to **Macro N**.
- **Quirk editor** — add/edit/delete quirks (VID, PID, interface, report id, usage, bit position,
  size, relative, signed) for devices whose HID descriptor is wrong.
- **The picker now offers the usages your device actually reports** (v1 asks the device; v2 never
  did, so anything outside the static catalog could only be typed as raw hex).
- **The expression editor knows all 55 firmware ops** — it previously knew 46, and any expression
  using one of the other 9 was flagged "Unknown operation" with Apply disabled, so an expression
  already on the device could not be edited.
- **Layer safety**: a layer key is forced onto the layer it activates (non-sticky) or off it
  (sticky), exactly as the firmware does — otherwise you can build a layer you cannot leave.
- **The 72 example configs** from the original tool (search, then **Add** to append or **Replace** to swap).
- **The output list follows the emulated device.** A "Nintendo Switch" build cannot send mouse
  movement, so it is no longer offered — and the same HID code is relabelled per profile
  (0x00010030 is "Cursor X" on a mouse, "Left stick X" on a gamepad).
- **Click-to-sort** the Input / Output / Layers columns, and a **back-to-top** button.
- **Multi-line expressions** (`eol` shows as a real line break) and **`/* comments */` survive
  editing through the block palette** — the tokenizer used to delete them silently.
- **Feature parity with the original tool is COMPLETE.** Nothing it can do is missing here.

## Native combos — r2026-07-13

- **Combos: press several inputs together, fire one output.** New usage page **`0xFFFB`** is an **AND gate** — a target on that page fires only when *all* of its sources are active (every other target sums its sources, which is an OR). That one-line difference is the whole feature.
- A combo persists as **ordinary mappings**, so nothing about the config format changes and **`CONFIG_VERSION` stays 18**:
  - *members* — `key → 0xfffb00NN`, one per key in the combo,
  - *trigger* — `0xfffb00NN → output`, carrying the usual scaling / sticky / tap / hold / layers.
- **Per-combo timing window** (not one global setting): on a member mapping the unused `scaling` field carries the window in **milliseconds**; `0` = no timing check. All keys must go down within the window, after which the combo **latches** while they are held.
- **Per-combo (and per-member) "consume"**: free `flags` **bit 3**. While the combo is held, a consumed key does **not** fire its own mappings — so `Vol+ & Vol- → Mute` sends *only* Mute. Turn it off and all three fire.
- Because a combo is a real input-state slot, **sticky/tap/hold/scaling/layers work on it for free**, and it can be read from an expression (`0xfffb0001 input_state`).
- Built by **default** (`option(COMBO_ENABLED ... ON)`); pass `-DCOMBO_ENABLED=OFF` to compile the combo engine out. **No `.uf2` filename changed** — every existing build simply gains combos. On firmware without combo support, combo mappings are inert (never corrupt).
- Web tool (`config-tool-web-v2/`): combo rows compile to real device mappings and fold back on load; each combo row has its own window + Consume switch; Settings gains a Combos master on/off.
- **Settings fixes** (they had drifted from the firmware's own defaults in `globals.cc`): unmapped passthrough now defaults to **all 8 layers** (was layer 0 only), partial scroll timeout **1000 ms** (was 100), interval override **0** (was 1), macro entry duration **1 ms** (was 10). Every setting now has a reset-to-default button.

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
