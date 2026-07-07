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
