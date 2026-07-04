# HID Remapper VX on the RP2040-Zero / RP2350-Zero

Full reference for running this remapper on the compact Waveshare **RP2040-Zero** and **RP2350-Zero** boards — pinout, every firmware file, the single- and dual-board builds, the onboard RGB LED, and how to build the firmware yourself.

- **RP2040-Zero** = a drop-in, Pico-compatible RP2040 board → uses the `pico` firmware.
- **RP2350-Zero** = a drop-in, Pico 2-compatible RP2350 board → uses the `pico2` firmware.

Both boards have a USB-C connector (native USB), an onboard **WS2812 RGB LED on GP16**, and BOOT + RESET buttons.

---

## 1. Which firmware file do I flash?

| What you're building | Board | Firmware file |
| --- | --- | --- |
| Single board (USB-A input) | RP2040-Zero | `remapper.uf2` |
| Single board (USB-A input) | RP2350-Zero | `remapper_pico2.uf2` |
| Single board + onboard RGB LED as a mappable target | RP2350-Zero | `remapper_pico2_led.uf2` |
| Dual board — side A (→ PC) | 2× RP2040-Zero | `remapper_rp2040_zero_dual_a.uf2` |
| Dual board — side B (→ devices) | 2× RP2040-Zero | `remapper_rp2040_zero_dual_b.uf2` |

All files are on the [Releases page](https://github.com/Qutaiba-Khader/hid-remapper-vx/releases/latest) and behind the **Download Firmware** buttons in the [config tool](https://qutaiba-khader.github.io/hid-remapper-vx/).

> There is no `remapper_pico.uf2` — the RP2040 single-board file is just `remapper.uf2`.

**Flashing (all files):** hold **BOOT**, plug the board into USB, release BOOT, then copy the `.uf2` to the `RPI-RP2` drive that appears. (On the RP2040-Zero you can also press RESET while holding BOOT if it's already powered.)

---

## 2. Pinout essentials

Board oriented with the **USB-C connector at the top**, component (chip / RGB LED) side facing you. Always trust the **printed silkscreen labels** — if the board is flipped, left/right mirror.

```
                USB-C
   5V  ○───┐  ┌───────┐  ┌───○ GP0
   GND ○───┤  │       │  ├───○ GP1
   3V3 ○───┤  │RP2040 │  ├───○ GP2
   GP29○───┤  │[LED   │  ├───○ GP3
   GP28○───┤  │ =GP16]│  ├───○ GP4
   GP27○───┤  │       │  ├───○ GP5
   GP26○───┤  │       │  ├───○ GP6
   GP15○───┤  │       │  ├───○ GP7
        └──○──○──○──○──○──○──┘ GP8
          GP14 13 12 11 10 GP9   (bottom edge)
```

- **Left edge** (top→bottom): 5V, GND, 3V3, GP29, GP28, GP27, GP26, GP15
- **Right edge** (top→bottom): GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8
- **Bottom edge** (left→right): GP14, GP13, GP12, GP11, GP10, GP9
- **GP16** (onboard RGB LED) and **GP17–GP25** are on the underside SMD pads (not on the edge).
- **5V = VSYS = VBUS** — tied directly to the USB-C VBUS, so it can power a downstream device.

---

## 3. Single-board build (USB-A input)

The board's USB-C connects to the host. A USB-A port (for the keyboard/mouse/receiver you want to remap) is wired to four pads using the **bit-banged USB host** (Pico-PIO-USB) on **GP0 (D+) / GP1 (D−)**. These two pins are fixed as a pair (D− is always D+ + 1) and cannot be moved.

![RP2040-Zero to USB-A wiring](images/rp2040-zero-usb-wiring.png)

| USB-A pin | Wire color | Board pad |
| --- | --- | --- |
| VBUS | 🔴 red | **5V** |
| D− | ⚪ white | **GP1** |
| D+ | 🟢 green | **GP0** |
| GND | ⚫ black | **GND** |

Firmware: `remapper.uf2` (RP2040-Zero) or `remapper_pico2.uf2` (RP2350-Zero).

---

## 4. Onboard RGB LED (RP2350-Zero)

`remapper_pico2_led.uf2` adds the onboard **WS2812 RGB LED on GP16** as a mappable output target. In the config tool, map a key (or a layer, via a "nothing" source) to **RGB LED** and pick one of 16 preset colors; last-activated color wins, black = off.

- Color is encoded as **RGB565 in the low 16 bits** of a usage on page **`0xFFFA`** (`fffa` + 4 hex; white = `fffaffff`, red = `fffaf800`, off = `fffa0000`). No protocol / `CONFIG_VERSION` change.
- This board's WS2812 uses **RGB** byte order (not the usual GRB). Brightness is capped (~25%) for LED life.
- GP16 is also the default UART TX, so the `_led` build loses UART serial-console debug (USB-CDC is unaffected).

Only the RP2350-Zero build ships with the LED enabled (`-DRGB_LED_ENABLED=ON`); the LED mapping is inert on other firmware.

---

## 5. Dual-board build (two RP2040-Zero boards)

The **dual** build gives **better device compatibility**: Board B reads your input device through the RP2040's **real hardware USB host** (native USB, via a USB-C OTG adapter) instead of the bit-banged PIO-USB, so devices and USB hubs that don't work on the single build often work here. The two boards talk over a UART link.

On the RP2040-Zero the stock UART pins GP20/GP21 are on the hard-to-reach underside pads, so this build moves the link to the edge-accessible **UART1 pins GP8/GP9/GP10/GP11**.

![Two RP2040-Zero dual wiring](images/rp2040-zero-dual-diagram.png)

**Six wires between the two boards:**

| Board A (→ PC) | Board B (→ input devices) |
| --- | --- |
| 5V | 5V |
| GND | GND |
| GP8 (TX) | GP9 (RX) |
| GP9 (RX) | GP8 (TX) |
| GP10 (CTS) | GP11 (RTS) |
| GP11 (RTS) | GP10 (CTS) |

- Both boards run the **same** firmware (GP8=TX, GP9=RX, GP10=CTS, GP11=RTS); the crossover (TX↔RX, RTS↔CTS) is in the wiring.
- **Board A** → computer via its USB-C. Flash `remapper_rp2040_zero_dual_a.uf2`.
- **Board B** → keyboard/mouse via a **USB-C OTG adapter** (native host — no USB-A breakout / GP0-GP1 wiring in the dual build). Flash `remapper_rp2040_zero_dual_b.uf2`.
- Flash each board **separately**. There is no combined single-flash image: it programs Board B over SWD, and the RP2040-Zero doesn't break out its SWD pads — you don't need it.

Valid RP2040 UART1 pins (if you want to choose different ones): TX = GP4/8/20/24, RX = GP5/9/21/25, CTS = GP6/10/22/26, RTS = GP7/11/23/27. GP8-11 are used because they're contiguous and on the edge. Approach based on [yyoshisaur's write-up](https://yyoshisaur.hatenablog.com/entry/2023/11/25/120000) and [jfedor2/hid-remapper#263](https://github.com/jfedor2/hid-remapper/issues/263).

---

## 6. Building the firmware yourself

Firmware is built with the Pico SDK (see the [upstream build docs](https://github.com/jfedor2/hid-remapper#how-to-compile-the-firmware)). This repo builds every variant in CI (`.github/workflows/build-rp2040.yml`); to build a specific one locally:

```bash
cd firmware
mkdir build && cd build

# RP2040-Zero single (remapper.uf2)
cmake .. && make remapper

# RP2350-Zero single (remapper_pico2.uf2)
PICO_BOARD=pico2 cmake .. && make remapper

# RP2350-Zero + onboard RGB LED (remapper_pico2_led.uf2)
PICO_BOARD=pico2 cmake .. -DRGB_LED_ENABLED=ON && make remapper

# Two RP2040-Zero dual (remapper_dual_a.uf2 + remapper_dual_b.uf2, serial on GP8-11)
PICO_BOARD=pico cmake .. -DZERO_DUAL_SERIAL=ON && make remapper_dual_a remapper_dual_b
```

Both feature options **default to OFF**, so a plain `cmake ..` build produces the stock, upstream-compatible firmware. The relevant CMake options live in `firmware/CMakeLists.txt`:

- `RGB_LED_ENABLED` — drive the WS2812 on GP16 (sets `RGB_LED_PIN=16`).
- `ZERO_DUAL_SERIAL` — set the dual-board UART to GP8/9/10/11 (edit here to pick other UART1 pins).

---

## 7. Gotchas

- The RP2040-Zero does **not** expose its SWD pads (no combined dual image; no SWD debugging).
- Single build: GP0/GP1 are the fixed PIO-USB host pair — keep them free and adjacent.
- Dual build: the input device connects to **Board B's USB-C via OTG**, not to GP0/GP1.
- `_led` build: GP16 is used for the LED, so no UART serial debug on that build.
- Stock files (`remapper.uf2`, `remapper_dual_a/b.uf2`, etc.) are byte-identical to upstream — the RP2040-Zero and RGB-LED builds are additive, opt-in CMake options.
