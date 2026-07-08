cmake_minimum_required(VERSION 3.13)

add_subdirectory(usb_midi_host)

add_compile_definitions(PICO_DEFAULT_UART_BAUD_RATE=921600)
add_compile_definitions(PERSISTED_CONFIG_SIZE=4096)
add_compile_definitions(PICO_XOSC_STARTUP_DELAY_MULTIPLIER=64)

set(PICO_SDK_PATH "${CMAKE_CURRENT_LIST_DIR}/pico-sdk")
set(PICO_TINYUSB_PATH "${CMAKE_CURRENT_LIST_DIR}/tinyusb")
set(PICO_PIO_USB_PATH "${CMAKE_CURRENT_LIST_DIR}/Pico-PIO-USB")
set(PICO_BOARD_HEADER_DIRS "${CMAKE_CURRENT_LIST_DIR}/src/boards")

include(pico_sdk_import.cmake)

project(remapper)

pico_sdk_init()

check_and_add_pico_pio_usb_support()

add_compile_options(-Wall)

add_compile_options($<$<COMPILE_LANGUAGE:CXX>:-std=c++17>)

if((PICO_BOARD STREQUAL "pico") OR (PICO_BOARD STREQUAL "pico2"))
add_compile_definitions(GPIO_VALID_PINS_BASE=0b00011100011111111111111111111111)
endif()


add_executable(remapper
    src/main.cc
    src/remapper.cc
    src/remapper_single.cc
    src/crc.cc
    src/descriptor_parser.cc
    src/tinyusb_stuff.cc
    src/our_descriptor.cc
    src/globals.cc
    src/config.cc
    src/quirks.cc
    src/interval_override.cc
    src/out_report.cc
    src/tick.cc
    src/activity_led.cc
    src/ps_auth.cc
    src/app_driver.cc
    src/xbox.cc
)

if((PICO_BOARD STREQUAL "pico") OR (PICO_BOARD STREQUAL "pico2"))
target_compile_definitions(remapper PUBLIC PICO_DEFAULT_UART_TX_PIN=16)
target_compile_definitions(remapper PUBLIC PICO_DEFAULT_UART_RX_PIN=17)
target_compile_definitions(remapper PUBLIC PICO_DEFAULT_PIO_USB_DP_PIN=0)
endif()

target_include_directories(remapper PRIVATE
    src
    src/tusb_config_both
    ${PICO_PIO_USB_PATH}
)

target_link_libraries(remapper
    pico_stdlib
    pico_unique_id
    hardware_pio
    hardware_dma
    hardware_flash
    $<$<STREQUAL:${PICO_BOARD},remapper_v8>:hardware_adc>
    tinyusb_device
    tinyusb_host
    tinyusb_board
    tinyusb_pico_pio_usb
    usb_midi_host
)

pico_set_binary_type(remapper copy_to_ram)
if(PICO_PLATFORM STREQUAL "rp2040")
    pico_set_linker_script(remapper ${CMAKE_CURRENT_LIST_DIR}/remapper_single.ld)
elseif(PICO_PLATFORM STREQUAL "rp2350-arm-s")
    pico_set_linker_script(remapper ${CMAKE_CURRENT_LIST_DIR}/remapper_single_rp2350.ld)
else()
    message(FATAL_ERROR "Unknown PICO_PLATFORM.")
endif()
pico_add_extra_outputs(remapper)

# --- RGB LED output (opt-in). Enabled only with -DRGB_LED_ENABLED=ON. On the
# single-board target this produces remapper_pico2_led.uf2 (RP2350-Zero) or
# remapper_rp2040_zero_led.uf2 (RP2040-Zero -- add -DRGB_LED_GRB=ON). Default
# (OFF) builds are byte-identical to upstream. Note: GP16 is also the default
# UART TX pin on pico/pico2, so the _led build claims GP16 for the WS2812 and
# loses UART serial-console debug output (USB-CDC stdio is unaffected).
#
# RGB_LED_GRB selects the WS2812 wire byte order: OFF (default) = RGB, correct
# for the RP2350-Zero; ON = GRB, correct for the RP2040-Zero (both confirmed on
# hardware). The web tool's RGB565 presets are board-agnostic; only this flag
# differs per board. It is applied to remapper_dual_a further below as well. ---
option(RGB_LED_ENABLED "Drive onboard WS2812 RGB LED output on GP16" OFF)
option(RGB_LED_GRB "Onboard WS2812 uses GRB byte order (RP2040-Zero); OFF = RGB (RP2350-Zero)" OFF)
if(RGB_LED_ENABLED)
    pico_generate_pio_header(remapper ${CMAKE_CURRENT_LIST_DIR}/src/ws2812.pio)
    target_compile_definitions(remapper PUBLIC RGB_LED_ENABLED RGB_LED_PIN=16)
    if(RGB_LED_GRB)
        target_compile_definitions(remapper PUBLIC RGB_LED_GRB)
    endif()
endif()


add_executable(remapper_dual_a
    src/main.cc
    src/remapper.cc
    src/remapper_dual_a.cc
    src/crc.cc
    src/descriptor_parser.cc
    src/tinyusb_stuff.cc
    src/our_descriptor.cc
    src/globals.cc
    src/config.cc
    src/quirks.cc
    src/interval_override.cc
    src/serial.cc
    src/tick.cc
    src/activity_led.cc
    src/pico_debug/swd.c
    src/pico_debug/flash.c
    src/pico_debug/adi.c
    dual_b_binary.c
    src/ps_auth.cc
    $<$<STREQUAL:${PICO_BOARD},remapper_v7>:src/i2c.cc>
    $<$<STREQUAL:${PICO_BOARD},remapper_v7>:src/mcp4651.cc>
)
target_include_directories(remapper_dual_a PRIVATE
    src
    src/tusb_config_device
    src/pico_debug
)
target_link_libraries(remapper_dual_a
    pico_stdlib
    hardware_flash
    $<$<STREQUAL:${PICO_BOARD},remapper_v7>:hardware_i2c>
    hardware_pio
    tinyusb_device
    tinyusb_board
    pico_unique_id
)
pico_generate_pio_header(remapper_dual_a ${CMAKE_CURRENT_LIST_DIR}/src/pico_debug/swd.pio)
pico_add_extra_outputs(remapper_dual_a)

# --- RGB LED on dual Board A (opt-in, same -DRGB_LED_ENABLED / -DRGB_LED_GRB
# flags as the single build). Board A shares main.cc's main loop and runs the
# mapping engine, so its onboard WS2812 lights from your mappings exactly like
# the single-board build. Built as remapper_rp2040_zero_dual_a_led.uf2 with
# PICO_BOARD=pico -DZERO_DUAL_SERIAL=ON -DRGB_LED_ENABLED=ON -DRGB_LED_GRB=ON.
# Board B (remapper_dual_b) is unchanged and has no LED code. Default
# (RGB_LED_ENABLED OFF) keeps remapper_dual_a byte-identical. ---
if(RGB_LED_ENABLED)
    pico_generate_pio_header(remapper_dual_a ${CMAKE_CURRENT_LIST_DIR}/src/ws2812.pio)
    target_compile_definitions(remapper_dual_a PUBLIC RGB_LED_ENABLED RGB_LED_PIN=16)
    if(RGB_LED_GRB)
        target_compile_definitions(remapper_dual_a PUBLIC RGB_LED_GRB)
    endif()
endif()

add_executable(remapper_dual_b
    src/remapper_dual_b.cc
    src/crc.cc
    src/interval_override.cc
    src/serial.cc
    src/out_report.cc
    src/activity_led.cc
    src/app_driver.cc
    src/xbox.cc
)
target_include_directories(remapper_dual_b PRIVATE
    src
    src/tusb_config_host
)
target_link_libraries(remapper_dual_b
    pico_stdlib
    tinyusb_host
    tinyusb_board
    usb_midi_host
)
pico_add_extra_outputs(remapper_dual_b)
pico_add_hex_output(remapper_dual_b)

# --- RP2040-Zero dual serial pin relocation (opt-in). Enabled only with
# -DZERO_DUAL_SERIAL=ON, which produces remapper_rp2040_zero_dual_a/b.uf2 with
# the inter-Pico UART moved off GP20/GP21 (which are on the underside SMD pads
# of the RP2040-Zero and hard to solder) onto the edge-accessible UART1 pins
# GP8/GP9/GP10/GP11. Both dual targets must use the same pins. Default (OFF)
# builds keep the stock GP20/21/26/27 and are byte-identical to upstream, so the
# existing remapper_dual_a/b.uf2 and every other board build are unaffected. ---
option(ZERO_DUAL_SERIAL "Relocate dual-Pico serial UART to edge pins GP8-11 for RP2040-Zero" OFF)
if(ZERO_DUAL_SERIAL)
    target_compile_definitions(remapper_dual_a PUBLIC SERIAL_TX_PIN=8 SERIAL_RX_PIN=9 SERIAL_CTS_PIN=10 SERIAL_RTS_PIN=11)
    target_compile_definitions(remapper_dual_b PUBLIC SERIAL_TX_PIN=8 SERIAL_RX_PIN=9 SERIAL_CTS_PIN=10 SERIAL_RTS_PIN=11)
endif()

add_custom_command(
  OUTPUT dual_b_binary.c dual_b_binary.h
  DEPENDS remapper_dual_b
  COMMAND srec_cat remapper_dual_b.hex -Intel -Output dual_b_binary.c -C-Array dual_b_binary -INClude
  VERBATIM
)

add_executable(remapper_serial
    src/main.cc
    src/remapper.cc
    src/remapper_serial.cc
    src/crc.cc
    src/descriptor_parser.cc
    src/tinyusb_stuff.cc
    src/our_descriptor.cc
    src/globals.cc
    src/config.cc
    src/quirks.cc
    src/interval_override.cc
    src/tick.cc
    src/activity_led.cc
    src/ps_auth.cc
)
target_include_directories(remapper_serial PRIVATE
    src
    src/tusb_config_device
)
target_link_libraries(remapper_serial
    pico_stdlib
    pico_unique_id
    hardware_flash
    tinyusb_device
    tinyusb_board
)
pico_add_extra_outputs(remapper_serial)

add_executable(flash_b_side
    src/flash_b_side.cc
    dual_b_binary.c
    src/pico_debug/swd.c
    src/pico_debug/flash.c
    src/pico_debug/adi.c
)
target_include_directories(flash_b_side PRIVATE
    src
    src/pico_debug
)
target_link_libraries(flash_b_side
    pico_stdlib
    hardware_pio
)
pico_generate_pio_header(flash_b_side ${CMAKE_CURRENT_LIST_DIR}/src/pico_debug/swd.pio)
pico_add_extra_outputs(flash_b_side)
pico_set_binary_type(flash_b_side no_flash)

add_custom_command(
    OUTPUT remapper_dual_combined.uf2
    DEPENDS remapper_dual_a flash_b_side
    COMMAND ${CMAKE_CURRENT_LIST_DIR}/combine_uf2.py remapper_dual_a.uf2 flash_b_side.uf2 remapper_dual_combined.uf2
    VERBATIM
)

add_custom_target(remapper_dual_combined ALL
    DEPENDS remapper_dual_combined.uf2
)

# --- Pico W Bluetooth Classic build (opt-in, isolated). Only configured when
# PICO_BOARD=pico_w, so the default `cmake ..` and every other board build stay
# byte-identical (golden rule #1). Task 1 is a heartbeat that proves toolchain +
# CYW43 + USB-CDC serial + CI. Task 2 adds BTstack HID host (bt_host + config). ---
if(PICO_BOARD STREQUAL "pico_w")
    add_executable(remapper_picow
        src/remapper_picow.cc
        src/bt_host.c
    )
    target_include_directories(remapper_picow PRIVATE src)  # finds btstack_config.h
    target_link_libraries(remapper_picow
        pico_stdlib
        pico_cyw43_arch_none
        pico_btstack_cyw43
        pico_btstack_classic
    )
    # Serial over the Pico W's own USB (no UART adapter / no extra hardware).
    pico_enable_stdio_usb(remapper_picow 1)
    pico_enable_stdio_uart(remapper_picow 0)
    pico_add_extra_outputs(remapper_picow)

    # BLE HID-over-GATT host (for BLE remotes like the G20s)
    add_executable(remapper_picow_ble
        src/ble/remapper_picow_ble.cc
        src/ble/ble_host.c
    )
    target_include_directories(remapper_picow_ble PRIVATE src/ble)
    target_link_libraries(remapper_picow_ble
        pico_stdlib
        pico_cyw43_arch_none
        pico_btstack_cyw43
        pico_btstack_ble
    )
    # This SDK's pico_btstack_ble doesn't bundle the HID-over-GATT service
    # client, so compile it (and its base helper) into the target directly.
    target_sources(remapper_picow_ble PRIVATE
        ${PICO_BTSTACK_PATH}/src/ble/gatt-service/hids_client.c
        ${PICO_BTSTACK_PATH}/src/ble/gatt-service/gatt_service_client.c
    )
    pico_btstack_make_gatt_header(remapper_picow_ble PRIVATE ${CMAKE_CURRENT_LIST_DIR}/src/ble/ble_gatt.gatt)
    pico_enable_stdio_usb(remapper_picow_ble 1)
    pico_enable_stdio_uart(remapper_picow_ble 0)
    pico_add_extra_outputs(remapper_picow_ble)
endif()
