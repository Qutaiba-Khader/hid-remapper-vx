/* Pico W BLUETOOTH REMAPPER.
 *
 * A BLE HID device (keyboard / mouse / TV remote) is the INPUT; the PC sees hid-remapper's own
 * emulated USB HID device as the OUTPUT; the full mapping engine (layers, macros, expressions,
 * quirks) sits in between, and the existing WebHID tool configures it. Same as the wired build --
 * only where the input comes from changes.
 *
 * CORES
 *   core 1: BTstack. btstack_run_loop_execute() never returns, which is exactly why it gets a core
 *           to itself. (shiomachisoft/picow_ble_usb_hid_bridge does the same; proven on this board.)
 *   core 0: hid-remapper's existing main() -- engine + TinyUSB device + config. Untouched.
 *   They meet only in ble_bridge.c.
 *
 * HOW A BLE DEVICE ENTERS THE ENGINE
 *   Exactly the same two calls a wired USB device makes:
 *     descriptor_received_callback(...)  <- teaches the engine what the remote's bytes MEAN
 *     handle_received_report(...)        <- each report
 *   Everything downstream is then identical to a USB device.
 */

#include <tusb.h>

#include "hardware/gpio.h"   // GPIO_OVERRIDE_LOW / GPIO_OVERRIDE_NORMAL
#include "hardware/structs/ioqspi.h"
#include "hardware/structs/sio.h"
#include "hardware/sync.h"
#include "pico/multicore.h"
#include "pico/platform.h"
#include "pico/time.h"

#include "ble/ble_bridge.h"
#include "ble/ble_host.h"
#include "descriptor_parser.h"
#include "remapper.h"
#include "tick.h"

/* PROVE THE FLASH REGIONS CANNOT OVERLAP.
 *
 * hid-remapper's config lives in the LAST flash sector; the pico-sdk's BTstack bond storage
 * DEFAULTS to the last 8K -- straight on top of it. Left alone, every "Save to device" would wipe
 * the Bluetooth pairing and every pairing would corrupt the config (bad CRC -> silently reverts to
 * defaults, every mapping gone, no error shown). CMakeLists pins the bond bank below the config;
 * this makes it a COMPILE ERROR if that ever stops being true. */
#define BLE_CONFIG_OFFSET (PICO_FLASH_SIZE_BYTES - PERSISTED_CONFIG_SIZE)
#define BLE_BOND_OFFSET   (PICO_FLASH_BANK_STORAGE_OFFSET)
#define BLE_BOND_END      (BLE_BOND_OFFSET + PICO_FLASH_BANK_TOTAL_SIZE)

static_assert(BLE_BOND_END <= BLE_CONFIG_OFFSET,
              "BLE bond storage overlaps hid-remapper's config sector: saving a config would erase "
              "your pairing, and pairing would erase your config. Fix PICO_FLASH_BANK_STORAGE_OFFSET.");
// and it must not have wandered down into program flash either
static_assert(BLE_BOND_OFFSET > (PICO_FLASH_SIZE_BYTES / 2),
              "BLE bond storage is far too low in flash - it would sit on top of the program.");

/* The BLE device has no USB VID/PID. The engine only uses them to look up QUIRKS, so a stable,
 * non-colliding pair is all that is needed -- and it must be STABLE, or a quirk you add would stop
 * matching after a reconnect. */
#define BLE_VENDOR_ID  0xCAFE
#define BLE_PRODUCT_ID 0xB1E0

// one BLE HID device, one logical interface
#define BLE_INTERFACE 0

static bool reports_received;
static bool ble_device_registered;

/* The 1ms tick. The wired build gets it from the PIO-USB frame timer; we are a USB *device*, so we
 * take it from a plain repeating timer -- the engine only needs a steady 1kHz heartbeat. */
static repeating_timer_t tick_timer;

static bool __no_inline_not_in_flash_func(tick_1ms)(repeating_timer_t* rt) {
    set_tick_pending();
    return true;
}

void extra_init() {
    add_repeating_timer_us(-1000, tick_1ms, NULL, &tick_timer);

    // BTstack owns core 1 from here on. Nothing else may touch it.
    multicore_launch_core1(ble_host_main);
}

uint32_t get_gpio_valid_pins_mask() {
    // On the Pico W, GP23/24/25/29 belong to the CYW43 (wireless) chip -- never expose them.
    return GPIO_VALID_PINS_BASE & ~(
#ifdef PICO_DEFAULT_UART_TX_PIN
                                      (1 << PICO_DEFAULT_UART_TX_PIN) |
#endif
#ifdef PICO_DEFAULT_UART_RX_PIN
                                      (1 << PICO_DEFAULT_UART_RX_PIN) |
#endif
                                      (1 << 23) | (1 << 24) | (1 << 25) | (1 << 29));
}

/* THE BOOTSEL BUTTON = "PAIR NEW DEVICE".
 *
 * The Pico W has exactly one button and no way to trigger a re-pair without a PC. Holding BOOTSEL
 * only enters the bootloader at RESET; while running it is just a button, and it can be read.
 *
 * The trick (from pico-examples): BOOTSEL is wired to the flash chip-select line. Briefly drive
 * QSPI_SS as a GPIO, read it (LOW = pressed), and put it back. Flash must not be accessed while we
 * do that, hence __no_inline_not_in_flash_func and interrupts off -- executing from flash mid-read
 * would hang the chip.
 *
 * Hold it for ~1s to clear the bonds and start looking for a new device.
 */
#define BOOTSEL_HOLD_MS 1000

static bool __no_inline_not_in_flash_func(bootsel_pressed)() {
    const uint CS_PIN_INDEX = 1;
    uint32_t flags = save_and_disable_interrupts();

    hw_write_masked(&ioqspi_hw->io[CS_PIN_INDEX].ctrl,
                    GPIO_OVERRIDE_LOW << IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_LSB,
                    IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_BITS);
    for (volatile int i = 0; i < 1000; ++i) {  // let the pin settle
    }
    bool pressed = !(sio_hw->gpio_hi_in & (1u << CS_PIN_INDEX));
    hw_write_masked(&ioqspi_hw->io[CS_PIN_INDEX].ctrl,
                    GPIO_OVERRIDE_NORMAL << IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_LSB,
                    IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_BITS);

    restore_interrupts(flags);
    return pressed;
}

static void check_pair_button() {
    static uint64_t held_since = 0;
    static bool fired = false;

    if (!bootsel_pressed()) {
        held_since = 0;
        fired = false;
        return;
    }
    uint64_t now = time_us_64();
    if (held_since == 0) {
        held_since = now;
        return;
    }
    if (!fired && (now - held_since >= BOOTSEL_HOLD_MS * 1000ull)) {
        fired = true;  // once per hold
        ble_bridge_request(BLE_REQ_PAIR_NEW);
    }
}

void read_report(bool* new_report, bool* tick) {
    *tick = get_and_clear_tick_pending();
    reports_received = false;

    // hold BOOTSEL for a second to forget the current remote and pair a new one
    check_pair_button();

    // The remote went away: forget its descriptor, so a different device reconnecting cannot be
    // interpreted with the old one's report layout.
    if (ble_bridge_take_disconnected() && ble_device_registered) {
        device_disconnected_callback(BLE_INTERFACE);
        ble_device_registered = false;
    }

    // A descriptor arrived (the remote connected). Register it exactly as a USB device's would be.
    uint16_t desc_len = 0;
    const uint8_t* desc = ble_bridge_take_descriptor(&desc_len);
    if ((desc != NULL) && (desc_len > 0)) {
        descriptor_received_callback(BLE_VENDOR_ID, BLE_PRODUCT_ID, desc, desc_len,
                                     BLE_INTERFACE, /* hub_port */ 0, /* itf_num */ 0);
        ble_device_registered = true;
    }

    // Drain everything core 1 queued. Reports are only meaningful once the descriptor is in --
    // without it the engine has no idea what the bytes mean.
    uint8_t buf[BLE_BRIDGE_MAX_REPORT_LEN];
    uint16_t len;
    while (ble_bridge_pop_report(buf, &len)) {
        if (!ble_device_registered) {
            continue;  // descriptor not in yet; the report is meaningless
        }
        handle_received_report(buf, len, BLE_INTERFACE);
        reports_received = true;
    }

    *new_report = reports_received;
}

void interval_override_updated() {
}

void flash_b_side() {
    // no B side on a Pico W
}

void descriptor_received_callback(uint16_t vendor_id, uint16_t product_id, const uint8_t* report_descriptor, int len, uint16_t interface, uint8_t hub_port, uint8_t itf_num) {
    parse_descriptor(vendor_id, product_id, report_descriptor, len, interface, itf_num);

    device_connected_callback(interface, vendor_id, product_id, hub_port);
}

void umount_callback(uint8_t dev_addr, uint8_t instance) {
    device_disconnected_callback(dev_addr);
}

/* There is no USB HOST here, so nothing can be sent back OUT to the input device (no LEDs on a BLE
 * remote to drive, no feature reports). These are the engine's out-report hooks; they are no-ops. */
void queue_out_report(uint16_t interface, uint8_t report_id, const uint8_t* buffer, uint8_t len) {
}

void queue_set_feature_report(uint16_t interface, uint8_t report_id, const uint8_t* buffer, uint8_t len) {
}

void queue_get_feature_report(uint16_t interface, uint8_t report_id, uint8_t len) {
}

void send_out_report() {
}

void __no_inline_not_in_flash_func(sof_callback)() {
}
