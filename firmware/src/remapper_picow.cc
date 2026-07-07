// Milestone 0 scaffold for the Pico W Bluetooth build. Task 1 only proves the
// toolchain, board, USB-CDC serial and CI. Task 2 replaces the heartbeat loop
// with the Bluetooth Classic HID host (bt_host_init / bt_host_task).
#include <stdio.h>

#include "pico/stdlib.h"
#include "pico/cyw43_arch.h"

int main() {
    stdio_init_all();

    // Bring up the CYW43439 (WiFi/BT combo chip). Proves the radio driver links
    // and initialises even though we don't use the radio yet in Task 1.
    if (cyw43_arch_init()) {
        printf("cyw43_arch_init FAILED\n");
        return -1;
    }

    uint32_t n = 0;
    while (true) {
        printf("remapper_picow alive %lu\n", (unsigned long) n++);
        cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, n & 1);  // blink onboard LED
        sleep_ms(1000);
    }
}
