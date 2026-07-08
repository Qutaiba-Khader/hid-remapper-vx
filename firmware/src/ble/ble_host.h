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
