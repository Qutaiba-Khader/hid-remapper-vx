/* A JS port of the parts of firmware/src/remapper.cc that decide what the host actually
   receives, so the mapping engine can be exercised without a C++ toolchain.

   This exists because the firmware CANNOT be built or run on the maintainer's machine
   (Windows, no Pico SDK) — CI compiles it, but nothing executes it until it is on a Pico.
   The combo engine is the one piece whose behaviour is timing- and edge-dependent enough
   that "it compiles" says almost nothing. So we run the algorithm here.

   It is a HAND-PORT. It mirrors the C++ line-for-line — same variable names, same order,
   same comparisons — so a divergence is visible in a diff. combo.test.js additionally reads
   remapper.cc and asserts the invariants this port depends on are still present, so the two
   cannot drift apart silently.

   A NOTE ON THE ONE PLACE JS AND C++ DISAGREE
   In C++, `mapping.target_usage & 0xFFFF0000` is a uint32_t. In JS, `&` yields a *signed*
   int32, so `0xfffb0000 & 0xffff0000` is -327680, which never equals the literal 0xfffb0000.
   Every page comparison below therefore coerces back with `>>> 0`. Getting this wrong makes
   the sim silently classify combo members as ordinary mappings — it does not throw, it just
   quietly tests the wrong thing. */

const MAX_INPUT_STATES = 1024;
const PREV = MAX_INPUT_STATES; // input_state[i + PREV] stands in for prev_input_state[i]
const UINT64_MAX = Number.MAX_SAFE_INTEGER;
const COMBO_PAGE = 0xfffb0000;
const NCOMBOS = 16;
// How long a swallowed press is replayed for. Long enough that the host reliably sees a
// press AND a release (it polls at 1-8ms); short enough to feel instant.
const COMBO_REPLAY_US = 15000;

const onPage = (usage, page) => ((usage & 0xffff0000) >>> 0) === page;

/* ------------------------------------------------------------------ *
 * Level 1: evaluate_combos() alone — the AND gate, the timing window, *
 * the latch and the consume flag.                                     *
 * ------------------------------------------------------------------ */
function makeComboEngine() {
    const input_state = new Int32Array(MAX_INPUT_STATES * 2);
    const combo_consumed = new Uint8Array(MAX_INPUT_STATES);
    let layer_state_mask = 1;
    const combos = [];
    let nextSlot = 0;
    const slotOf = {};
    const slot = (name) => (slotOf[name] === undefined ? (slotOf[name] = nextSlot++) : slotOf[name]);

    function addCombo({ members, window_ms }) {
        combos.push({
            window_us: window_ms > 0 ? window_ms * 1000 : 0,
            out_state: slot('combo_out_' + combos.length),
            latched: false,
            members: members.map((m) => ({
                input_state: slot(m.key),
                layer_mask: m.layer_mask === undefined ? 1 : m.layer_mask,
                consume: !!m.consume,
                rise_at: 0,
            })),
        });
        return combos[combos.length - 1];
    }

    // --- the port of evaluate_combos() ---
    function evaluate_combos(now) {
        combo_consumed.fill(0);

        for (const combo of combos) {
            if (combo.members.length === 0 || combo.out_state === null) continue;

            let all_down = true;
            let first_rise = UINT64_MAX;
            let last_rise = 0;

            for (const member of combo.members) {
                if (input_state[member.input_state] !== 0 && input_state[member.input_state + PREV] === 0) {
                    member.rise_at = now;
                }
                if (input_state[member.input_state] === 0 || !(layer_state_mask & member.layer_mask)) {
                    all_down = false;
                    continue;
                }
                if (member.rise_at < first_rise) first_rise = member.rise_at;
                if (member.rise_at > last_rise) last_rise = member.rise_at;
            }

            if (!all_down) {
                combo.latched = false;
                input_state[combo.out_state] = 0;
                // PENDING: partially down, window not yet expired -> hold the consuming members
                // back, because a press once sent to the host cannot be un-sent.
                if (combo.window_us > 0 && first_rise !== UINT64_MAX && now - first_rise <= combo.window_us) {
                    for (const member of combo.members) {
                        if (member.consume) combo_consumed[member.input_state] = 1;
                    }
                }
                continue;
            }

            if (!combo.latched) {
                combo.latched = combo.window_us === 0 || last_rise - first_rise <= combo.window_us;
            }

            input_state[combo.out_state] = combo.latched ? 1 : 0;

            if (combo.latched) {
                for (const member of combo.members) {
                    if (member.consume) combo_consumed[member.input_state] = 1;
                }
            }
        }
    }

    // end of process_mapping(): prev_input_state <- input_state
    const commitFrame = () => input_state.copyWithin(PREV, 0, MAX_INPUT_STATES);

    return {
        input_state, combo_consumed, combos, addCombo, evaluate_combos, commitFrame, slot,
        press: (k) => { input_state[slot(k)] = 1; },
        release: (k) => { input_state[slot(k)] = 0; },
        comboOn: (i) => input_state[combos[i].out_state] === 1,
        consumed: (k) => combo_consumed[slot(k)] === 1,
        setLayers: (m) => { layer_state_mask = m; },
    };
}

/* ------------------------------------------------------------------ *
 * Level 2: the FULL pipeline — what the host actually receives.       *
 *                                                                     *
 * set_mapping_from_config(): state slots, the combo build,            *
 *   mapped_on_layers, and the unmapped-passthrough sources            *
 * process_mapping(): evaluate_combos -> consumption -> the output loop*
 *                                                                     *
 * This is the level that catches the class of bug where the combo     *
 * engine is perfectly correct but a member key stops working when     *
 * pressed on its own.                                                 *
 * ------------------------------------------------------------------ */
function makeEngine({ mappings, passthroughMask = 0b11111111, ourUsages }) {
    const input_state = new Int32Array(MAX_INPUT_STATES * 2);
    const combo_consumed = new Uint8Array(MAX_INPUT_STATES);
    const combo_deferred = new Uint8Array(MAX_INPUT_STATES);   // press held back, host never saw it
    const combo_fired = new Uint8Array(MAX_INPUT_STATES);      // that press was spent on a combo
    const combo_replay_until = new Float64Array(MAX_INPUT_STATES); // us; replaying an owed tap
    let layer_state_mask = 1;
    let used = 0;
    const slotOf = new Map();
    const assign = (usage, port = 0) => {
        const k = port * 2 ** 32 + usage;
        if (!slotOf.has(k)) slotOf.set(k, used++);
        return slotOf.get(k);
    };
    const ptr = (usage, port = 0) => slotOf.get(port * 2 ** 32 + usage);

    /* ---------- set_mapping_from_config() ---------- */
    const combos = Array.from({ length: NCOMBOS }, () => ({ window_us: 0, out: null, latched: false, members: [] }));
    const reverse = new Map(); // target usage -> [sources]
    const mapped_on_layers = new Map(); // source usage -> layer mask

    const addSource = (target, src) => {
        if (!reverse.has(target)) reverse.set(target, []);
        reverse.get(target).push(src);
    };

    for (const m of mappings) {
        const layer_mask = m.layers.reduce((acc, l) => acc | (1 << l), 0);

        // --- the combo MEMBER branch ---
        if (onPage(m.target, COMBO_PAGE)) {
            const id = m.target & 0xffff;
            if (id < 1 || id > NCOMBOS) continue;
            const combo = combos[id - 1];
            assign(m.source, m.source_port || 0);
            assign(m.target, 0);
            combo.out = ptr(m.target, 0);
            if (combo.members.length === 0) combo.window_us = m.scaling > 0 ? m.scaling * 1000 : 0;
            combo.members.push({
                input_state: ptr(m.source, m.source_port || 0),
                layer_mask,
                consume: !!m.consume,
                rise_at: 0,
            });
            // THE FIX (firmware bug #8): mapped_on_layers is deliberately NOT touched here.
            // Marking a member as "mapped" suppresses its unmapped-passthrough source, which
            // made a key used ONLY in a combo go completely dead when pressed on its own.
            continue;
        }

        // --- an ordinary mapping (this includes the combo TRIGGER, whose SOURCE is on the
        //     combo page; like EXPR/REGISTER/GPIO, such a source is forced to port 0 so it
        //     reads the same state slot the members write) ---
        const port = onPage(m.source, COMBO_PAGE) ? 0 : (m.source_port || 0);
        assign(m.source, port);
        addSource(m.target, {
            usage: m.source,
            input_state: ptr(m.source, port),
            layer_mask,
            scaling: m.scaling == null ? 1000 : m.scaling,
        });
        mapped_on_layers.set(m.source, (mapped_on_layers.get(m.source) || 0) | layer_mask);
    }

    // --- unmapped passthrough: a source for every usage NOT claimed by a mapping ---
    if (passthroughMask) {
        for (const usage of ourUsages) {
            const unmapped = passthroughMask & ~(mapped_on_layers.get(usage) || 0);
            if (unmapped) {
                assign(usage, 0);
                addSource(usage, { usage, input_state: ptr(usage, 0), layer_mask: unmapped, scaling: 1000, passthrough: true });
            }
        }
    }

    /* ---------- process_mapping() ---------- */
    const monitored = []; // what the web tool's Monitor tab would show for the combo slots

    function evaluate_combos(now) {
        combo_consumed.fill(0);

        /* 1. A REPLAYED TAP. If we held a key back and you let go before the window expired,
              the combo never happened and we still OWE you that press. We cannot send it
              retroactively, so we send it NOW as a real press-and-release. Without this, every
              ordinary click of a combo member is swallowed: a click is 30-50ms, the window is
              50ms, so you never hold long enough for the deferral to give the key back. The
              symptom is "the button only works if I hold it". */
        for (const combo of combos) {
            for (const mem of combo.members) {
                const slot = mem.input_state;
                if (!combo_replay_until[slot]) continue;
                if (now >= combo_replay_until[slot]) {
                    combo_replay_until[slot] = 0;
                    input_state[slot] = 0; // end of the tap: release
                } else {
                    input_state[slot] = 1; // hold the replayed press
                }
            }
        }
        const replaying = (slot) => combo_replay_until[slot] !== 0;

        for (let i = 0; i < combos.length; i++) {
            const combo = combos[i];
            if (!combo.members.length || combo.out === null) continue;

            let all_down = true, first = UINT64_MAX, last = 0;
            for (const mem of combo.members) {
                // a key we are replaying is NOT physically down — it must not drive the combo
                if (replaying(mem.input_state)) { all_down = false; continue; }
                if (input_state[mem.input_state] !== 0 && input_state[mem.input_state + PREV] === 0) mem.rise_at = now;
                if (input_state[mem.input_state] === 0 || !(layer_state_mask & mem.layer_mask)) { all_down = false; continue; }
                if (mem.rise_at < first) first = mem.rise_at;
                if (mem.rise_at > last) last = mem.rise_at;
            }

            let new_out = 0;
            if (!all_down) {
                combo.latched = false;
                // PENDING: partially down, window not yet expired -> hold back the consuming
                // members, because a press once sent to the host cannot be un-sent.
                if (combo.window_us > 0 && first !== UINT64_MAX && now - first <= combo.window_us) {
                    for (const mem of combo.members) if (mem.consume) combo_consumed[mem.input_state] = 1;
                }
            } else {
                if (!combo.latched) combo.latched = combo.window_us === 0 || last - first <= combo.window_us;
                new_out = combo.latched ? 1 : 0;
                if (combo.latched) {
                    for (const mem of combo.members) {
                        if (mem.consume) {
                            combo_consumed[mem.input_state] = 1;
                            // the press was spent ON THE COMBO — we no longer owe a click
                            combo_fired[mem.input_state] = 1;
                        }
                    }
                }
            }

            if (input_state[combo.out] !== new_out) monitored.push({ combo: i + 1, value: new_out });
            input_state[combo.out] = new_out;
        }

        // a key being replayed is never suppressed (a pending combo consumes ALL its members,
        // even the ones that are up — that would eat the replay)
        for (const combo of combos) {
            for (const mem of combo.members) {
                if (replaying(mem.input_state)) combo_consumed[mem.input_state] = 0;
            }
        }

        /* 2. deferral bookkeeping */
        for (const combo of combos) {
            for (const mem of combo.members) {
                const slot = mem.input_state;
                if (replaying(slot)) continue;

                if (input_state[slot] !== 0) {
                    if (combo_consumed[slot]) {
                        // held back; remember the host has never seen this press
                        if (input_state[slot + PREV] === 0) combo_deferred[slot] = 1;
                    } else if (combo_deferred[slot]) {
                        // still held, but the combo failed -> deliver it late, with a real edge
                        combo_deferred[slot] = 0;
                        input_state[slot + PREV] = 0;
                    }
                } else {
                    // released. If we still owe the press AND no combo used it, replay it as a tap.
                    if (combo_deferred[slot] && !combo_fired[slot]) {
                        combo_replay_until[slot] = now + COMBO_REPLAY_US;
                        input_state[slot] = 1;        // start the tap now...
                        input_state[slot + PREV] = 0; // ...with a rising edge
                    }
                    combo_deferred[slot] = 0;
                    combo_fired[slot] = 0;
                }
            }
        }
    }
    const is_consumed = (src) => combo_consumed[src.input_state] === 1;
    const rising = (src) => input_state[src.input_state] !== 0 && input_state[src.input_state + PREV] === 0;

    // one pass of the mapping engine; returns the set of target usages the host sees as pressed
    const lastEdges = new Set(); // source usages with an un-consumed rising edge -> macros fire
    function frame(now) {
        evaluate_combos(now);
        lastEdges.clear();
        const out = new Set();
        for (const [target, sources] of reverse) {
            let value = 0;
            for (const src of sources) {
                if (is_consumed(src)) continue; // the per-member consume flag
                if (!(layer_state_mask & src.layer_mask)) continue;
                if (rising(src)) lastEdges.add(src.usage);
                if (input_state[src.input_state] !== 0) {
                    value += Math.trunc(input_state[src.input_state] * src.scaling / 1000);
                }
            }
            if (value !== 0) out.add(target);
        }
        input_state.copyWithin(PREV, 0, MAX_INPUT_STATES); // prev <- current
        return out;
    }

    return {
        frame,
        press: (u, p = 0) => { input_state[ptr(u, p)] = 1; },
        release: (u, p = 0) => { input_state[ptr(u, p)] = 0; },
        setLayers: (m) => { layer_state_mask = m; },
        isPassthrough: (u) => (reverse.get(u) || []).some((s) => s.passthrough),
        // a rising edge on this source this frame -> a macro / tap-hold / sticky bound to it fires
        firedEdge: (u) => lastEdges.has(u),
        // what the web tool's Monitor tab would have shown for the combo state slots
        monitorLog: () => monitored,
    };
}

module.exports = { makeComboEngine, makeEngine, COMBO_PAGE, NCOMBOS, onPage };
