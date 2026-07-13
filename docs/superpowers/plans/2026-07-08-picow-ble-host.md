# M0-BLE: Pico W BLE HID-over-GATT host (for the G20s) — Implementation Plan

**Goal:** A second Pico W firmware target that pairs a **BLE** HID device (the G20s remote — its buttons are BLE HID; its Classic radio is only the voice mic) and dumps its HID report notifications over USB serial. Sibling to the Classic `remapper_picow`.

**Why:** On hardware, the Classic host found the G20s but `hid_host_connect()` returns status `0x11` (unsupported feature) even in pairing mode → the remote exposes no Classic HID service. Its keyboard/air-mouse is BLE HID-over-GATT.

**Approach:** New isolated target `remapper_picow_ble`, built only for `PICO_BOARD=pico_w`. Vendor BTstack's `hog_host_demo.c` (BLE HID-over-GATT host: scans for HID-service advertisers → connects → Just-Works pairing → subscribes to report notifications). Adapt it to (a) init cyw43, (b) dump raw report bytes instead of decoding keyboard ASCII, (c) log every advertiser for diagnostics. New CI builds both Classic + BLE targets.

## Global constraints
- **Byte-identical stock builds:** all changes inside the existing `if(PICO_BOARD STREQUAL "pico_w")` guard; nothing else touched.
- **No local build** (CI-only); **no extra hardware**; serial over the Pico W's own USB.
- Board `pico_w`. Verification: CI green + on-hardware serial (controller reads COM port).

## File structure (all new files under `firmware/src/ble/`)
- `firmware/src/ble/btstack_config.h` — BLE-enabled BTstack config (below).
- `firmware/src/ble/ble_gatt.gatt` — minimal GAP GATT DB (below). Generates `ble_gatt.h` at build time.
- `firmware/src/ble/ble_host.c` — vendored `hog_host_demo.c` + adaptations A–D.
- `firmware/src/ble/ble_host.h` — interface: `void ble_host_init(void); void ble_host_run(void);` (wrap in `extern "C"`).
- `firmware/src/ble/remapper_picow_ble.cc` — `main()` → `ble_host_init(); ble_host_run();`.
- Modify `firmware/CMakeLists.txt` (extend the pico_w guard) and `.github/workflows/build-picow.yml`.

## Task 1: BLE target + CI (transcription-heavy)

### `firmware/src/ble/ble_gatt.gatt` (verbatim)
```
PRIMARY_SERVICE, GAP_SERVICE
CHARACTERISTIC, GAP_DEVICE_NAME, READ, "HID Remapper BLE"
```

### `firmware/src/ble/btstack_config.h` (verbatim)
```c
#ifndef _PICO_BTSTACK_BTSTACK_CONFIG_H
#define _PICO_BTSTACK_BTSTACK_CONFIG_H

#define ENABLE_LOG_INFO
#define ENABLE_LOG_ERROR
#define ENABLE_PRINTF_HEXDUMP

// BLE: LE central + HID-over-GATT host
#define ENABLE_BLE
#define ENABLE_LE_CENTRAL
#define ENABLE_LE_SECURE_CONNECTIONS
#define ENABLE_LE_DATA_LENGTH_EXTENSION
#define ENABLE_GATT_CLIENT_PAIRING
#define ENABLE_LE_PRIVACY_ADDRESS_RESOLUTION

// buffers / sizes
#define HCI_OUTGOING_PRE_BUFFER_SIZE 4
#define HCI_ACL_PAYLOAD_SIZE (1691 + 4)
#define HCI_ACL_CHUNK_SIZE_ALIGNMENT 4
#define MAX_NR_BTSTACK_LINK_KEY_DB_MEMORY_ENTRIES 2
#define MAX_NR_GATT_CLIENTS 1
#define MAX_NR_HCI_CONNECTIONS 1
#define MAX_NR_L2CAP_CHANNELS 4
#define MAX_NR_L2CAP_SERVICES 3
#define MAX_NR_SERVICE_RECORD_ITEMS 4
#define MAX_NR_SM_LOOKUP_ENTRIES 3
#define MAX_NR_WHITELIST_ENTRIES 16
#define MAX_NR_LE_DEVICE_DB_ENTRIES 16

// avoid cyw43 shared-bus overrun
#define MAX_NR_CONTROLLER_ACL_BUFFERS 3
#define MAX_NR_CONTROLLER_SCO_PACKETS 3
#define ENABLE_HCI_CONTROLLER_TO_HOST_FLOW_CONTROL
#define HCI_HOST_ACL_PACKET_LEN 1024
#define HCI_HOST_ACL_PACKET_NUM 3
#define HCI_HOST_SCO_PACKET_LEN 120
#define HCI_HOST_SCO_PACKET_NUM 3

// bonding persistence in flash
#define NVM_NUM_DEVICE_DB_ENTRIES 16
#define NVM_NUM_LINK_KEYS 16

// host still exposes a tiny GAP ATT DB
#define MAX_ATT_DB_SIZE 512

#define HAVE_EMBEDDED_TIME_MS
#define HAVE_ASSERT
#define ENABLE_SOFTWARE_AES128
#define ENABLE_MICRO_ECC_FOR_LE_SECURE_CONNECTIONS

#endif
```

### `firmware/src/ble/ble_host.c` — vendor + adapt
Download the canonical source (local pico-sdk submodule is empty):
```
curl -fsSL https://raw.githubusercontent.com/bluekitchen/btstack/master/example/hog_host_demo.c -o firmware/src/ble/ble_host.c
```
Then apply:
- **Adapt A (includes + entry points):** add `#include "pico/cyw43_arch.h"` and `#include "ble_host.h"`. Change `#include "hog_host_demo.h"` → `#include "ble_gatt.h"` (the generated GATT header). Rename `int btstack_main(int argc, const char * argv[])` → `void ble_host_init(void)`; delete the `btstack_main` forward declaration, `argc`/`argv`, and `return 0;`. At the very top of `ble_host_init()` add:
  ```c
  if (cyw43_arch_init()) { printf("cyw43_arch_init failed\n"); return; }
  ```
  Add a new function at end:
  ```c
  void ble_host_run(void) { btstack_run_loop_execute(); }
  ```
- **Adapt B (raw report dump):** replace the ENTIRE body of `hid_handle_input_report(uint8_t service_index, const uint8_t * report, uint16_t report_len)` with just:
  ```c
  printf("REPORT svc=%u len=%u:", service_index, report_len);
  printf_hexdump(report, report_len);
  ```
  (Leave the now-unused `keytable_us_*`, `CHAR_*`, `NUM_KEYS`, `last_keys` — dead code, `-Wall` only, no `-Werror`.)
- **Adapt C (log every advertiser + active scan):** in `hog_start_scan()`, change `gap_set_scan_parameters(0,48,48)` → `gap_set_scan_parameters(1,48,48)` (active scan, so we also get scan-response names/UUIDs). In `GAP_EVENT_ADVERTISING_REPORT` handling, BEFORE the `adv_event_contains_hid_service` check, add a log so we see every device even if it doesn't advertise HID:
  ```c
  {
      bd_addr_t _a; gap_event_advertising_report_get_address(packet, _a);
      printf("Adv from %s, hid=%d\n", bd_addr_to_str(_a), (int) adv_event_contains_hid_service(packet));
  }
  ```
- **Adapt D:** leave the SM Just-Works / numeric-comparison auto-confirm handlers as-is (that IS our auto-pairing). Leave `setvbuf(stdin, ...)` — harmless.
- **Adapt E (onboard LED status):** drive the Pico W's onboard LED (on the CYW43 chip) from `app_state` via a BTstack periodic timer. Patterns: **solid ON = connected/ready**, **fast blink = connecting/pairing**, **slow blink = scanning/idle**. Add near the other statics:
  ```c
  static btstack_timer_source_t led_timer;
  static void led_timer_handler(btstack_timer_source_t * ts){
      static uint32_t tick = 0;
      tick++;
      int on;
      switch (app_state){
          case READY:
              on = 1; break;                       // solid = connected, receiving
          case W4_CONNECTED:
          case W4_ENCRYPTED:
          case W4_HID_CLIENT_CONNECTED:
              on = tick & 1; break;                // fast blink (~5 Hz) = connecting/pairing
          default:
              on = (tick / 5) & 1; break;          // slow blink (~1 Hz) = scanning/idle
      }
      cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, on);
      btstack_run_loop_set_timer(ts, 100);
      btstack_run_loop_add_timer(ts);
  }
  ```
  Start it at the end of `ble_host_init()` (after `cyw43_arch_init()` succeeded; anywhere before/after `hci_power_control` is fine):
  ```c
  btstack_run_loop_set_timer_handler(&led_timer, &led_timer_handler);
  btstack_run_loop_set_timer(&led_timer, 100);
  btstack_run_loop_add_timer(&led_timer);
  ```
  (`cyw43_arch_gpio_put` / `CYW43_WL_GPIO_LED_PIN` come from `pico/cyw43_arch.h`, already included in Adapt A.)

### `firmware/src/ble/ble_host.h`
```c
#ifndef BLE_HOST_H
#define BLE_HOST_H
#ifdef __cplusplus
extern "C" {
#endif
// Init cyw43 + BTstack LE central + HID-over-GATT host, auto-pair (Just Works),
// scan for a BLE HID device, dump its report notifications over stdio. Non-blocking.
void ble_host_init(void);
// Run the BTstack loop; does not return.
void ble_host_run(void);
#ifdef __cplusplus
}
#endif
#endif
```

### `firmware/src/ble/remapper_picow_ble.cc`
```cpp
#include <stdio.h>
#include "pico/stdlib.h"
#include "ble_host.h"
int main() {
    stdio_init_all();
    sleep_ms(2000);
    printf("remapper_picow_ble: starting BLE HID-over-GATT host\n");
    ble_host_init();
    ble_host_run();
    return 0;
}
```

### `firmware/CMakeLists.txt` — extend the `if(PICO_BOARD STREQUAL "pico_w")` block, add:
```cmake
    # BLE HID-over-GATT host (for BLE remotes like the G20s)
    add_executable(remapper_picow_ble
        src/ble/remapper_picow_ble.cc
        src/ble/ble_host.c
    )
    target_include_directories(remapper_picow_ble PRIVATE src/ble)
    target_link_libraries(remapper_picow_ble
        pico_stdlib
        pico_cyw43_arch_none
        pico_btstack_cyw43
        pico_btstack_ble
    )
    pico_btstack_make_gatt_header(remapper_picow_ble PRIVATE ${CMAKE_CURRENT_LIST_DIR}/src/ble/ble_gatt.gatt)
    pico_enable_stdio_usb(remapper_picow_ble 1)
    pico_enable_stdio_uart(remapper_picow_ble 0)
    pico_add_extra_outputs(remapper_picow_ble)
```

### `.github/workflows/build-picow.yml` — build both targets
- Add to `paths:` trigger: `firmware/src/ble/**`.
- Change the build/mv step to build and collect both:
  ```bash
  make -j$(nproc) remapper_picow remapper_picow_ble
  ...
  mv build-picow/remapper_picow.uf2 artifacts/remapper_picow.uf2
  mv build-picow/remapper_picow_ble.uf2 artifacts/remapper_picow_ble.uf2
  ```
- Upload the whole `artifacts/` dir (both uf2).

## Verification
CI green (compile+link) for `remapper_picow_ble`; then on hardware: flash `remapper_picow_ble.uf2`, open COM port, G20s in pairing mode → expect `Adv from …` lines, `Found, connect…`, `Pairing complete, success`, `Ready`, then `REPORT svc=… len=… <bytes>` on button presses.

## Known risks (resolve via CI + hardware)
- BTstack API drift from master (as with Classic) — CI names the exact undefined symbols to fix.
- If the G20s doesn't advertise the HID UUID (0x1812) in its advert/scan-response, `adv_event_contains_hid_service` never matches → the `Adv from …` log will show `hid=0` and we'll match by name/address instead (follow-up).
- If the G20s requires passkey ENTRY (not Just Works), pairing fails → adjust SM IO capabilities (follow-up).
