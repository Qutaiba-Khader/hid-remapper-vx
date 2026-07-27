// IR (infrared) output for hid-remapper -- OPT-IN (built only with -DIR_OUTPUT_ENABLED=ON).
//
// A mapping whose TARGET is on the IR usage page fires an IR frame on the rising edge of its
// source (a key-down), so you can turn any button on your input device into a TV/AV remote key.
//
// ENCODING (no CONFIG_VERSION bump -- the code rides the mapping's existing 32-bit `scaling`
// field, exactly like the RGB-LED color rides a usage's low 16 bits):
//
//   send-IR mapping:   target = IR_USAGE_PAGE | protocol   (protocol: 1=NEC, 2=Samsung)
//                      source = the button
//                      scaling = the 32-bit IR code (sent LSB-first)
//
//   set-pin mapping:   target = IR_CONFIG_PIN_USAGE         (a reserved sub-usage)
//                      source = nothing (0)
//                      scaling = the GPIO pin the IR LED is wired to
//   The web tool presents this last one as a Settings dropdown; the firmware just reads it.
//
// The waveform is generated with a PWM carrier + a hardware alarm (NOT PIO), so it never
// contends with the PIO-USB host or the WS2812 RGB LED. Generation is non-blocking: a frame is
// ~68 ms and core 0 must keep servicing USB, so ir_output_send() kicks off the frame and returns
// immediately; an alarm ISR clocks out the marks/spaces in the background.

#pragma once

#include <cstdint>

// Protocol ids packed into the low bits of an IR target usage.
#define IR_PROTO_NEC 1
#define IR_PROTO_SAMSUNG 2

// Default IR LED pin when no set-pin mapping is present. GP15 is free on the wired single, the
// RP2040-Zero dual, and the Pico W BT build (see the reserved-pin table in ir_output.cc).
#ifndef IR_OUTPUT_DEFAULT_PIN
#define IR_OUTPUT_DEFAULT_PIN 15
#endif

// Frames sent per key-down. A real remote transmits continuously while the button is held; we
// fire once on the rising edge, and a lone frame is the classic "the TV ignores it sometimes"
// bug -- receivers with slow AGC can swallow the first burst. 3 costs ~300 ms of air time, during
// which further presses are dropped (ir_output_send() is busy); lower it to 2 if you machine-gun
// a volume key.
#ifndef IR_OUTPUT_FRAMES
#define IR_OUTPUT_FRAMES 3
#endif

// Quiet time between repeated frames (us). NEC repeats every 110 ms from frame start and a frame
// is ~45-80 ms, so ~40 ms of silence lands the period in the right ballpark for either protocol.
#ifndef IR_OUTPUT_FRAME_GAP_US
#define IR_OUTPUT_FRAME_GAP_US 40000
#endif

// Set up IR output on the default pin. Safe to call once at boot. No-op if IR is disabled.
void ir_output_init();

// Point IR output at `pin` (idempotent: a no-op if `pin` is already active). Refuses a pin that
// collides with a pin the firmware uses for something else (USB, UART, RGB LED, CYW43, dual
// UART) -- the previous/default pin stays active and IR keeps working on it.
void ir_output_set_pin(uint8_t pin);

// Fire one IR frame for `protocol` carrying `code` (LSB-first). Non-blocking; drops the request
// if a frame is still being transmitted.
void ir_output_send(uint8_t protocol, uint32_t code);

// The GPIO currently driving the IR LED, or 0xFF if IR output is not set up. The GPIO scanner
// must exclude this pin: main.cc treats every pin that is not a declared GPIO *output* as an
// input "so that the monitor works", which would otherwise sample our 38 kHz carrier (the pin
// shows up in the Monitor as GPIO n) and put a pull-up on the IR drive pin.
uint8_t ir_output_get_pin();
