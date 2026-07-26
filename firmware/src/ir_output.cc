#include "ir_output.h"

#ifdef IR_OUTPUT_ENABLED

#include "hardware/clocks.h"
#include "hardware/gpio.h"
#include "hardware/pwm.h"
#include "pico/time.h"

// ---- carrier + waveform state (all touched only from core 0: process_mapping and the alarm) ----
static bool ir_ready = false;
static uint8_t ir_pin = 0xFF;
static uint ir_slice = 0;
static uint ir_chan = 0;
static uint16_t ir_level = 0;  // PWM compare level for a "mark" (carrier on); 0 = "space"

// A frame is a list of alternating mark/space durations (us), starting with a mark.
// Longest frame: 2 (leader) + 32*2 (bits) + 1 (stop) = 67 segments.
static uint16_t ir_buf[72];
static uint8_t ir_len = 0;
static volatile uint8_t ir_idx = 0;
static volatile bool ir_busy = false;
static volatile uint8_t ir_frames_left = 0;  // whole frames still to send after the current one
static volatile bool ir_in_gap = false;      // the quiet time between repeated frames
static alarm_id_t ir_alarm_id = 0;

static inline void ir_mark() { pwm_set_chan_level(ir_slice, ir_chan, ir_level); }
static inline void ir_space() { pwm_set_chan_level(ir_slice, ir_chan, 0); }

// Pins the firmware already uses on one or more of the builds this feature targets. Refuse to
// drive IR on any of them (conservative union, so the one guard is correct on every build):
//   GP0/1   PIO-USB D+/D-            (wired single)
//   GP8-11  dual inter-Pico UART     (RP2040-Zero, ZERO_DUAL_SERIAL)
//   GP16/17 UART TX/RX; GP16 is also the WS2812 RGB LED data pin
//   GP20/21/26/27  dual inter-Pico UART (default pins)
//   GP23/24/25/29  CYW43 wireless    (Pico W)
static bool ir_pin_reserved(uint8_t pin) {
    switch (pin) {
        case 0: case 1:
        case 8: case 9: case 10: case 11:
        case 16: case 17:
        case 20: case 21: case 26: case 27:
        case 23: case 24: case 25: case 29:
            return true;
        default:
            return pin >= 30;  // RP2040/RP2350 expose GP0..GP29
    }
}

static void ir_teardown() {
    if (!ir_ready) {
        return;
    }
    if (ir_busy) {
        cancel_alarm(ir_alarm_id);
        ir_busy = false;
        ir_frames_left = 0;
        ir_in_gap = false;
    }
    pwm_set_enabled(ir_slice, false);
    gpio_set_function(ir_pin, GPIO_FUNC_SIO);
    gpio_set_dir(ir_pin, GPIO_IN);
    ir_ready = false;
}

void ir_output_set_pin(uint8_t pin) {
    if (ir_ready && pin == ir_pin) {
        return;  // idempotent -- safe to call every config reload
    }
    if (ir_pin_reserved(pin)) {
        return;  // keep the previous/default pin; IR keeps working there
    }
    ir_teardown();

    ir_pin = pin;
    gpio_set_function(pin, GPIO_FUNC_PWM);
    // The pad defaults to 4 mA, which is the range bottleneck when the LED hangs straight off the
    // GPIO (a bare module, no transistor). 12 mA is the strongest the pad offers and is within
    // spec for a pin driving a current-limited LED. It cannot fix a module whose own series
    // resistor is already starving the LED -- that needs a driver transistor.
    gpio_set_drive_strength(pin, GPIO_DRIVE_STRENGTH_12MA);
    ir_slice = pwm_gpio_to_slice_num(pin);
    ir_chan = pwm_gpio_to_channel(pin);

    // 38 kHz carrier. wrap = f_sys / 38kHz (~3289 @125MHz, ~3947 @150MHz -- both < 16 bits).
    uint32_t wrap = clock_get_hz(clk_sys) / 38000u;
    if (wrap > 65535u) {
        wrap = 65535u;
    }
    if (wrap < 3u) {
        wrap = 3u;
    }
    pwm_set_wrap(ir_slice, (uint16_t) (wrap - 1u));
    // ~1/2 duty. 1/3 is the textbook figure, but that assumes a driver pushing hundreds of mA
    // through the LED, where duty is a thermal budget. Driven from a GPIO the LED is nowhere near
    // its limit, so the extra duty is free burst energy for the receiver's AGC (~1.5x average
    // power). Still well inside what a 38 kHz demodulator expects.
    ir_level = (uint16_t) (wrap / 2u);
    pwm_set_chan_level(ir_slice, ir_chan, 0);  // idle low (carrier off)
    pwm_set_enabled(ir_slice, true);
    ir_ready = true;
}

void ir_output_init() {
    ir_output_set_pin(IR_OUTPUT_DEFAULT_PIN);
}

// NEC and Samsung are both 38 kHz pulse-distance: a leader, then 32 data bits LSB-first where a
// bit is a fixed 560us mark and a space of 560us (0) or 1690us (1), then a 560us stop mark. They
// differ only in the leader (NEC 9000/4500, Samsung 4500/4500).
static void ir_build_frame(uint8_t protocol, uint32_t code) {
    uint8_t n = 0;
    ir_buf[n++] = (protocol == IR_PROTO_SAMSUNG) ? 4500 : 9000;  // leader mark
    ir_buf[n++] = 4500;                                          // leader space
    for (int i = 0; i < 32; i++) {
        ir_buf[n++] = 560;                                       // bit mark
        ir_buf[n++] = ((code >> i) & 1u) ? 1690 : 560;          // bit space (LSB-first)
    }
    ir_buf[n++] = 560;                                          // stop mark
    ir_len = n;
}

// Runs in alarm (IRQ) context. Applies the next segment's carrier state and asks to be called
// again after that segment's duration; stops (returns 0) once the whole frame has been sent.
static int64_t ir_alarm_cb(alarm_id_t /*id*/, void* /*user*/) {
    if (ir_in_gap) {
        // The quiet time elapsed -- retransmit the same frame from segment 0 (still in ir_buf).
        ir_in_gap = false;
        ir_mark();
        ir_idx = 1;
        return (int64_t) ir_buf[0];
    }
    if (ir_idx >= ir_len) {
        ir_space();
        if (ir_frames_left > 0) {
            ir_frames_left--;
            ir_in_gap = true;
            return (int64_t) IR_OUTPUT_FRAME_GAP_US;
        }
        ir_busy = false;
        return 0;
    }
    if (ir_idx & 1u) {
        ir_space();
    } else {
        ir_mark();
    }
    uint16_t dur = ir_buf[ir_idx];
    ir_idx++;
    return (int64_t) dur;  // reschedule ~dur us from now
}

void ir_output_send(uint8_t protocol, uint32_t code) {
    if (!ir_ready || ir_busy) {
        return;  // not set up, or a frame is still going out -- drop this one
    }
    if (protocol != IR_PROTO_NEC && protocol != IR_PROTO_SAMSUNG) {
        return;
    }
    ir_build_frame(protocol, code);

    ir_busy = true;
    ir_in_gap = false;
    ir_frames_left = (IR_OUTPUT_FRAMES > 1) ? (IR_OUTPUT_FRAMES - 1) : 0;
    ir_mark();       // segment 0 is always the leader mark
    ir_idx = 1;      // the alarm continues from segment 1
    ir_alarm_id = add_alarm_in_us(ir_buf[0], ir_alarm_cb, nullptr, false);
    if (ir_alarm_id <= 0) {
        ir_space();  // couldn't schedule -- abort cleanly
        ir_busy = false;
        ir_frames_left = 0;
    }
}

#endif  // IR_OUTPUT_ENABLED
