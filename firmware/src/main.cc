#include <set>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <bsp/board_api.h>
#include <tusb.h>

#ifdef ADC_ENABLED
#include <hardware/adc.h>
#endif
#include <hardware/flash.h>
#include <hardware/gpio.h>
#include <pico/bootrom.h>
#include <pico/mutex.h>
#include <pico/platform.h>
#include <pico/stdio.h>
#include <pico/unique_id.h>

#include "activity_led.h"
#include "config.h"
#include "crc.h"
#include "descriptor_parser.h"
#include "globals.h"
#include "i2c.h"
#ifdef IR_OUTPUT_ENABLED
#include "ir_output.h"
#endif
#include "mcp4651.h"
#include "our_descriptor.h"
#include "platform.h"
#include "remapper.h"
#include "tick.h"

#ifdef RGB_LED_ENABLED
#include <hardware/pio.h>

#include "ws2812.pio.h"
#endif

#ifdef BLE_HOST_ENABLED
// Guarded, so a non-Bluetooth build pulls in nothing extra and stays byte-identical.
#include <pico/multicore.h>

#include "ble_bridge.h"
#endif

// RP2350 UF2s wipe the last sector of flash every time
// because of RP2350-E10 errata mitigation. So we put
// the config one sector down.
#if PICO_RP2350
#define CONFIG_OFFSET_IN_FLASH (PICO_FLASH_SIZE_BYTES - PERSISTED_CONFIG_SIZE - 4096)
#else
#define CONFIG_OFFSET_IN_FLASH (PICO_FLASH_SIZE_BYTES - PERSISTED_CONFIG_SIZE)
#endif

#define FLASH_CONFIG_IN_MEMORY (((uint8_t*) XIP_BASE) + CONFIG_OFFSET_IN_FLASH)

#define ADC_USAGE_PAGE 0xFFF80000

uint64_t next_print = 0;

mutex_t mutexes[(uint8_t) MutexId::N];

uint32_t gpio_valid_pins_mask = 0;
uint32_t gpio_in_mask = 0;
uint32_t gpio_out_mask = 0;
uint32_t prev_gpio_state = 0;
uint64_t last_gpio_change[32] = { 0 };
bool set_gpio_dir_pending = false;

#ifdef ADC_ENABLED
uint16_t prev_adc_state[NADCS] = { 0 };
#endif

void print_stats_maybe() {
    uint64_t now = time_us_64();
    if (now > next_print) {
        print_stats();
        while (next_print < now) {
            next_print += 1000000;
        }
    }
}

void __no_inline_not_in_flash_func(sof_handler)(uint32_t frame_count) {
    sof_callback();
}

bool do_send_report(uint8_t interface, const uint8_t* report_with_id, uint8_t len) {
    if (tud_suspended() &&
        (our_descriptor->should_cause_wakeup != nullptr) &&
        our_descriptor->should_cause_wakeup(report_with_id[0], report_with_id + 1, len - 1)) {
        tud_remote_wakeup();
    } else {
        tud_hid_n_report(interface, report_with_id[0], report_with_id + 1, len - 1);
    }
    return true;  // XXX?
}

void gpio_pins_init() {
    gpio_valid_pins_mask = get_gpio_valid_pins_mask();
    gpio_init_mask(gpio_valid_pins_mask);
}

void set_gpio_inout_masks(uint32_t in_mask, uint32_t out_mask) {
    // if some pin appears as both input and output, input wins
    gpio_out_mask = (out_mask & ~in_mask) & gpio_valid_pins_mask;
    // we treat all pins except the output ones as input so that the monitor works
    gpio_in_mask = gpio_valid_pins_mask & ~gpio_out_mask;
    set_gpio_dir_pending = true;
}

void set_gpio_dir() {
    gpio_set_dir_masked(gpio_in_mask, 0);
    // output pin direction will be set in write_gpio()
    for (uint8_t i = 0; i <= 29; i++) {
        uint32_t bit = 1 << i;
        if (gpio_valid_pins_mask & bit) {
            gpio_set_pulls(i, gpio_in_mask & bit, false);
        }
    }
}

#ifdef ADC_ENABLED
void adc_pins_init() {
    adc_init();
    for (int n = 26; n < 26 + NADCS; n++) {
        adc_gpio_init(n);
    }

#ifdef PICO_SMPS_MODE_PIN
    // (This only does anything on a Pico, but won't hurt on custom board v8.)
    gpio_init(PICO_SMPS_MODE_PIN);
    gpio_set_dir(PICO_SMPS_MODE_PIN, GPIO_OUT);
    gpio_put(PICO_SMPS_MODE_PIN, true);
#endif
}
#endif

bool read_gpio(uint64_t now) {
    uint32_t gpio_state = gpio_get_all() & gpio_in_mask;
    uint32_t changed = prev_gpio_state ^ gpio_state;
    if (changed != 0) {
        for (uint8_t i = 0; i <= 29; i++) {
            uint32_t bit = 1 << i;
            if (changed & bit) {
                if (last_gpio_change[i] + gpio_debounce_time <= now) {
                    uint32_t usage = GPIO_USAGE_PAGE | i;
                    int32_t state = !(gpio_state & bit);  // active low
                    set_input_state(usage, state, state);
                    if (monitor_enabled) {
                        monitor_usage(usage, state, 0);
                    }
                    last_gpio_change[i] = now;
                } else {
                    // ignore this change
                    gpio_state ^= bit;
                    changed ^= bit;
                }
            }
        }
        prev_gpio_state = gpio_state;
    }
    return changed != 0;
}

void write_gpio() {
    if (suspended) {
        return;
    }

    uint32_t value = gpio_out_state[0] | (gpio_out_state[1] << 8) | (gpio_out_state[2] << 16) | (gpio_out_state[3] << 24);
    switch (gpio_output_mode) {
        case 0:
            gpio_put_masked(gpio_out_mask, value);
            gpio_set_dir_masked(gpio_out_mask, gpio_out_mask);
            break;
        case 1:
            gpio_put_masked(gpio_out_mask, 0);
            gpio_set_dir_masked(gpio_out_mask, value);
            break;
    }
    memset(gpio_out_state, 0, sizeof(gpio_out_state));
}

#ifdef ADC_ENABLED
bool read_adc() {
    bool changed = false;
    for (int i = 0; i < NADCS; i++) {
        adc_select_input(i);
        uint16_t state = adc_read();
        if (state != prev_adc_state[i]) {
            changed = true;
            prev_adc_state[i] = state;
        }
        uint32_t usage = ADC_USAGE_PAGE | i;
        set_input_state(usage, state, state >> 4);
        if (monitor_enabled) {
            monitor_usage(usage, state, 0);
        }
    }
    return changed;
}
#endif

void do_persist_config(uint8_t* buffer) {
#ifdef BLE_HOST_ENABLED
    // Core 1 is running BTstack FROM FLASH. Erasing flash disables XIP, so it would be fetching
    // instructions from a chip that has stopped answering -- and die. Freeze it first.
    multicore_lockout_start_blocking();
#endif
#if !PICO_COPY_TO_RAM
    uint32_t ints = save_and_disable_interrupts();
#endif
    flash_range_erase(CONFIG_OFFSET_IN_FLASH, PERSISTED_CONFIG_SIZE);
    flash_range_program(CONFIG_OFFSET_IN_FLASH, buffer, PERSISTED_CONFIG_SIZE);
#if !PICO_COPY_TO_RAM
    restore_interrupts(ints);
#endif
#ifdef BLE_HOST_ENABLED
    multicore_lockout_end_blocking();
#endif
}

void reset_to_bootloader() {
    reset_usb_boot(0, 0);
}

/* PAIR_NEW_DEVICE (config command 12) and CLEAR_BONDS (13). The web tool already has both buttons.
   Empty on the wired builds -- there is nothing to pair. The Pico W Bluetooth build implements them
   through the bridge; see ble_bridge / ble_host. */
#ifdef BLE_HOST_ENABLED
void pair_new_device() {
    ble_bridge_request(BLE_REQ_PAIR_NEW);
}

void clear_bonds() {
    ble_bridge_request(BLE_REQ_CLEAR_BONDS);
}
#else
void pair_new_device() {
}

void clear_bonds() {
}
#endif

void my_mutexes_init() {
    for (int i = 0; i < (int8_t) MutexId::N; i++) {
        mutex_init(&mutexes[i]);
    }
}

void my_mutex_enter(MutexId id) {
    mutex_enter_blocking(&mutexes[(uint8_t) id]);
}

void my_mutex_exit(MutexId id) {
    mutex_exit(&mutexes[(uint8_t) id]);
}

uint64_t get_time() {
    return time_us_64();
}

uint64_t get_unique_id() {
    pico_unique_board_id_t unique_id;
    pico_get_unique_board_id(&unique_id);
    uint64_t ret = 0;
    for (int i = 0; i < 8; i++) {
        ret |= (uint64_t) unique_id.id[7 - i] << (8 * i);
    }
    return ret;
}

#ifdef RGB_LED_ENABLED
static PIO rgb_led_pio;
static uint rgb_led_sm;
static bool rgb_led_ready = false;
static uint32_t rgb_led_last_wire = 0xFFFFFFFF;  // sentinel: force the first write

// Global brightness cap (0-255). Kept well below full to limit current/heat
// (longer LED life) and to be easy on the eyes. Applied to every color.
#ifndef RGB_LED_BRIGHTNESS
#define RGB_LED_BRIGHTNESS 64
#endif

// Expand an RGB565 color to the WS2812 wire word, scaled to the brightness cap.
// Byte order is board-dependent and selected at compile time:
//   - default (RGB): the RP2350-Zero onboard WS2812 -- confirmed on hardware.
//   - RGB_LED_GRB:   the RP2040-Zero onboard WS2812 is standard GRB -- confirmed
//                    on hardware 2026-07-06 (MicroPython neopixel test: logical
//                    R/G/B each displayed correctly, i.e. matched standard GRB).
// The web-tool presets (RGB565 on page 0xFFFA) are identical for every board;
// only this wire-order pack differs, so colors land in the same positions.
static inline uint32_t rgb565_to_wire(uint16_t c) {
    uint8_t r5 = (c >> 11) & 0x1F;
    uint8_t g6 = (c >> 5) & 0x3F;
    uint8_t b5 = c & 0x1F;
    uint32_t r8 = (((r5 << 3) | (r5 >> 2)) * RGB_LED_BRIGHTNESS) / 255;
    uint32_t g8 = (((g6 << 2) | (g6 >> 4)) * RGB_LED_BRIGHTNESS) / 255;
    uint32_t b8 = (((b5 << 3) | (b5 >> 2)) * RGB_LED_BRIGHTNESS) / 255;
#ifdef RGB_LED_GRB
    return (g8 << 16) | (r8 << 8) | b8;  // GRB order (RP2040-Zero)
#else
    return (r8 << 16) | (g8 << 8) | b8;  // RGB order (RP2350-Zero)
#endif
}

// Claim a free PIO state machine AFTER the USB host has claimed its own, so the
// WS2812 driver never contends with the GP0/GP1 PIO-USB host port.
static void rgb_led_init() {
    uint offset;
    if (!pio_claim_free_sm_and_add_program_for_gpio_range(
            &ws2812_program, &rgb_led_pio, &rgb_led_sm, &offset, RGB_LED_PIN, 1, true)) {
        return;  // no free state machine: leave the LED disabled, disturb nothing
    }
    ws2812_program_init(rgb_led_pio, rgb_led_sm, offset, RGB_LED_PIN, 800000, false);
    rgb_led_ready = true;
    pio_sm_put_blocking(rgb_led_pio, rgb_led_sm, 0);  // start off
    rgb_led_last_wire = 0;
}

// Drive the LED to the most-recently-activated mapping's color (off when none
// active, or when suspended). Only pushes to the PIO when the color changed.
static void write_rgb_led() {
    if (!rgb_led_ready) {
        return;
    }
    uint32_t wire = 0;
    if (!suspended) {
        uint16_t rgb565;
        if (rgb_led_current_color(&rgb565)) {
            wire = rgb565_to_wire(rgb565);
        }
    }
    if (wire != rgb_led_last_wire) {
        pio_sm_put_blocking(rgb_led_pio, rgb_led_sm, wire << 8u);
        rgb_led_last_wire = wire;
    }
}
#endif

int main() {
    my_mutexes_init();
    gpio_pins_init();
#ifdef I2C_ENABLED
    our_i2c_init();
#endif
#ifdef ADC_ENABLED
    adc_pins_init();
#endif
    tick_init();
#ifdef IR_OUTPUT_ENABLED
    // Set the default IR pin BEFORE load_config/set_mapping_from_config, so a set-pin mapping in
    // the config overrides it (and, with no such mapping, IR stays on the default pin).
    ir_output_init();
#endif
    load_config(FLASH_CONFIG_IN_MEMORY);
    our_descriptor = &our_descriptors[our_descriptor_number];
    parse_our_descriptor();
    set_mapping_from_config();
    board_init();
    extra_init();
    tusb_init();
    stdio_init_all();

    tud_sof_isr_set(sof_handler);

    next_print = time_us_64() + 1000000;

#ifdef RGB_LED_ENABLED
    rgb_led_init();
#endif

    while (true) {
        bool tick;
        bool new_report;
        read_report(&new_report, &tick);
        if (new_report) {
            activity_led_on();
        }
        if (their_descriptor_updated) {
            update_their_descriptor_derivates();
            their_descriptor_updated = false;
        }
        if (tick) {
            bool gpio_state_changed = read_gpio(time_us_64());
            if (gpio_state_changed) {
                activity_led_on();
            }
#ifdef ADC_ENABLED
            read_adc();
#endif
            process_mapping(true);
            write_gpio();
#ifdef RGB_LED_ENABLED
            write_rgb_led();
#endif
#ifdef MCP4651_ENABLED
            mcp4651_write();
#endif
        }
        tud_task();
        if (boot_protocol_updated) {
            parse_our_descriptor();
            boot_protocol_updated = false;
            config_updated = true;
        }
        if (resume_pending) {
            resume_pending = false;
            suspended = false;
        }
        if (config_updated) {
            set_mapping_from_config();
            config_updated = false;
        }
        if (set_gpio_dir_pending && !suspended) {
            set_gpio_dir();
            set_gpio_dir_pending = false;
        }
        if (tud_hid_n_ready(0) || tud_suspended()) {
            send_report(do_send_report);
        }
        if (monitor_enabled && tud_hid_n_ready(1)) {
            send_monitor_report(do_send_report);
        }
        if (our_descriptor->main_loop_task != nullptr) {
            our_descriptor->main_loop_task();
        }
        send_out_report();
        if (need_to_persist_config) {
            persist_config_return_code = persist_config();
            need_to_persist_config = false;
        }

        print_stats_maybe();

        activity_led_off_maybe();
    }

    return 0;
}
