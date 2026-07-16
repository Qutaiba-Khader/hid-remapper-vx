# Pico W Bluetooth Classic Input — Milestone 0 (PoC + CI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a single Raspberry Pi Pico W, prove we can pair the JX ring over Bluetooth Classic using the onboard radio and read its HID reports — plus stand up a fast Pico-W-only CI build. No USB HID output, no remapper engine yet.

**Architecture:** Add an isolated `remapper_picow` executable target to the existing firmware CMake, built only for `PICO_BOARD=pico_w` so all other builds stay byte-identical. The BT front-end is adapted from BTstack's own `hid_host_demo.c` (vendored in the pico-sdk submodule). A dedicated GitHub Actions workflow builds only this target for ~2–3 min turnaround. Verification is CI-green + on-hardware serial dump (no local firmware build on this machine).

**Tech Stack:** RP2040 + CYW43439 (Pico W), Pico SDK, BTstack (Classic HID host), GitHub Actions.

## Global Constraints

- **Byte-identical stock builds.** The new target must be guarded so the default `cmake ..` and every existing board build produce identical `.uf2`s. Use `if(PICO_BOARD STREQUAL "pico_w") ... endif()`. (CLAUDE.md golden rule #1.)
- **No local firmware build.** This machine has no Pico SDK. Every compile check is via CI; every behavior check is on hardware. (CLAUDE.md rule #3.)
- **No additional hardware.** Single Pico W + USB cable only. Serial output must reach the host over the Pico W's **own USB** (USB-CDC stdio), not a UART adapter.
- **Board:** `PICO_BOARD=pico_w` (RP2040). Pico 2 W is out of scope for M0.
- **Do not modify** `.github/workflows/build-rp2040.yml` or any existing target in `firmware/CMakeLists.txt`.
- **Branch:** all work on `feature/picow-bt-input`.
- **Pairing behavior (baked in at M0):** auto-accept SSP and answer any legacy PIN request with `"0000"` — never require a typed PIN (the ring can't type one).

---

## Task 1: Build pipeline + Pico-W CI + heartbeat firmware

Proves the toolchain, the `pico_w` board, the guarded CMake target, USB-CDC serial output, and the new CI — **before** any Bluetooth complexity. No BTstack yet.

**Files:**
- Create: `firmware/src/remapper_picow.cc`
- Modify: `firmware/CMakeLists.txt` (append a guarded `pico_w` block at end of file, after the `remapper_dual_combined` target ~line 264)
- Create: `.github/workflows/build-picow.yml`

**Interfaces:**
- Produces: executable target `remapper_picow` → artifact `remapper_picow.uf2`. Task 2 replaces the body of `remapper_picow.cc`'s loop and extends the same CMake block + workflow paths.

- [ ] **Step 1: Create the heartbeat firmware**

Create `firmware/src/remapper_picow.cc`:

```cpp
// Milestone 0 scaffold for the Pico W Bluetooth build. Task 1 only proves the
// toolchain, board, USB-CDC serial and CI. Task 2 replaces the heartbeat loop
// with the Bluetooth Classic HID host (bt_host_init / bt_host_task).
#include <stdio.h>

#include "pico/stdlib.h"
#include "pico/cyw43_arch.h"

int main() {
    stdio_init_all();

    // Bring up the CYW43439 (WiFi/BT combo chip). Proves the radio driver links
    // and initialises even though we don't use the radio yet in Task 1.
    if (cyw43_arch_init()) {
        printf("cyw43_arch_init FAILED\n");
        return -1;
    }

    uint32_t n = 0;
    while (true) {
        printf("remapper_picow alive %lu\n", (unsigned long) n++);
        cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, n & 1);  // blink onboard LED
        sleep_ms(1000);
    }
}
```

- [ ] **Step 2: Add the guarded target to CMake**

Append to the very end of `firmware/CMakeLists.txt`:

```cmake
# --- Pico W Bluetooth Classic build (opt-in, isolated). Only configured when
# PICO_BOARD=pico_w, so the default `cmake ..` and every other board build stay
# byte-identical (golden rule #1). Task 1 is a heartbeat that proves toolchain +
# CYW43 + USB-CDC serial + CI. Task 2 adds BTstack HID host (bt_host + config). ---
if(PICO_BOARD STREQUAL "pico_w")
    add_executable(remapper_picow
        src/remapper_picow.cc
    )
    target_link_libraries(remapper_picow
        pico_stdlib
        pico_cyw43_arch_none
    )
    # Serial over the Pico W's own USB (no UART adapter / no extra hardware).
    pico_enable_stdio_usb(remapper_picow 1)
    pico_enable_stdio_uart(remapper_picow 0)
    pico_add_extra_outputs(remapper_picow)
endif()
```

- [ ] **Step 3: Create the Pico-W-only CI workflow**

Create `.github/workflows/build-picow.yml`:

```yaml
name: build-picow
on:
  push:
    branches:
      - feature/picow-bt-input
    paths:
      - 'firmware/src/remapper_picow.cc'
      - 'firmware/src/bt_host.c'
      - 'firmware/src/bt_host.h'
      - 'firmware/src/btstack_config.h'
      - 'firmware/CMakeLists.txt'
      - '.github/workflows/build-picow.yml'
  workflow_dispatch:
defaults:
  run:
    shell: bash --noprofile --norc -x -e -o pipefail {0}
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive   # pico-sdk's btstack + cyw43 are nested submodules
      - name: Install compiler and tools
        run: |
          sudo apt update
          sudo apt install -y --no-install-recommends gcc-arm-none-eabi libnewlib-arm-none-eabi libstdc++-arm-none-eabi-newlib srecord
      - name: Build remapper_picow
        working-directory: ./firmware
        run: |
          mkdir build-picow
          cd build-picow
          PICO_BOARD=pico_w cmake ..
          make -j$(nproc) remapper_picow
          cd ..
          mkdir -p artifacts
          mv build-picow/remapper_picow.uf2 artifacts/remapper_picow.uf2
      - name: Verify artifact
        run: |
          ls -la firmware/artifacts/
          test -f firmware/artifacts/remapper_picow.uf2
      - uses: actions/upload-artifact@v4
        with:
          name: remapper_picow-uf2
          path: firmware/artifacts/remapper_picow.uf2
```

- [ ] **Step 4: Commit**

```bash
git add firmware/src/remapper_picow.cc firmware/CMakeLists.txt .github/workflows/build-picow.yml
git commit -m "feat(picow): heartbeat firmware + Pico-W-only CI (M0 task 1)"
```

- [ ] **Step 5: Push and watch CI**

```bash
git push -u origin feature/picow-bt-input
gh run watch "$(gh run list --workflow=build-picow.yml -L1 --json databaseId --jq '.[0].databaseId')" --exit-status
```
Expected: workflow **succeeds**, and the "Verify artifact" step lists `remapper_picow.uf2`. If `cmake` fails with a missing `pico_w` board or missing CYW43 support, the pico-sdk submodule wasn't checked out recursively — confirm `submodules: recursive` and that `firmware/pico-sdk` populated.

- [ ] **Step 6 (hardware, optional but recommended): Flash and confirm serial**

Download the `remapper_picow-uf2` artifact from the run. Hold BOOTSEL, plug in the Pico W, drop `remapper_picow.uf2` on the `RPI-RP2` drive. Open the new USB serial port (e.g. PuTTY / `screen`) at any baud.
Expected: `remapper_picow alive 0`, `1`, `2`… once per second and the onboard LED blinking. This confirms USB-CDC serial works with no extra hardware — the channel M0's report dump will use.

---

## Task 2: Bluetooth Classic HID host — pair + dump reports

Adds BTstack, connects to the ring over Classic BT, and prints its HID reports over the USB serial proven in Task 1.

**Files:**
- Create: `firmware/src/btstack_config.h`
- Create: `firmware/src/bt_host.c`, `firmware/src/bt_host.h`
- Modify: `firmware/src/remapper_picow.cc` (call the BT host instead of the heartbeat)
- Modify: `firmware/CMakeLists.txt` (extend the `pico_w` block: add BTstack libs, the config include dir, and `bt_host.c`)

**Interfaces:**
- `bt_host.h` produces:
  - `void bt_host_init(void);` — initialises cyw43, configures BTstack Classic + HID host, sets auto-pairing, powers the radio on, and starts inquiry.
  - `void bt_host_run(void);` — runs the BTstack loop (does not return). Called from `main()`.
- Consumes from Task 1: the `remapper_picow` target and its CI paths (already include `bt_host.*` and `btstack_config.h`).

- [ ] **Step 1: Create the BTstack config**

Create `firmware/src/btstack_config.h` (Classic-only; `ENABLE_CLASSIC` is supplied by the `pico_btstack_classic` lib; we intentionally omit `HAVE_BTSTACK_STDIN` because the PoC auto-pairs with no typed commands):

```c
#ifndef _PICO_BTSTACK_BTSTACK_CONFIG_H
#define _PICO_BTSTACK_BTSTACK_CONFIG_H

#define ENABLE_LOG_INFO
#define ENABLE_LOG_ERROR
#define ENABLE_PRINTF_HEXDUMP

#ifdef ENABLE_CLASSIC
#define ENABLE_L2CAP_ENHANCED_RETRANSMISSION_MODE
#endif

// buffers / sizes
#define HCI_OUTGOING_PRE_BUFFER_SIZE 4
#define HCI_ACL_PAYLOAD_SIZE (1691 + 4)
#define HCI_ACL_CHUNK_SIZE_ALIGNMENT 4
#define MAX_NR_BTSTACK_LINK_KEY_DB_MEMORY_ENTRIES 2
#define MAX_NR_HCI_CONNECTIONS 1
#define MAX_NR_HID_HOST_CONNECTIONS 1
#define MAX_NR_L2CAP_CHANNELS 4
#define MAX_NR_L2CAP_SERVICES 3
#define MAX_NR_SERVICE_RECORD_ITEMS 4

// avoid cyw43 shared-bus overrun
#define MAX_NR_CONTROLLER_ACL_BUFFERS 3
#define MAX_NR_CONTROLLER_SCO_PACKETS 3
#define ENABLE_HCI_CONTROLLER_TO_HOST_FLOW_CONTROL
#define HCI_HOST_ACL_PACKET_LEN 1024
#define HCI_HOST_ACL_PACKET_NUM 3
#define HCI_HOST_SCO_PACKET_LEN 120
#define HCI_HOST_SCO_PACKET_NUM 3

// link-key DB in flash (remember the ring across reboots)
#define NVM_NUM_DEVICE_DB_ENTRIES 16
#define NVM_NUM_LINK_KEYS 16

#define HAVE_EMBEDDED_TIME_MS
#define HAVE_ASSERT
#define HCI_RESET_RESEND_TIMEOUT_MS 1000
#define ENABLE_SOFTWARE_AES128

#endif // _PICO_BTSTACK_BTSTACK_CONFIG_H
```

- [ ] **Step 2: Create the BT host — vendor the known-good example, then edit**

> Rationale: `hid_host_demo.c` is ~400 lines of BTstack that ships **compiled-and-tested** in the SDK. Reproducing it by hand is less accurate than starting from it. So the implementation is: copy the canonical file, then apply the four explicit edits below. This keeps the authored delta small and reviewable.

Copy `firmware/pico-sdk/lib/btstack/example/hid_host_demo.c` to `firmware/src/bt_host.c`. Then apply these edits:

**Edit A — header + public entry points.** At the top, add `#include "bt_host.h"`. Rename the example's `int btstack_main(int argc, const char * argv[])` (or `int main(void)`) to `void bt_host_init(void)`; delete its `argc/argv` usage and its final `return 0;`. Move the trailing `btstack_run_loop_execute();` call OUT of init into a new function:

```c
void bt_host_run(void) {
    btstack_run_loop_execute();
}
```

**Edit B — remove the stdin command console.** Delete the `#include "btstack_stdin.h"`, the `stdin_process(...)` function, and the `btstack_stdin_setup(stdin_process);` call. Instead, start scanning automatically at the end of `bt_host_init()`:

```c
    // auto-start: look for the device to pair with (no typed commands)
    gap_inquiry_start(INQUIRY_INTERVAL);
```
(`INQUIRY_INTERVAL` is already defined in the example, typically `5`.)

**Edit C — auto-accept pairing (this is the fix for the ring).** In `bt_host_init()`, after `gap_set_security_level(...)` / before `hci_power_control(HCI_POWER_ON);`, add:

```c
    gap_ssp_set_io_capability(SSP_IO_CAPABILITY_NO_INPUT_NO_OUTPUT);
    gap_ssp_set_auto_accept(true);
```
And in the packet handler's `switch (hci_event_packet_get_type(packet))`, add a case so a legacy-PIN device (some rings) pairs with a fixed PIN instead of stalling:

```c
        case HCI_EVENT_PIN_CODE_REQUEST: {
            bd_addr_t addr;
            hci_event_pin_code_request_get_bd_addr(packet, addr);
            gap_pin_code_response(addr, "0000");
            break;
        }
```

**Edit D — print received reports.** The example already handles `HID_SUBEVENT_REPORT` and calls `hid_host_report()` / `printf` on the data. Ensure that case prints the raw bytes so we can see the ring's input (keep or add):

```c
        case HID_SUBEVENT_REPORT:
            printf("REPORT len=%u:", hid_subevent_report_get_report_len(packet));
            printf_hexdump(hid_subevent_report_get_report(packet),
                           hid_subevent_report_get_report_len(packet));
            break;
```

Create `firmware/src/bt_host.h`:

```c
#ifndef BT_HOST_H
#define BT_HOST_H

#ifdef __cplusplus
extern "C" {
#endif

// Init cyw43 + BTstack Classic HID host, auto-accept pairing, power on, start
// inquiry. Prints received HID reports over stdio. Does not block.
void bt_host_init(void);

// Run the BTstack run loop. Does not return.
void bt_host_run(void);

#ifdef __cplusplus
}
#endif

#endif // BT_HOST_H
```

- [ ] **Step 3: Wire the BT host into main**

Replace the body of `firmware/src/remapper_picow.cc` with:

```cpp
// Milestone 0: Bluetooth Classic HID host PoC. Pairs the ring and dumps its
// HID reports over USB-CDC serial. No USB HID output / no engine yet (M1+).
#include <stdio.h>

#include "pico/stdlib.h"
#include "bt_host.h"

int main() {
    stdio_init_all();
    sleep_ms(2000);  // give the USB serial host time to attach before logs start
    printf("remapper_picow: starting Bluetooth Classic HID host\n");

    bt_host_init();  // inits cyw43 + BTstack; do NOT call cyw43_arch_init() here too
    bt_host_run();   // runs the BTstack loop forever
    return 0;
}
```
Note: `bt_host_init()` performs the cyw43 bring-up (the example calls `cyw43_arch_init()` internally), so `main()` must not call it again.

- [ ] **Step 4: Extend the CMake `pico_w` block**

In `firmware/CMakeLists.txt`, edit the `if(PICO_BOARD STREQUAL "pico_w")` block from Task 1 to add the BT source, BTstack libs, and the config include dir:

```cmake
if(PICO_BOARD STREQUAL "pico_w")
    add_executable(remapper_picow
        src/remapper_picow.cc
        src/bt_host.c
    )
    target_include_directories(remapper_picow PRIVATE src)  # finds btstack_config.h
    target_link_libraries(remapper_picow
        pico_stdlib
        pico_cyw43_arch_none
        pico_btstack_cyw43
        pico_btstack_classic
    )
    pico_enable_stdio_usb(remapper_picow 1)
    pico_enable_stdio_uart(remapper_picow 0)
    pico_add_extra_outputs(remapper_picow)
endif()
```

- [ ] **Step 5: Commit**

```bash
git add firmware/src/btstack_config.h firmware/src/bt_host.c firmware/src/bt_host.h firmware/src/remapper_picow.cc firmware/CMakeLists.txt
git commit -m "feat(picow): Bluetooth Classic HID host pair+dump PoC (M0 task 2)"
```

- [ ] **Step 6: Push and watch CI**

```bash
git push
gh run watch "$(gh run list --workflow=build-picow.yml -L1 --json databaseId --jq '.[0].databaseId')" --exit-status
```
Expected: workflow **succeeds**, artifact `remapper_picow.uf2` produced. Common failures & fixes:
- `btstack_config.h not found` → the `target_include_directories(... src)` line is missing.
- undefined `hid_host_*` / `gap_inquiry_start` → `pico_btstack_classic` not linked (it provides the HID host), or an edit removed a needed include (`btstack.h`).
- `pico_btstack_*` unknown → pico-sdk submodule too old or btstack sub-submodule not initialised (`submodules: recursive`).

- [ ] **Step 7 (hardware): Pair the ring and dump reports — the M0 success gate**

1. Download `remapper_picow.uf2` from the successful run; flash it (BOOTSEL → drop on `RPI-RP2`).
2. Open the Pico W's USB serial port. Expect `remapper_picow: starting Bluetooth Classic HID host`.
3. Put the JX ring in pairing mode.
4. Expected: inquiry finds the ring, it pairs **without any typed PIN**, connection opens, and pressing ring buttons prints `REPORT len=… ..bytes..` lines.

**M0 is done when ring button presses produce `REPORT` lines over USB serial.** That proves the Pico W pairs the Classic ring on its onboard radio and can read its HID reports — the one unknown the whole effort hinged on. If pairing succeeds but no `REPORT` appears, capture the serial log (connection events) for M1 triage. If inquiry never finds the ring, note its Bluetooth device class from the log for a targeted connect in M1.

---

## Self-review (against the spec)

- **Spec "New files bt_host + remapper_picow + btstack_config.h"** → Tasks 1–2 create all three. ✓
- **Spec "isolated target, stock builds byte-identical"** → guarded `if(PICO_BOARD STREQUAL "pico_w")`; no existing target or `build-rp2040.yml` touched. ✓
- **Spec "auto-accept SSP, no typed PIN"** → Task 2 Edit C. ✓
- **Spec "fast Pico-W-only CI"** → Task 1 Step 3 `build-picow.yml`, single target. ✓
- **Spec "poll-mode cyw43 for M0"** → `pico_cyw43_arch_none` (BTstack drives its own run loop). ✓
- **Spec "verify via CI + on-hardware serial"** → every task ends with `gh run watch` + a hardware check. ✓
- **Spec M0 success = "see report bytes in a serial terminal"** → Task 2 Step 7 gate. ✓
- Type consistency: `bt_host_init()` / `bt_host_run()` names match between `bt_host.h`, `bt_host.c` edits, and `remapper_picow.cc`. ✓
- Known open point (acceptable for a PoC, flagged not hidden): the exact `HID_SUBEVENT_REPORT` accessor names come from the vendored example and SDK headers; Task 2 Step 6 lists the exact link/compile errors to expect if a name differs, so the implementer resolves them against the real headers rather than guessing.
