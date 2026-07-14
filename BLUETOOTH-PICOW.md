# Bluetooth input on a Pico W

A **Pico W** takes its input from a **BLE HID device** — a keyboard, a mouse, a TV remote — instead of
a USB cable. The reports run through hid-remapper's **full mapping engine** and out to the PC as an
ordinary **USB HID device**, configurable from the same WebHID tool as every other build.

> The PC sees a **HID Remapper**, not your remote. That is the point: if it passed the remote's own
> descriptor straight through, there would be nothing to remap.

**Firmware:** `remapper_picow_ble.uf2` — config tool → **Actions → Bluetooth**.
**Source:** branch `feature/picow-bt-input` (**not merged into master**).

---

## How it behaves

| | |
| --- | --- |
| **Paired already** | **Auto-connects to that device. Always.** It will **never** bond with anything else. |
| Paired device off / out of range | Keeps retrying *that* device. Still won't touch anything else. |
| **Nothing paired yet** | Pairable — this is first-time setup. |
| **Pair new device** (config tool) | Forgets the old one and opens a **3-minute** pairing window. |

The build has **no serial output** (`CFG_TUD_CDC 0` — it is a HID device now), so the onboard **LED is
the only status channel**:

| LED | Meaning |
| --- | --- |
| **solid** | connected — reports flowing |
| **fast blink** | connecting / pairing |
| **double blink** (blink-blink … pause) | **pairing window open** — your button press landed |
| **slow blink** | idle, or retrying a paired device that isn't answering |

### The thing that will waste your evening

**A BLE HID device serves its HID service to ONE bonded host.** If your remote is still paired to a TV
or a phone, it will happily accept the connection, complete pairing, and then **refuse to hand over
its HID service** — you get a connection that goes nowhere. **Re-pair the remote.**

This is a property of the remote, not a bug in the firmware. It was verified the hard way: a
third-party Pico W BLE bridge that is known to work also failed on the same remote, in the same way.

**Corollary: never "fix" it by deleting the bond on our side only.** The remote keeps *its* key, so it
thinks it still knows us — it accepts the link, refuses to re-pair *and* refuses to serve GATT. That
half-bond deadlock is unrecoverable in firmware, and it is what breaks other people's working
firmware too. `Clear bonds` in the config tool clears **our** side; re-pair the remote as well.

---

## Architecture

```
  BLE remote ──BLE──▶  core 1: BTstack (HID-over-GATT host)
                              │
                              │  src/ble/ble_bridge.c   ← the ONLY shared memory
                              ▼
                       core 0: hid-remapper engine + TinyUSB DEVICE  ──USB──▶ PC
```

- **core 1** runs BTstack. `btstack_run_loop_execute()` **never returns** — which is exactly why it
  gets a core to itself.
- **core 0** runs hid-remapper's existing `main()`, unchanged.
- They meet **only** in `ble_bridge.c`: a lock-free single-producer/single-consumer ring for reports
  (core 1 must never block — stall BTstack's run loop and the Bluetooth link drops), plus a
  **spinlocked** request/status channel.

A BLE device enters the engine through the **same two calls a wired USB device makes**:

```c
descriptor_received_callback(...);  // teaches the engine what the remote's bytes MEAN
handle_received_report(...);        // each report
```

Everything downstream — layers, macros, expressions, quirks, the Monitor, the config tool — is then
identical to a USB device, because it *is* the same path.

---

## Landmines (all of these are real; each one cost a debugging session)

1. **Flash collision — defused, keep it that way.** hid-remapper's config lives in the **last flash
   sector**; the pico-sdk's BTstack bond storage **defaults to the last 8 KB — on top of it**. Left
   alone, **every "Save to device" wipes your pairing and every pairing corrupts your config** (bad
   CRC → silently reverts to defaults, every mapping gone, no error). The bond bank is pinned *below*
   the config sector and `remapper_picow_ble.cc` **`static_assert`s** that they cannot intersect.
2. **Both cores execute from flash** (the image is far too large for `copy_to_ram`), and erasing flash
   disables execution-from-flash. Any flash write **must** `multicore_lockout` the other core first,
   or it dies mid-instruction-fetch. `do_persist_config()` does this.
3. **Never read the BOOTSEL button.** Reading it means driving the flash **chip-select** pin as a
   GPIO — and core 1 is executing from flash. It bricks the board instantly (no USB, no Bluetooth).
   The pico-examples trick is safe only in a single-core program.
4. **A device with no bond MUST be pairable.** Gating that buys no security whatsoever (a device with
   no bond has nothing to protect) and breaks first-time setup completely.
5. **`MAX_NR_HIDS_CLIENTS` must be defined** in `src/ble/btstack_config.h`. BTstack allocates its
   HID-over-GATT client from a static pool sized by it; without it the pool is **zero entries**,
   `hids_client_connect()` fails with out-of-memory **before any discovery**, and if you discard the
   return value it dies in total silence. This was the original blocker.
6. **Call `sm_set_authentication_requirements()` exactly ONCE.** A stray second call silently
   overwrites the first and drops `SM_AUTHREQ_SECURE_CONNECTION`, so you pair with legacy security —
   and the remote then refuses to serve its HID characteristics.
7. **`src/ble` must come FIRST in the include path.** There are **two** `btstack_config.h` (Classic in
   `src/`, BLE in `src/ble/`). Get the order wrong and BTstack compiles against the Classic one,
   failing with `'hci_stack_t' has no member named 'le_advertisements_state'` — which reads like a
   version mismatch and is nothing of the sort.
8. **A device's Classic BD_ADDR is NOT its BLE address.** On the test remote they differ, and the
   Classic address turned out to belong to a *television* over BLE. **Identify by advertised NAME.**
9. **Do not filter scan results on the advertised HID UUID.** Real remotes send bare adverts most of
   the time and only occasionally include the UUID (and their name). Filtering on it is why scanning
   used to take forever.

---

## Not done yet

- **`build-picow` is not in master's release pipeline.** The `.uf2` on `r2026-07-06` was uploaded by
  hand. `release.yml` is prepped for it on the branch. When it lands, delete the whitelist entry in
  `config-tool-web-v2/tests/firmware-links.test.js` so the link is checked like every other file.
- **No device picker in the web tool.** The firmware can already connect by address
  (`-DBLE_TARGET_ADDR=…`) and logs `name + address + RSSI` for every advertiser — the tool just needs
  to show the list and let you pick.
