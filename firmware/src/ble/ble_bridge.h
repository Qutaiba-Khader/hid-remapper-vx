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

// Must be called on core 0 BEFORE core 1 is launched (claims the spinlock the request channel uses).
void ble_bridge_init(void);

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

/* ---- core 0 -> core 1 REQUESTS (the other direction) ----
 *
 * The config tool's "Pair new device" and "Clear bonds" buttons arrive on core 0 as config
 * commands 12/13. BTstack lives on core 1 and must only be touched from there, so core 0 just
 * raises a flag and core 1 picks it up in its run loop.
 */
#define BLE_REQ_PAIR_NEW    (1u << 0)
#define BLE_REQ_CLEAR_BONDS (1u << 1)

// core 0: ask core 1 to do something. Never blocks.
void ble_bridge_request(uint32_t req);

// core 1: collect and clear whatever core 0 asked for.
uint32_t ble_bridge_take_requests(void);

/* ---- connection status, for the config tool ---- */
typedef struct {
    uint8_t connected;    // 1 = a BLE device is connected AND its HID service is up
    uint8_t addr[6];      // the remote's BLE address
    char name[32];        // its advertised name, if we saw one
} ble_status_t;

void ble_bridge_set_status(const ble_status_t* st);  // core 1
void ble_bridge_get_status(ble_status_t* out);       // core 0

#ifdef __cplusplus
}
#endif

#endif
