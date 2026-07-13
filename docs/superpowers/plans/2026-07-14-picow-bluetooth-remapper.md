# Pico W Bluetooth Remapper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A Pico W that takes input from a **Bluetooth (BLE) HID device**, runs it through
hid-remapper's **full mapping engine** (layers, macros, expressions, quirks), and presents itself to
the PC as a **USB HID device** — configurable from the existing WebHID tool, exactly like the wired
build.

**Architecture:** BTstack owns **core 1**; hid-remapper's existing `main()` owns **core 0**. BLE
reports cross to core 0 through a small queue and enter the engine through the two functions a wired
USB device already uses. Nothing about the engine changes.

**Tech Stack:** Pico SDK, BTstack (`pico_btstack_ble` + `pico_btstack_cyw43`), TinyUSB **device**,
hid-remapper's C++ engine.

---

## Why this is now tractable

Everything risky has already been answered on hardware:

- **BLE HID host works on a Pico W with this remote.** `feature/picow-bt-input` streams keyboard,
  air-mouse and consumer reports from a G20S PRO, and the link is stable.
- **BLE + USB device coexist on a Pico W.** `shiomachisoft/picow_ble_usb_hid_bridge` does exactly
  this — `multicore_launch_core1(ble_host_main)` for BLE, `tud_task()` on core 0 — and the owner
  confirmed **that binary passes his remote through to USB correctly**.
- **hid-remapper never uses core 1.** `grep multicore firmware/src/*.cc` → nothing. Core 1 is free.

**Note the deliberate difference from the reference repo.** It passes the BLE device's HID report
descriptor *straight through* to the PC, so the PC sees a G20S. **We do the opposite**: the BLE
device's descriptor is registered as *their* descriptor (the input side), and the PC sees
hid-remapper's *own* emulated descriptor (the output side). That is the entire point — otherwise
there is nothing to remap.

---

## Global Constraints

- **`master` and the released firmware are not touched.** All work on `feature/picow-bt-input`.
- **Firmware does not build on this machine.** CI is the only compile gate (`gh run watch --exit-status`).
  Only `build-picow` runs on this branch (the other two are excluded there).
- **Never auto-delete a BLE bond.** Deleting our LTK while the remote keeps its own leaves a
  **half bond**: the remote thinks it knows us, accepts the link, refuses to re-pair *and* refuses to
  serve GATT. It is unrecoverable in firmware and it broke the reference binary on this remote too.
- The remote is the constraint, not the code: **a BLE HID device serves its HID service to ONE bonded
  host.** If it is still paired to a TV, it must be re-paired. No firmware fixes that.

---

## THE LANDMINE — fix this first (Task 1)

**hid-remapper's config and BTstack's bond storage both live at the end of flash.**

```
firmware/src/main.cc:44   (RP2040)
    CONFIG_OFFSET_IN_FLASH = PICO_FLASH_SIZE_BYTES - PERSISTED_CONFIG_SIZE   // = END - 4096

pico-sdk btstack TLV (pico_flash_bank), default
    PICO_FLASH_BANK_STORAGE_OFFSET = PICO_FLASH_SIZE_BYTES - PICO_FLASH_BANK_TOTAL_SIZE  // = END - 8192
    PICO_FLASH_BANK_TOTAL_SIZE     = 8192
```

On a 2 MB Pico W:

```
config  : 0x1FF000 – 0x200000   (last 4 KB sector)
BT bonds: 0x1FE000 – 0x200000   (last 8 KB)   <-- the config sector is INSIDE this
```

Flash erases a whole sector. So **every "Save to device" wipes your pairing, and every pairing
corrupts your config** (CRC fails → the device silently reverts to defaults; all mappings gone). The
two features would destroy each other forever; a backup does not help, because restoring the config
unpairs the remote again.

**This is NOT yet verified** — the `pico-sdk` submodule is not checked out on this machine, so the
SDK's actual defaults could not be read. **Verify before writing any other code.**

---

## File Structure

| File | Responsibility |
| --- | --- |
| `firmware/src/ble/ble_host.c` (modify) | On HID-service-connected, hand the BLE device's report descriptor to the bridge. On each report, push it to the bridge. Stop printing them. |
| `firmware/src/ble/ble_bridge.h/.c` (**create**) | The core1→core0 boundary. A lock-free SPSC ring of reports + a "descriptor ready" latch. The ONLY thing both cores touch. |
| `firmware/src/remapper_picow_ble.cc` (rewrite) | The entry point: launch BLE on core 1, then fall into hid-remapper's `main()`. Supplies the board hooks. |
| `firmware/CMakeLists.txt` (modify) | `remapper_picow_ble` links the whole engine + TinyUSB device + BTstack, and pins the flash bank offset. |

---

### Task 1: The flash collision (do this before anything else)

**Files:** Modify `firmware/CMakeLists.txt`

- [ ] **Step 1: Verify the SDK default.** With submodules checked out:

```bash
grep -rn "PICO_FLASH_BANK_STORAGE_OFFSET\|PICO_FLASH_BANK_TOTAL_SIZE" firmware/pico-sdk/src/rp2_common/pico_btstack/
```

Expected: offset defaults to `PICO_FLASH_SIZE_BYTES - PICO_FLASH_BANK_TOTAL_SIZE`, size 8192.
**If it does not overlap the config sector, stop and re-derive — do not "fix" a non-problem.**

- [ ] **Step 2: Pin the bank below the config sector**, in the `remapper_picow_ble` target:

```cmake
# hid-remapper keeps its config in the LAST flash sector (main.cc CONFIG_OFFSET_IN_FLASH).
# BTstack's bond storage defaults to the last 8K -- straight on top of it. Every Save would
# wipe the pairing and every pair would corrupt the config. Put the bonds BELOW the config.
target_compile_definitions(remapper_picow_ble PRIVATE
    PICO_FLASH_BANK_TOTAL_SIZE=8192
    PICO_FLASH_BANK_STORAGE_OFFSET=$<TARGET_PROPERTY:PICO_FLASH_SIZE_BYTES>-4096-8192
)
```
(If the generator expression is awkward, compute it in CMake from `PICO_FLASH_SIZE_BYTES`.)

- [ ] **Step 3: Prove it.** Add a `static_assert` in `remapper_picow_ble.cc` that the bond region and
      `[CONFIG_OFFSET_IN_FLASH, +PERSISTED_CONFIG_SIZE)` do not intersect. A compile-time failure is
      the only guarantee that a later refactor cannot silently re-introduce this.
- [ ] **Step 4: Commit.**

### Task 2: The bridge (core 1 → core 0)

**Files:** Create `firmware/src/ble/ble_bridge.h`, `firmware/src/ble/ble_bridge.c`

**Interfaces:**
- Produces: `ble_bridge_push_report(const uint8_t*, uint16_t)`, `ble_bridge_set_descriptor(const uint8_t*, uint16_t)` (called on **core 1**)
- Produces: `bool ble_bridge_pop_report(uint8_t* out, uint16_t* len)`, `const uint8_t* ble_bridge_take_descriptor(uint16_t* len)` (called on **core 0**)

- [ ] **Step 1:** Single-producer/single-consumer ring, power-of-two slots (16 × 64 bytes is ample —
      a G20S report is ≤ 9 bytes). Head/tail as `volatile uint32_t`; no locks, no malloc.
      **A full ring must DROP the oldest and count the drop** — never block core 1, and never
      silently lose reports without a counter.
- [ ] **Step 2:** The descriptor is latched once with a `volatile bool ready` flag; core 0 takes it
      and clears the flag.
- [ ] **Step 3:** Commit.

### Task 3: Feed the engine

**Files:** Modify `firmware/src/ble/ble_host.c`

- [ ] **Step 1:** In `GATTSERVICE_SUBEVENT_HID_SERVICE_CONNECTED` (status success), fetch the report
      descriptor and hand it to the bridge:

```c
uint16_t dlen = hids_client_descriptor_storage_get_descriptor_len(hids_cid, 0);
const uint8_t * d = hids_client_descriptor_storage_get_descriptor_data(hids_cid, 0);
ble_bridge_set_descriptor(d, dlen);
```

- [ ] **Step 2:** In `GATTSERVICE_SUBEVENT_HID_REPORT`, replace the `printf` with
      `ble_bridge_push_report(report, len)`.
- [ ] **Step 3:** Commit. (BLE-only build still compiles; nothing consumes the bridge yet.)

### Task 4: The new entry point

**Files:** Rewrite `firmware/src/remapper_picow_ble.cc`

The board hooks a target must supply (see `remapper_single.cc`): `extra_init()`,
`get_gpio_valid_pins_mask()`, `read_report(bool* new_report, bool* tick)`,
`interval_override_updated()`, `flash_b_side()`, `descriptor_received_callback(...)`.

- [ ] **Step 1:** `extra_init()` → `multicore_launch_core1(ble_host_main)` where `ble_host_main()` is
      `ble_host_init(); ble_host_run();` (that call never returns — which is exactly why it needs its
      own core).
- [ ] **Step 2:** `read_report(new_report, tick)`:
```c
void read_report(bool* new_report, bool* tick) {
    *tick = get_and_clear_tick();          // the existing 1ms USB SOF tick
    *new_report = false;

    uint16_t dlen;
    const uint8_t* desc = ble_bridge_take_descriptor(&dlen);
    if (desc != NULL) {
        // The BLE device's report descriptor becomes THEIR descriptor: this is what teaches the
        // engine what the remote's bytes mean. (We still emit OUR OWN descriptor to the PC.)
        descriptor_received_callback(vid, pid, desc, dlen, /*interface*/ 0, /*hub_port*/ 0, /*itf_num*/ 0);
    }

    uint8_t buf[64]; uint16_t len;
    while (ble_bridge_pop_report(buf, &len)) {
        handle_received_report(buf, len, /*interface*/ 0);
        *new_report = true;
    }
}
```
- [ ] **Step 3:** `flash_b_side()` and the GPIO mask: no-ops / the Pico W's valid mask.
- [ ] **Step 4:** Commit.

### Task 5: Link the engine

**Files:** Modify `firmware/CMakeLists.txt`

- [ ] **Step 1:** Give `remapper_picow_ble` the same source list as `remapper` (`main.cc`,
      `remapper.cc`, `config.cc`, `descriptor_parser.cc`, `our_descriptor.cc`, `out_report.cc`,
      `crc.c`, `globals.cc`, …) **plus** `ble/ble_host.c` and `ble/ble_bridge.c`, and link
      `tinyusb_device`, `pico_multicore`, `pico_btstack_ble`, `pico_btstack_cyw43`,
      `pico_cyw43_arch_none`.
- [ ] **Step 2:** Push, watch CI (`gh run watch <id> --exit-status`). **CI is the only compile gate.**
- [ ] **Step 3:** Commit.

### Task 6: Hardware bring-up

- [ ] Flash. The PC must enumerate a **HID Remapper** (not a G20S). The WebHID tool must open it and
      `Load from device` must succeed.
- [ ] The Monitor tab must show the remote's usages live — that alone proves descriptor + reports +
      engine are all wired.
- [ ] Map something (e.g. D-pad Up → `A`) and confirm the PC receives `A`, not Up.
- [ ] **Save, power-cycle, and confirm BOTH the config AND the pairing survived.** This is the
      Task 1 landmine; if either is lost, Task 1 is wrong.

### Task 7: The pairing stubs

**Files:** Modify `firmware/src/remapper_picow_ble.cc` (or `ble_host.c`)

`pair_new_device()` and `clear_bonds()` are **empty stubs** in `firmware/src/main.cc` (real ones exist
only for nRF52840). The config commands (12/13) and the web tool's buttons already exist.

- [ ] `clear_bonds()` → `ble_forget_device()` for every bond (it is already written, currently marked
      unused) + drop the `TLV_TAG_HOGD` tag.
- [ ] `pair_new_device()` → forget the current device and restart scanning.
- [ ] **Warn the user in the tool**: clearing bonds on our side does NOT clear them on the remote.
      Re-pair the remote too, or you create the half-bond deadlock described above.

### Task 8 (later): the device picker

The firmware can already connect **by address** (`BLE_TARGET_ADDR`, and a `workflow_dispatch` input) and
already logs `name + address + RSSI` for every advertiser. The web tool should stream that scan list
up and let the user pick — the address then just gets set at runtime. **Do not filter on the
advertised HID UUID:** a real remote sends bare adverts most of the time and only occasionally one
carrying the UUID, so that filter is the reason scanning used to take forever.

---

## Risks

1. **The flash collision (Task 1).** The only one that can silently destroy user data. Compile-time
   assert it.
2. **Cross-core report loss.** A full ring must drop-and-count, never block core 1 (BTstack's run loop
   must not stall) and never lose reports silently.
3. **BLE HID descriptors are not USB HID descriptors.** They are close, but a BLE report descriptor
   may reference report IDs the engine has not seen. `parse_descriptor()` is the same parser the wired
   path uses, so this should be fine — but verify with the Monitor before believing it.
4. **The remote, again.** If HID discovery stalls, it is almost certainly a bond/pairing state on the
   remote, not our code. Do not "fix" it by deleting bonds.
