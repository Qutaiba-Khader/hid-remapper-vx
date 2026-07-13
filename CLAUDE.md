# CLAUDE.md — HID Remapper VX

Guidance for AI agents (and developers) working in this repo. **Read this first, then act — don't guess.**

> **Touching firmware or the web tool?** Read [`CODEMAP.md`](CODEMAP.md) first — it maps each subsystem to its file/symbol with grep recipes, so you don't re-derive the layout every session.

## What this is

A fork of [jfedor2/hid-remapper](https://github.com/jfedor2/hid-remapper) (upstream docs: [remapper.org](https://www.remapper.org/)). It's a **USB HID remapper**: firmware for RP2040 / RP2350 (and nRF52840) boards that sits between an input device and the host and remaps HID events, plus a **WebHID config tool**. This "VX" fork adds a dark-themed web UI, Android TV usages, an onboard RGB LED output target, and an RP2040-Zero dual build.

- Remote: `Qutaiba-Khader/hid-remapper-vx`. Default branch: **`master`** — work ships directly to master.
- Releases: git tags `rYYYY-MM-DD`.

## Golden rules — do not violate

1. **Never change the stock builds.** Every new board or feature MUST be **opt-in** — a `option(... OFF)` in `firmware/CMakeLists.txt` or a new board header — so a plain `cmake ..` build and every existing `.uf2` stay **byte-identical** to upstream. Precedents: `RGB_LED_ENABLED`, `ZERO_DUAL_SERIAL`. This is how we avoid corrupting other people's/boards' firmware.
2. **Don't bump `CONFIG_VERSION`** (`firmware/src/config.cc`, currently **18**) unless the persisted config format truly changes — the firmware and web tool must agree. Prefer encoding new features without a format change (e.g. the RGB LED color is packed into a usage on page `0xFFFA`, no version bump).
3. **Firmware does not build on this machine (Windows, no Pico SDK).** `.uf2` files are produced by GitHub Actions. **Verify via CI, not locally.** Watch the run and read the "Verify artifacts" step.
4. **Keep firmware filenames identical everywhere** — the CI `mv` step, the web-tool download buttons (`config-tool-web/index.html` **and** `config-tool-web-v2/js/tabs.js`), README/HARDWARE/RP2040-ZERO docs, and the `releases/latest/download/...` URLs. One typo = a 404 download. (`config-tool-web-v2/tests/firmware-links.test.js` checks the v2 list against what CI actually builds.)
7. **A web-tool deploy is invisible until you bump the cache stamp.** GitHub Pages serves `index.html` and the assets with a ~10-minute cache, so the browser keeps running the previous build. **Bump `?v=<date>` on every asset in `config-tool-web-v2/index.html` whenever you change any css/js**, and verify a deploy with `curl` against the served files — never by looking at the browser (you will be looking at a cached page and think nothing shipped).
8. **Never trust the UI mock.** `config-tool-web-v2/` came from a Claude Design mock that shipped a fake config, fake macros, fake "example" presets that added BLANK mappings, an expression palette that injected hardcoded usages, and Bootstrap — whose `.toast:not(.show){display:none}` made **every toast in the tool invisible**, so failed saves passed silently. `config-tool-web-v2/tests/no-dummy-data.test.js` + `ui-guards.test.js` keep it out.
5. **Web UI: readable text only.** The config tool is a dark theme; keep text readable (the owner dislikes low-contrast grey). Match the existing `text-muted` sublabel style only where sibling elements already use it.
6. **Don't reproduce a diagram/pin claim from memory** — verify pin positions/labels against the board photo or datasheet, and usage-page constants against the source (below).

## Firmware variants → output files

CI (`.github/workflows/build-rp2040.yml`) builds each variant in its own dir and renames on `mv`. There is **one `.uf2` per board/feature** because pinouts are compile-time constants.

| Board / feature | Build command | Output file |
| --- | --- | --- |
| Pico / **RP2040-Zero** (single) | `cmake ..` (default) | `remapper.uf2` |
| Pico 2 / **RP2350-Zero** (single) | `PICO_BOARD=pico2 cmake ..` | `remapper_pico2.uf2` |
| RP2350-Zero + onboard RGB LED | `PICO_BOARD=pico2 cmake .. -DRGB_LED_ENABLED=ON` | `remapper_pico2_led.uf2` |
| **RP2040-Zero** + onboard RGB LED (single) | `PICO_BOARD=pico cmake .. -DRGB_LED_ENABLED=ON -DRGB_LED_GRB=ON` | `remapper_rp2040_zero_led.uf2` |
| Two Picos (dual) | default, `make remapper_dual_a remapper_dual_b` | `remapper_dual_a.uf2`, `remapper_dual_b.uf2` |
| Two **RP2040-Zero** (dual) | `PICO_BOARD=pico cmake .. -DZERO_DUAL_SERIAL=ON` | `remapper_rp2040_zero_dual_a.uf2`, `_b.uf2` |
| Two **RP2040-Zero** (dual, Side A + LED) | `PICO_BOARD=pico cmake .. -DZERO_DUAL_SERIAL=ON -DRGB_LED_ENABLED=ON -DRGB_LED_GRB=ON` (make `remapper_dual_a`) | `remapper_rp2040_zero_dual_a_led.uf2` |
| Custom JLCPCB boards | `PICO_BOARD=remapper_v7`/`v8`/… | `remapper_board*.uf2` |
| nRF52840 (Bluetooth) | `build-nrf52.yml` | see `BLUETOOTH.md` |

There is **no** `remapper_pico.uf2` — the RP2040 single file is `remapper.uf2`. There is no combined dual image for the RP2040-Zero (it doesn't expose SWD).

## Key pin facts (RP2040-Zero / RP2350-Zero)

- **USB host (single build):** bit-banged PIO-USB on **GP0 (D+) / GP1 (D−)** — `PICO_DEFAULT_PIO_USB_DP_PIN=0`, D− = DP+1. Fixed adjacent pair.
- **Dual inter-board UART:** default GP20/21/26/27; on the RP2040-Zero moved to **GP8/9/10/11** (all UART1) via `ZERO_DUAL_SERIAL`, because GP20/21 are underside pads. Dual **Board B uses native USB host** (USB-C + OTG) — not GP0/GP1.
- **Onboard WS2812 RGB LED: GP16** (also default UART TX, so the `_led` build loses UART debug). Driven only when `RGB_LED_ENABLED`. **Wire byte order differs per board — RP2350-Zero = RGB, RP2040-Zero = GRB — selected by `RGB_LED_GRB` (default OFF = RGB).** Web-tool presets are identical across boards; only the firmware pack differs. Also enabled on dual Board A.
- Serial pins are `#ifndef`-guarded in `firmware/src/serial.h` → overridable by compile definition or board header.
- Full pinout + wiring diagrams: **[`RP2040-ZERO.md`](RP2040-ZERO.md)** and **[`HARDWARE.md`](HARDWARE.md)**.

## Custom output usage pages (firmware)

A usage is `uint32 = PAGE<<16 | ID`. Custom output pages (verify in `firmware/src/remapper.h` / `remapper.cc` / `main.cc` before claiming one is free):

`0xFFF1` LAYERS · `0xFFF2` MACRO · `0xFFF3` EXPR · `0xFFF4` GPIO · `0xFFF5` REGISTER · `0xFFF6` DIGIPOT · `0xFFF7` MIDI · `0xFFF8` ADC · `0xFFF9` DPAD · `0xFFFA` RGB_LED (low 16 bits = RGB565 color) · `0xFFFB` COMBO (target = **AND** of its sources; on a member mapping `scaling` = timing window in ms and `flags` bit 3 = consume). **Next free: `0xFFFC`** (`0xFFFF` is `OUR_OUT_INTERFACE`).

## Repo layout

- **[`firmware/`](firmware)** — Pico SDK C/C++.
  - Entry variants: [`remapper_single.cc`](firmware/src/remapper_single.cc) (single), [`remapper_dual_a.cc`](firmware/src/remapper_dual_a.cc) + [`remapper_dual_b.cc`](firmware/src/remapper_dual_b.cc) (dual), [`remapper_serial.cc`](firmware/src/remapper_serial.cc).
  - Shared: [`remapper.cc`](firmware/src/remapper.cc) (mapping engine), [`config.cc`](firmware/src/config.cc) (persisted config + commands), [`main.cc`](firmware/src/main.cc), [`serial.cc`](firmware/src/serial.cc) (dual UART link).
  - Board headers: [`firmware/src/boards/`](firmware/src/boards)`*.h` (selected by `PICO_BOARD`).
  - [`firmware/CMakeLists.txt`](firmware/CMakeLists.txt) — targets + the opt-in feature options.
- **[`config-tool-web/`](config-tool-web)** — the ORIGINAL WebHID config tool (v1), still live and still the reference for protocol behavior. [`index.html`](config-tool-web/index.html) (UI + firmware download buttons), [`code.js`](config-tool-web/code.js), [`usages.js`](config-tool-web/usages.js). Served via **GitHub Pages** (root `index.html` redirects to `config-tool-web/`).
- **[`config-tool-web-v2/`](config-tool-web-v2)** — the REDESIGNED tool (v2): vanilla JS, no build step, **combos**, per-field reset-to-default, live monitor. Live at `…/config-tool-web-v2/`.
  - `js/device.js` = WebHID + the 32-byte binary protocol (ported from v1's `code.js`).
  - `js/translate.js` = the APP⇄device-config boundary. **All unit conversions live here**: ms↔µs, `scale`↔`scaling` (×1000), and **expression constants↔fixed point (×1000)** — get that last one wrong and `0.05 mul` is written to the device as `0 mul`.
  - Tests: `cd config-tool-web-v2 && node --test tests/*.test.js` (**84**, no deps). They include a full end-to-end flow against a fake device (`flow.test.js`), a firmware↔web contract check that reads the firmware source (`contract.test.js`), and guards against the mock's fake data creeping back.
  - **Still missing vs v1:** macro editor and quirk editor (both are read-only/JSON-only in v2; the data round-trips untouched).
- **[`.github/workflows/`](.github/workflows)** — [`build-rp2040.yml`](.github/workflows/build-rp2040.yml), [`build-nrf52.yml`](.github/workflows/build-nrf52.yml), [`release.yml`](.github/workflows/release.yml).
- **[`custom-boards/`](custom-boards)** — KiCad designs for JLCPCB boards.

## Build / release workflow

- CI builds on push to `firmware/**` or a workflow file. To verify a firmware change compiled, watch that run: `gh run watch <id> --exit-status`.
- **Release:** push a tag `rYYYY-MM-DD` → `release.yml` builds everything and creates a **draft** release with `files: download/*` (all `.uf2`s auto-attached). Then publish + mark latest: `gh release edit <tag> --draft=false --latest`. Only then do `releases/latest/download/<file>` links resolve.
- Web-tool changes go live on GitHub Pages after they land on `master`.

## Docs

- [`CODEMAP.md`](CODEMAP.md) — **subsystem → file:symbol index + grep recipes. Read before touching firmware/web tool.**
- [`README.md`](README.md) — user overview, wiring summaries, download links.
- [`HARDWARE.md`](HARDWARE.md) — building the physical device (single, dual, RP2040-Zero).
- [`RP2040-ZERO.md`](RP2040-ZERO.md) — full RP2040-Zero / RP2350-Zero reference (this fork's addition).
- [`BLUETOOTH.md`](BLUETOOTH.md), [`SERIAL.md`](SERIAL.md), [`EXPRESSIONS.md`](EXPRESSIONS.md) — feature docs. [`CHANGELOG.md`](CHANGELOG.md).
