#include <stdio.h>
#include "pico/stdlib.h"
#include "ble_host.h"
int main() {
    stdio_init_all();
    sleep_ms(2000);
    printf("remapper_picow_ble: starting BLE HID-over-GATT host\n");
    ble_host_init();
    ble_host_run();
    return 0;
}
