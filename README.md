# HID Remapper VX - Visual Enhanced

A visually enhanced fork of [jfedor2/hid-remapper](https://github.com/jfedor2/hid-remapper) with a dark-themed config tool, visual Expression Builder, Quick Actions, and Example Configs for Android TV, Browser, and Windows remapping.

## Live Config Tool

**[Open Configuration Tool](https://qutaiba-khader.github.io/hid-remapper-vx/)**

Use Chrome or a Chromium-based browser (WebHID required).

## What This Fork Adds

- **Dark theme UI** optimized for readability
- **Categorized Android TV usages** (Power, Navigation, Media, Volume, Apps, System)
- **Quick Actions tab** with grid-button shortcuts for Android TV, Browser, and Windows key combos
- **Example Configs** as color-coded categorized cards (Keyboard, Mouse, Macros, Expressions, Windows)
- **Expression Builder** - visual block-based editor (powered by Google Blockly) for building RPN expressions without writing code
  - Categorized toolbox: Input, Logic, Math, Memory, Time, Trig/Advanced
  - Unified input picker with all mouse, keyboard, and gamepad inputs in one dropdown
  - 7 starter templates (Button Hold, Scale Mouse, Invert Axis, If/Then/Else, Clamp, Combo, Threshold)
  - RPN parser that loads existing expressions back into visual blocks when clicking Edit
  - Close confirmation dialog to prevent losing work
- **Expression UX** - snippets dropdown, copy/paste buttons, and Edit button linking to the visual builder
- **Drag-and-drop reorder** for mappings
- **Improved UX** for Sticky/Tap/Hold with clear help text and tooltips
- **Android TV HID descriptor** (firmware) with Consumer Control outputs for all standard remote keys

## How It Works

This is a USB HID remapper that sits between your remote's USB receiver and the Android TV device. It intercepts HID input events and remaps them according to your configuration — entirely in hardware, no host software needed.

## Wiring (RP2040-Zero / RP2350-Zero + USB-A)

The board's own USB-C connects to the host. A USB-A port for the device you want to remap (keyboard/mouse/receiver) is wired to four pads using the standard USB wire colors:

![RP2040-Zero to USB-A wiring](images/rp2040-zero-usb-wiring.png)

| USB-A pin | Wire color | Board pad |
|-----------|-----------|-----------|
| VBUS | 🔴 red | **5V** |
| D− | ⚪ white | **GP1** |
| D+ | 🟢 green | **GP0** |
| GND | ⚫ black | **GND** |

Notes:
- The PIO USB host is fixed to the **GP0 (D+) / GP1 (D−)** pair — they must stay adjacent and cannot be moved.
- **5V = VSYS = VBUS**, tied to the board's USB-C VBUS, so it supplies bus power out to the attached device.
- Flash the plain `remapper_pico.uf2` for the **RP2040-Zero**, or `remapper_pico2.uf2` (or `remapper_pico2_led.uf2` for onboard RGB LED control) for the **RP2350-Zero**.

## Quick Start

1. Flash the appropriate firmware to your RP2040-based board (see [original docs](https://github.com/jfedor2/hid-remapper#how-to-make-the-device))
2. Open the [config tool](https://qutaiba-khader.github.io/hid-remapper-vx/)
3. Click **Open device** to connect via WebHID
4. Use the **Quick Actions** tab for common Android TV mappings and example configs
5. Use the **Expression Builder** (click Edit on any expression field) to visually create expressions
6. Click **Save to device** when done

## Acknowledgments

This project is built upon the excellent work of **[Jacek Fedorynski](https://github.com/jfedor2)** and the [HID Remapper](https://github.com/jfedor2/hid-remapper) project. The original HID Remapper provides a robust, well-engineered hardware remapping platform with support for multiple RP2040 and nRF52840 boards, comprehensive HID protocol handling, and a powerful expression engine. Without that solid foundation, this Android TV-focused customization would not be possible.

For full documentation on hardware setup, firmware compilation, and the complete feature set, please visit the original project at [remapper.org](https://www.remapper.org/).

## License

The software in this repository is licensed under the [MIT License](LICENSE), unless stated otherwise.

The hardware designs in this repository are licensed under the Creative Commons Attribution 4.0 International license ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), unless stated otherwise.
