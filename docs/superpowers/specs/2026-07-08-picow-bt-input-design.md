# Design: Pico W Bluetooth Classic input for HID Remapper VX

**Date:** 2026-07-08
**Branch:** `feature/picow-bt-input`
**Status:** Approved (design). Executing Milestone 0 only; M1–M3 planned after M0 proven on hardware.

## Problem

HID Remapper reads its input device over a **wire** (PIO-USB host on GP0/GP1). We want a
**Raspberry Pi Pico W** to instead read the input device over **Bluetooth Classic**, using the
board's onboard CYW43439 radio, and output USB HID as usual — with **no additional hardware**
(single Pico W + USB cable only).

The concrete target device is the user's **JX-12 / JX-05 ring remote**, which is confirmed
**Bluetooth Classic (BR/EDR)** — so BLE-only solutions (jfedor2's nRF52840 build, blue-wire-bridge)
cannot connect to it.

jfedor2 has an **experimental Pico W Classic build**, but it is **binary-only (no public source)**
and its pairing does not work with the ring (it appears to require a typed PIN, which a
button-only ring cannot provide). Because we own the full `hid-remapper-vx` source, we can build
our own and, critically, **control pairing** to fix exactly that blocker.

## Goal / non-goals

- **Goal:** Bluetooth Classic input → remapping → USB HID output, on a single Pico W, source we own.
- **Non-goal (for now):** BLE input, Pico 2 W, dual-board variant. Noted as future; not in scope.
- **Hard constraint:** Firmware does **not** build on the dev machine (Windows, no Pico SDK).
  All verification is via **GitHub Actions CI** + **on-hardware** flashing (CLAUDE.md rule #3).
- **Hard constraint:** Stock builds stay **byte-identical** to upstream (CLAUDE.md golden rule #1).
  The Pico W work is an isolated target, never built by the default `cmake ..`.

## Approach (chosen: A)

**A — New minimal in-tree target, grown in place.** A new `remapper_picow` build target lives
inside the firmware tree. The PoC version (M0) is based on pico-examples `hid_host_demo` and only
pairs the ring + dumps its HID reports over USB serial. Later milestones grow the *same* target
into full firmware (USB output → engine → config tool). CI is reused across milestones.

Rejected: **B** standalone throwaway sketch (PoC + CI thrown away, more rework);
**C** fork hid-forwarder (it is SPP not HID-host, and a different repo — wrong direction).

## Architecture

```
FINAL:   ring ──BT──▶ bt_host (BTstack HID host) ──▶ report bytes + HID descriptor ──▶ engine ──▶ TinyUSB device ──▶ host
M0 (PoC):ring ──BT──▶ bt_host ────────────────────▶ report bytes ──▶ printf over USB-CDC serial   ⟵ stops here
```

The **back half is reused untouched** in later milestones (mapping engine `remapper.cc`, USB output
`tinyusb_stuff.cc` / `our_descriptor.cc`). Only the **input front-end** is new.

### New files
- `firmware/src/bt_host.cc` / `bt_host.h` — BTstack Classic HID-host front-end:
  radio init, inquiry/scan, connect, SDP fetch of the device's HID report descriptor,
  receive interrupt reports, and **auto-accept pairing** (SSP auto-accept; respond to any legacy
  PIN request with a default, e.g. `gap_pin_code_response(addr, "0000")` — no user PIN entry).
- `firmware/src/remapper_picow.cc` — the target's `main()`. For M0 this is a minimal loop that
  drives the cyw43/BTstack poll and prints received reports. Later it grows the TinyUSB device
  init + engine calls.
- `firmware/src/btstack_config.h` — BTstack feature configuration for this target.

## Build / board

- Board: `PICO_BOARD=pico_w` (RP2040 + CYW43439).
- New isolated executable target `remapper_picow` in `firmware/CMakeLists.txt`, added **guarded**
  so it is only configured for `pico_w` and never built by the default `cmake ..`. Every existing
  `.uf2` remains byte-identical.
- Links: `pico_stdlib`, `pico_cyw43_arch_none` (poll mode for M0), `pico_btstack_cyw43`,
  `pico_btstack_classic` (the HID-host code lives inside this library — there is no
  separate `pico_btstack_hid` lib). USB-CDC stdio enabled for the report dump.
- M0 uses **poll-mode** cyw43_arch for simplicity. Coexistence of BTstack with the TinyUSB device
  stack (needed from M1) is the known hard part and is flagged as M1's primary risk.

## Pairing (fixes the current blocker)

- **Auto-accept SSP**; answer legacy PIN requests automatically with a default PIN. **No typed PIN.**
  This is what a button-only ring needs and what the closed binary appears to get wrong.
- M0: stay discoverable/scanning; connect to the first Classic HID device found (optionally filtered
  by device class / address once the ring's address is known).

## CI (fast, Pico-W only)

- New workflow `.github/workflows/build-picow.yml`: a single job that installs the ARM toolchain +
  Pico SDK submodule and builds **only** the `remapper_picow` target for `pico_w`, then uploads the
  `.uf2` artifact. Triggered on push to `feature/picow-bt-input` and on changes to the BT source
  paths. Target ~2–3 min vs the ~18-variant `build-rp2040.yml`.
- `build-rp2040.yml` is **not modified** — it remains the source of truth for all shipping boards.

## Milestones (roadmap — execute M0 now)

| M | Scope | Done when |
|---|-------|-----------|
| **M0 (now)** | Pair+dump PoC target + Pico-W CI | Flash the CI `.uf2`, open a serial terminal, put the ring in pairing mode → **the ring's HID report bytes print**. Proves the ring pairs and is readable over the onboard radio. |
| M1 | Add TinyUSB device output; forward reports 1:1 as USB kbd/mouse | Host sees a USB HID device driven by the ring (BTstack + TinyUSB coexisting — the hard part). |
| M2 | Feed BT reports + HID descriptor into the remapper engine | Remapping/config behaves as on wired builds. |
| M3 | Config-tool pair/forget UX, LED status, opt-in polish, release build | Shippable Pico W firmware. |

M1–M3 get their own detailed plans **after M0 is proven on hardware.**

## Testing / verification

- No local firmware build → **CI green artifact** is the compile check; **on-hardware serial dump**
  is the behavior check for M0. This is the standard loop for this repo.

## References

- pico-examples `pico_w/bt/standalone/hid_host_demo` — working Classic BT HID host on Pico W.
- jfedor2 `hid-forwarder` `receiver-pico/src/bt.c` + `CMakeLists.txt` — how Pico W BTstack + TinyUSB
  are structured together, and the `gap_pin_code_response(addr,"0000")` auto-pairing pattern.
- Existing opt-in precedents in this repo: `RGB_LED_ENABLED`, `ZERO_DUAL_SERIAL`.
