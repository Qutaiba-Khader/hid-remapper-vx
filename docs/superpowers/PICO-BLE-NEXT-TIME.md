# Pico BLE HID host — where we stopped & what to do next time

**Date:** 2026-07-08 · **Branch:** `feature/picow-bt-input` (pushed) · **Next:** retry on a **Pico 2 W (RP2350)**.

## Goal
Turn a **G20s** Android-TV air-mouse **voice** remote into a USB HID device via a Pico, eventually routed through the hid-remapper engine (remap → USB HID out) to an Android TV.

## What we proved on hardware
- **The G20s's buttons are BLE (HID-over-GATT), not Classic.** Its Classic radio (BD_ADDR `68:FC:CA:B4:43:B7`, CoD `0x0c043c` = Audio/Video major class, because of the mic) has **no Classic HID service** — Classic `hid_host_connect` fails `status 0x11` even in pairing mode.
- Over **BLE** the G20s advertises at `68:FC:CA:B4:43:B7` with **`hid=0`** — it does **NOT** put the HID service UUID (`0x1812`) in its advertisement.

## What works (both CI-green, `build-picow.yml` builds both)
- `remapper_picow` — Classic BT HID host. Boots, inquiry-scans, auto-pairs (SSP auto-accept + PIN `0000`), dumps reports. Good for Classic HID devices.
- `remapper_picow_ble` — BLE HID-over-GATT host. Boots, active-scans, connects, **auto-pairs Just-Works (no PIN) — confirmed `Pairing complete, success`**, onboard LED status (slow=scan, fast=connect, solid=ready).

## The one bug blocking the G20s
`remapper_picow_ble` connects to the **first device whose advertisement contains the HID service UUID** (`adv_event_contains_hid_service`). The G20s advertises `hid=0`, so it's **skipped**, and the firmware grabs a *different* BLE HID device (we saw `AB:6B:70:5C:60:D7`) → pairs fine, but no G20s button reports.

### Fix next time (pick one)
1. **Match the G20s specifically** — by address or by parsing the advertised **name** (add name logging: AD types `0x08`/`0x09`). Best first step: rebuild with per-advertiser **name** logging, do a scan, identify the G20s's BLE name/address, then connect to that.
2. **Broaden the connect trigger** — also accept a BLE **Appearance** field in the HID/remote range, or **connect-then-check** for the HID service after connecting (instead of filtering on the advertised UUID).
3. Then **verify HID discovery completes** — we only ever saw `Search for HID service.`, never `Ready`/`HID service client connected`. Confirm `hids_client_connect` reaches Ready and reports flow once connected to the *right* device.

## Build gotchas (this repo's pico-sdk is OLD: `bddd20f` → btstack `501e6d2`)
Vendor btstack examples from the **matching** version, not master:
- Classic: older btstack lacks `hid_subevent_incoming_connection_get_status` (accept incoming connection unconditionally).
- **`pico_btstack_hid` is not a real lib** — Classic HID host is in `pico_btstack_classic`.
- BLE: master's `hids_host_init/connect` are **`hids_client_init/connect`** here (same signatures).
- This SDK's `pico_btstack_ble` does **not** bundle the HID-GATT client → add `${PICO_BTSTACK_PATH}/src/ble/gatt-service/hids_client.c` via `target_sources`. No `gatt_service_client.c` in this btstack (hids_client is standalone).
- BLE `btstack_config.h` must define **`ENABLE_LE_PERIPHERAL`** (+ `ENABLE_LE_ENHANCED_CONNECTION_COMPLETE_EVENT`, `ENABLE_L2CAP_LE_CREDIT_BASED_FLOW_CONTROL_MODE`) or btstack `hci.c` errors on `le_advertisements_state`.
- BLE needs `pico_btstack_make_gatt_header(<target> PRIVATE <path>.gatt)` + a minimal GAP `.gatt` for `att_server_init`.
- Working main structure: `stdio_init_all → cyw43_arch_init → setup → btstack_run_loop_execute`. Onboard LED = `cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, …)` (after `cyw43_arch_init`).

## Serial-debug gotcha (cost real time)
The Pico's **one-time boot/init prints only appear if you read the USB-CDC port *during* boot.** After boot (connected-idle) there's no output. To catch boot: a reconnect-loop capture across a **power-cycle** (unplug/replug). The onboard **LED** is the quick visual state check. Pico W CDC = VID `2E8A` PID `000A` (was COM18).

## For Pico 2 W
Board id = **`pico2_w`**. All current targets are guarded `if(PICO_BOARD STREQUAL "pico_w")` — add a `pico2_w` variant/guard (CYW43 + BTstack are the same; the `_ble` code should port directly).

## Reliable fallback
The Pi Zero 2W **`bluetooth_2_usb`** (BlueZ) pairs BLE HID remotes robustly via `bluetoothctl` and already outputs USB HID — likely the faster path for the G20s if the Pico route stalls.

## The current `remapper_picow_ble.c` has diagnostic init markers
`ble_host.c` (commit `8fc752e`) has `printf`+`sleep_ms` markers after each init step — handy for debugging, **strip before release**.
