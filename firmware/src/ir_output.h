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

// Frames sent on the initial key-down. A lone frame is the classic "the TV ignores it sometimes"
// bug -- receivers with slow AGC can swallow the first burst. This was 3 before hold-repeat
// existed; 2 is enough now that holding retransmits, and it keeps a tap's air time down (each
// frame is ~45-80 ms, during which further sends are dropped because ir_output_send() is busy).
#ifndef IR_OUTPUT_FRAMES
#define IR_OUTPUT_FRAMES 2
#endif

// Hold-to-repeat interval, in ms. A real remote retransmits every ~110 ms for as long as the
// button is down -- that is what makes volume ramp and channel-surf work. Unlike every other
// output, IR cannot inherit the host's key-repeat: a normal mapping just holds its output bit at
// 1 and the OS repeats it, but IR is fire-and-forget pulses with no "held" state to report, so
// the repeat has to happen here. Set to 0 to disable and fire once per press.
#ifndef IR_OUTPUT_REPEAT_MS
#define IR_OUTPUT_REPEAT_MS 110
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

// Transmit `code` (LSB-first) for `protocol`. `frames` = how many times to repeat the frame back
// to back; 0 means IR_OUTPUT_FRAMES. Non-blocking.
// Returns TRUE if transmission started, FALSE if it was dropped because a frame is still going
// out. The caller must not advance its repeat clock on a false return, or a repeat that collided
// with the tail of the previous burst is silently lost for a whole interval.
bool ir_output_send(uint8_t protocol, uint32_t code, uint8_t frames = 0);

// Hold-to-repeat interval in ms, settable from the config (pseudo-mapping IR_CONFIG_REPEAT_USAGE,
// surfaced as an "IR repeat" field in the web tool's Settings). 0 = fire once per press.
// ir_output_init() resets it to IR_OUTPUT_REPEAT_MS, so a config with no repeat mapping gets the
// firmware default rather than whatever the previously-loaded config happened to set.
void ir_output_set_repeat_ms(uint16_t ms);
uint16_t ir_output_get_repeat_ms();

// The GPIO currently driving the IR LED, or 0xFF if IR output is not set up. The GPIO scanner
// must exclude this pin: main.cc treats every pin that is not a declared GPIO *output* as an
// input "so that the monitor works", which would otherwise sample our 38 kHz carrier (the pin
// shows up in the Monitor as GPIO n) and put a pull-up on the IR drive pin.
uint8_t ir_output_get_pin();
