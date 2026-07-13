#include "ble_bridge.h"

#include <string.h>

/* A power-of-two SPSC ring. Core 1 (BLE) writes, core 0 (engine) reads.
 *
 * No mutex on purpose: core 1 is BTstack's run loop and it must never block -- stall it and the
 * Bluetooth link drops. With one producer and one consumer, a ring with volatile head/tail and
 * power-of-two masking is safe without locks: each side only ever advances its own index, and
 * each index is a single aligned 32-bit word (atomic on Cortex-M0+).
 */

#define RING_SLOTS 16u  // power of two. A G20S report is <= 9 bytes; 16 slots is a big margin.
#define RING_MASK  (RING_SLOTS - 1u)

typedef struct {
    uint8_t data[BLE_BRIDGE_MAX_REPORT_LEN];
    uint16_t len;
} slot_t;

static slot_t ring[RING_SLOTS];
static volatile uint32_t head;  // written by core 1 only
static volatile uint32_t tail;  // written by core 0 only
static volatile uint32_t dropped;

// The HID report descriptor of the connected BLE device. Written once by core 1, taken once by
// core 0. `desc_ready` is the handshake and MUST be set last (after the bytes are in memory).
static uint8_t desc[512];
static volatile uint16_t desc_len;
static volatile bool desc_ready;

static volatile bool disconnected;

/* ================= core 1 (BLE) ================= */

void ble_bridge_set_descriptor(const uint8_t* data, uint16_t len) {
    if ((data == NULL) || (len == 0)) {
        return;
    }
    if (len > sizeof(desc)) {
        len = sizeof(desc);  // truncating is bad, but silently dropping the whole thing is worse
    }
    memcpy(desc, data, len);
    desc_len = len;
    __asm volatile("dmb" ::: "memory");  // the bytes must be visible before the flag is
    desc_ready = true;
}

void ble_bridge_push_report(const uint8_t* data, uint16_t len) {
    if ((data == NULL) || (len == 0)) {
        return;
    }
    if (len > BLE_BRIDGE_MAX_REPORT_LEN) {
        len = BLE_BRIDGE_MAX_REPORT_LEN;
    }

    uint32_t h = head;
    // Full? Drop the OLDEST by advancing tail is NOT safe (core 0 owns tail), so drop THIS one --
    // and count it. Never block: this runs inside BTstack's run loop.
    if ((h - tail) >= RING_SLOTS) {
        dropped++;
        return;
    }

    slot_t* s = &ring[h & RING_MASK];
    memcpy(s->data, data, len);
    s->len = len;
    __asm volatile("dmb" ::: "memory");  // the payload must be visible before head advances
    head = h + 1;
}

void ble_bridge_set_disconnected(void) {
    disconnected = true;
}

/* ================= core 0 (engine) ================= */

const uint8_t* ble_bridge_take_descriptor(uint16_t* len) {
    if (!desc_ready) {
        return NULL;
    }
    __asm volatile("dmb" ::: "memory");
    *len = desc_len;
    desc_ready = false;
    return desc;
}

bool ble_bridge_pop_report(uint8_t* out, uint16_t* len) {
    uint32_t t = tail;
    if (t == head) {
        return false;
    }
    __asm volatile("dmb" ::: "memory");

    slot_t* s = &ring[t & RING_MASK];
    *len = s->len;
    memcpy(out, s->data, s->len);
    __asm volatile("dmb" ::: "memory");
    tail = t + 1;
    return true;
}

bool ble_bridge_take_disconnected(void) {
    if (!disconnected) {
        return false;
    }
    disconnected = false;
    return true;
}

uint32_t ble_bridge_dropped(void) {
    return dropped;
}

/* ================= core 0 <-> core 1 requests + status ================= */

static volatile uint32_t requests;   // core 0 sets bits, core 1 clears them
static volatile ble_status_t status; // core 1 writes, core 0 reads

void ble_bridge_request(uint32_t req) {
    requests |= req;  // core 0 only sets; core 1 only clears. A lost race just delays by 100ms.
}

uint32_t ble_bridge_take_requests(void) {
    uint32_t r = requests;
    if (r != 0) {
        requests &= ~r;
    }
    return r;
}

void ble_bridge_set_status(const ble_status_t* st) {
    memcpy((void*) &status, st, sizeof(ble_status_t));
}

void ble_bridge_get_status(ble_status_t* out) {
    memcpy(out, (const void*) &status, sizeof(ble_status_t));
}
