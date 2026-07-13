#ifndef BLE_BRIDGE_H
#define BLE_BRIDGE_H

/* The core1 -> core0 boundary, and the ONLY memory both cores touch.
 *
 * BTstack's run loop never returns, so it owns CORE 1 (this is exactly what
 * shiomachisoft/picow_ble_usb_hid_bridge does, and it is proven on this hardware).
 * hid-remapper's engine + TinyUSB device own CORE 0, unchanged.
 *
 * Core 1 (BLE)  : ble_bridge_push_report() / ble_bridge_set_descriptor()
 * Core 0 (engine): ble_bridge_pop_report()  / ble_bridge_take_descriptor()
 *
 * Single producer, single consumer, no locks, no malloc. Core 1 must NEVER block -- stalling
 * BTstack's run loop drops the Bluetooth link.
 */

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BLE_BRIDGE_MAX_REPORT_LEN 64

/* ---- core 1 (BLE) ---- */

// Hand over the BLE device's HID REPORT DESCRIPTOR. Latched; core 0 picks it up once.
void ble_bridge_set_descriptor(const uint8_t* data, uint16_t len);

// Push one HID report. Never blocks. If the ring is full the OLDEST report is dropped and
// the drop is COUNTED -- a silently lost input is a bug you can never find.
void ble_bridge_push_report(const uint8_t* data, uint16_t len);

// The remote went away: core 0 should tear down its "their descriptor" state.
void ble_bridge_set_disconnected(void);

/* ---- core 0 (engine) ---- */

// Returns the latched descriptor exactly once, then NULL until a new one arrives.
const uint8_t* ble_bridge_take_descriptor(uint16_t* len);

// Pop one report. Returns false when the ring is empty. `out` must be >= BLE_BRIDGE_MAX_REPORT_LEN.
bool ble_bridge_pop_report(uint8_t* out, uint16_t* len);

// True exactly once after the remote disconnects.
bool ble_bridge_take_disconnected(void);

// How many reports we had to drop because core 0 was not draining fast enough. Should stay 0.
uint32_t ble_bridge_dropped(void);

#ifdef __cplusplus
}
#endif

#endif
