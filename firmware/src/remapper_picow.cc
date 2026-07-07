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
