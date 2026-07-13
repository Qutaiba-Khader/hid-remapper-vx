#ifndef BLE_HOST_H
#define BLE_HOST_H
#ifdef __cplusplus
extern "C" {
#endif
// Init cyw43 + BTstack LE central + HID-over-GATT host, auto-pair (Just Works),
// scan for a BLE HID device, dump its report notifications over stdio. Non-blocking.
void ble_host_init(void);
// Connect ONLY to this device (MAC string, e.g. "68:FC:CA:B4:43:B7"); NULL/"" = fall back to
// "first advertiser carrying the HID UUID". The web tool will set this from a scan list.
void ble_host_set_target_addr(const char * addr_str);
// Run the BTstack loop; does not return.
void ble_host_run(void);
#ifdef __cplusplus
}
#endif
#endif
