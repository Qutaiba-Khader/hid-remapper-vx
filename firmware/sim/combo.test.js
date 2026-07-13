/* Executable tests for the firmware's combo engine (usage page 0xFFFB).

   The firmware cannot be built or run on the maintainer's machine — CI compiles it, but
   nothing EXECUTES it until it is flashed to a Pico. These tests run the algorithm against
   the JS port in engine.js, and then check the port against remapper.cc so it cannot drift.

   Run: node --test firmware/sim/*.test.js                                                  */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeComboEngine, makeEngine } = require('./engine.js');

const CC = fs.readFileSync(path.join(__dirname, '..', 'src', 'remapper.cc'), 'utf8');
const H = fs.readFileSync(path.join(__dirname, '..', 'src', 'remapper.h'), 'utf8');
const TYPES = fs.readFileSync(path.join(__dirname, '..', 'src', 'types.h'), 'utf8');

const frame = (e, now) => { e.evaluate_combos(now); e.commitFrame(); };

/* ==================================================================== *
 * PART 1 — the engine: AND semantics, the timing window, latch, consume *
 * ==================================================================== */

test('fires only when ALL members are down (an AND, not an OR)', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 50 });

    frame(e, 1000);
    assert.strictEqual(e.comboOn(0), false, 'nothing pressed -> off');

    e.press('A'); frame(e, 2000);
    assert.strictEqual(e.comboOn(0), false, 'one key -> still off');

    e.press('B'); frame(e, 3000);
    assert.strictEqual(e.comboOn(0), true, 'both down within the window -> ON');

    e.release('A'); frame(e, 4000);
    assert.strictEqual(e.comboOn(0), false, 'release one -> off');
});

test('a 3-key combo needs all three', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }, { key: 'C' }], window_ms: 0 });
    e.press('A'); e.press('B'); frame(e, 1000);
    assert.strictEqual(e.comboOn(0), false);
    e.press('C'); frame(e, 2000);
    assert.strictEqual(e.comboOn(0), true);
});

test('a rolling press OUTSIDE the window does not fire, and cannot latch late', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 50 }); // 50 000 us

    e.press('A'); frame(e, 1_000_000);
    e.press('B'); frame(e, 3_000_000); // 2s later
    assert.strictEqual(e.comboOn(0), false, '2s apart with a 50ms window -> must NOT fire');

    for (let n = 3_100_000; n < 4_000_000; n += 100_000) frame(e, n);
    assert.strictEqual(e.comboOn(0), false, 'and it must not latch later while still held');
});

test('a press within the window fires', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 50 });
    e.press('A'); frame(e, 1_000_000);
    e.press('B'); frame(e, 1_030_000); // 30ms later, inside 50ms
    assert.strictEqual(e.comboOn(0), true);
});

test('boundary: exactly at the window still fires (the comparison is <=)', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 50 });
    e.press('A'); frame(e, 1_000_000);
    e.press('B'); frame(e, 1_050_000); // exactly 50ms
    assert.strictEqual(e.comboOn(0), true);
});

test('window 0 = a pure AND: any rolling press fires, however slow', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 0 });
    e.press('A'); frame(e, 1_000_000);
    e.press('B'); frame(e, 9_000_000); // 8 seconds later
    assert.strictEqual(e.comboOn(0), true, 'window 0 must ignore timing entirely');
});

test('a simultaneous press in the SAME frame fires (first_rise == last_rise)', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 50 });
    e.press('A'); e.press('B'); frame(e, 1_000_000);
    assert.strictEqual(e.comboOn(0), true, 'the difference is 0 — it must not underflow');
});

test('LATCHES: stays on while held, long past the window', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 50 });
    e.press('A'); frame(e, 1_000_000);
    e.press('B'); frame(e, 1_010_000);
    assert.strictEqual(e.comboOn(0), true);
    for (let n = 1_100_000; n < 5_000_000; n += 200_000) frame(e, n);
    assert.strictEqual(e.comboOn(0), true, 'must stay latched while both are held');
});

test('re-arms after release: a failed combo can succeed on the next attempt', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 50 });
    e.press('A'); frame(e, 1_000_000);
    e.press('B'); frame(e, 2_000_000); // too slow
    assert.strictEqual(e.comboOn(0), false);

    e.release('A'); e.release('B'); frame(e, 2_100_000);

    e.press('A'); frame(e, 3_000_000);
    e.press('B'); frame(e, 3_020_000); // quick
    assert.strictEqual(e.comboOn(0), true, 'must re-arm cleanly');
});

test('a partial release then a re-press outside the window does not re-fire', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 50 });
    e.press('A'); e.press('B'); frame(e, 1_000_000);
    assert.strictEqual(e.comboOn(0), true);
    e.release('B'); frame(e, 1_500_000);
    assert.strictEqual(e.comboOn(0), false, 'one released -> off');
    e.press('B'); frame(e, 1_520_000);
    // A rose at 1.0s, B at 1.52s -> 520ms apart with a 50ms window
    assert.strictEqual(e.comboOn(0), false);
});

test('consume marks member slots ONLY while the combo is latched', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A', consume: true }, { key: 'B', consume: true }], window_ms: 50 });

    e.press('A'); frame(e, 1_000_000);
    assert.strictEqual(e.consumed('A'), false, 'not consumed while the combo is inactive');

    e.press('B'); frame(e, 1_010_000);
    assert.strictEqual(e.comboOn(0), true);
    assert.strictEqual(e.consumed('A'), true, 'consumed while held');
    assert.strictEqual(e.consumed('B'), true);

    e.release('A'); frame(e, 1_100_000);
    assert.strictEqual(e.consumed('A'), false, 'consumption cleared on release');
    assert.strictEqual(e.consumed('B'), false);
});

test('consume=false leaves the keys firing (the combo is additive)', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A', consume: false }, { key: 'B', consume: false }], window_ms: 50 });
    e.press('A'); e.press('B'); frame(e, 1_000_000);
    assert.strictEqual(e.comboOn(0), true);
    assert.strictEqual(e.consumed('A'), false);
});

test('consume is PER MEMBER: only the flagged member is suppressed', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A', consume: true }, { key: 'B', consume: false }], window_ms: 50 });
    e.press('A'); e.press('B'); frame(e, 1_000_000);
    assert.strictEqual(e.consumed('A'), true);
    assert.strictEqual(e.consumed('B'), false);
});

test('a combo that MISSED its window does not consume its keys', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A', consume: true }, { key: 'B', consume: true }], window_ms: 50 });
    e.press('A'); frame(e, 1_000_000);
    e.press('B'); frame(e, 5_000_000);
    assert.strictEqual(e.comboOn(0), false);
    assert.strictEqual(e.consumed('A'), false, 'the keys must keep working when the combo did not fire');
    assert.strictEqual(e.consumed('B'), false);
});

test('a combo does not fire while its layer is inactive', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A', layer_mask: 0b10 }, { key: 'B', layer_mask: 0b10 }], window_ms: 0 });
    e.setLayers(0b01); // layer 0 active; the combo lives on layer 1
    e.press('A'); e.press('B'); frame(e, 1_000_000);
    assert.strictEqual(e.comboOn(0), false);
    e.setLayers(0b10);
    frame(e, 1_100_000);
    assert.strictEqual(e.comboOn(0), true);
});

test('two combos sharing a key are independent and can both be active', () => {
    const e = makeComboEngine();
    e.addCombo({ members: [{ key: 'A', consume: true }, { key: 'B', consume: true }], window_ms: 0 });
    e.addCombo({ members: [{ key: 'A', consume: true }, { key: 'C', consume: true }], window_ms: 0 });

    e.press('A'); e.press('B'); frame(e, 1_000_000);
    assert.strictEqual(e.comboOn(0), true);
    assert.strictEqual(e.comboOn(1), false, 'C is not down -> combo 1 is off');
    assert.strictEqual(e.consumed('A'), true);

    e.press('C'); frame(e, 1_100_000);
    assert.strictEqual(e.comboOn(0), true);
    assert.strictEqual(e.comboOn(1), true);
});

test('an empty combo slot is skipped, not crashed on', () => {
    const e = makeComboEngine();
    e.combos.push({ window_us: 0, out_state: null, latched: false, members: [] });
    e.addCombo({ members: [{ key: 'A' }, { key: 'B' }], window_ms: 0 });
    e.press('A'); e.press('B'); frame(e, 1000);
    assert.strictEqual(e.comboOn(1), true);
});

/* ==================================================================== *
 * PART 2 — the FULL pipeline: what the host actually receives.          *
 * This is the exact sequence run on the hardware.                       *
 * ==================================================================== */

const VOLUP = 0x000c00e9, VOLDN = 0x000c00ea, MUTE = 0x000c00e2, PLAY = 0x000c00cd, LAYER1 = 0xfff10001;
const hex = (u) => '0x' + u.toString(16).padStart(8, '0');
const NAMES = { [VOLUP]: 'Vol+', [VOLDN]: 'Vol-', [MUTE]: 'Mute', [PLAY]: 'Play', [LAYER1]: 'Layer 1' };
const show = (s) => [...s].map((u) => NAMES[u] || hex(u)).sort().join(' + ') || '(nothing)';

// exactly what the web tool writes for: Vol+ & Vol- -> Mute, window 50ms
const comboConfig = (consume) => [
    { source: VOLUP, target: 0xfffb0001, scaling: 50, layers: [0], consume },
    { source: VOLDN, target: 0xfffb0001, scaling: 50, layers: [0], consume },
    { source: 0xfffb0001, target: MUTE, scaling: 1000, layers: [0] },
];
// the device knows these usages, and unmapped passthrough is on for all 8 layers (the default)
const OUR = [VOLUP, VOLDN, MUTE, PLAY];
const withCombo = (consume = true) => makeEngine({ mappings: comboConfig(consume), ourUsages: OUR });

test('EACH MEMBER KEY STILL FIRES ON ITS OWN — the regression that firmware bug #8 caused', () => {
    // Combo members must NOT be marked in mapped_on_layers. When they were, their
    // unmapped-passthrough source was suppressed and a key used only in a combo went
    // completely dead when pressed alone. This is the single most important check here.
    for (const [key, name] of [[VOLUP, 'Vol+'], [VOLDN, 'Vol-']]) {
        const e = withCombo();
        assert.ok(e.isPassthrough(key), name + ' must keep its passthrough source');
        e.press(key);
        const out = e.frame(1_000_000);
        assert.deepStrictEqual([...out], [key], name + ' alone must reach the host, got ' + show(out));
    }
});

test('an unrelated key is untouched by the combo', () => {
    const e = withCombo();
    e.press(PLAY);
    assert.deepStrictEqual([...e.frame(1_000_000)], [PLAY]);
});

test('both members held, consume ON -> the host sees ONLY the combo output', () => {
    const e = withCombo(true);
    e.press(VOLUP); e.press(VOLDN);
    const out = e.frame(1_000_000);
    assert.deepStrictEqual([...out], [MUTE], 'the member keys must be suppressed, got ' + show(out));
});

test('both members held, consume OFF -> all three fire', () => {
    const e = withCombo(false);
    e.press(VOLUP); e.press(VOLDN);
    const out = e.frame(1_000_000);
    assert.deepStrictEqual([...out].sort(), [MUTE, VOLUP, VOLDN].sort(), 'got ' + show(out));
});

test('a slow rolling press misses the window: no combo, and both keys still work', () => {
    const e = withCombo();
    e.press(VOLUP); e.frame(1_000_000);
    e.press(VOLDN);
    const out = e.frame(3_000_000); // 2s later, 50ms window
    assert.ok(!out.has(MUTE), 'Mute must not fire: ' + show(out));
    assert.ok(out.has(VOLUP) && out.has(VOLDN), 'and both keys must still reach the host: ' + show(out));
});

test('window 0 -> that same slow rolling press DOES fire the combo', () => {
    const cfg = comboConfig(true);
    cfg[0].scaling = 0; cfg[1].scaling = 0;
    const e = makeEngine({ mappings: cfg, ourUsages: OUR });
    e.press(VOLUP); e.frame(1_000_000);
    e.press(VOLDN);
    assert.deepStrictEqual([...e.frame(9_000_000)], [MUTE]);
});

test('releasing one member drops the combo and the other key resumes', () => {
    const e = withCombo();
    e.press(VOLUP); e.press(VOLDN);
    assert.deepStrictEqual([...e.frame(1_000_000)], [MUTE]);
    e.release(VOLDN);
    const out = e.frame(1_100_000);
    assert.deepStrictEqual([...out], [VOLUP], 'Vol+ must come back: ' + show(out));
});

test('releasing both members leaves nothing pressed', () => {
    const e = withCombo();
    e.press(VOLUP); e.press(VOLDN); e.frame(1_000_000);
    e.release(VOLUP); e.release(VOLDN);
    assert.strictEqual(e.frame(1_100_000).size, 0);
});

test('a combo can drive a layer', () => {
    const cfg = comboConfig(true);
    cfg[2].target = LAYER1;
    const e = makeEngine({ mappings: cfg, ourUsages: OUR });
    e.press(VOLUP); e.press(VOLDN);
    assert.ok(e.frame(1_000_000).has(LAYER1), 'the layer target must be driven');
});

test('a config with NO combos behaves exactly as before', () => {
    const plain = makeEngine({ mappings: [], ourUsages: OUR });
    plain.press(VOLUP);
    assert.deepStrictEqual([...plain.frame(1_000_000)], [VOLUP], 'passthrough must be untouched');

    const remapped = makeEngine({ mappings: [{ source: VOLUP, target: PLAY, scaling: 1000, layers: [0] }], ourUsages: OUR });
    remapped.press(VOLUP);
    const out = remapped.frame(1_000_000);
    assert.deepStrictEqual([...out], [PLAY], 'an ordinary mapping must still override passthrough: ' + show(out));
});

/* ==================================================================== *
 * PART 3 — drift guards. The port above is only worth anything while it *
 * still matches the C++. These read the firmware source and fail if an  *
 * invariant the simulation depends on is edited away.                   *
 * ==================================================================== */

test('the combo page constant matches the firmware', () => {
    assert.match(H, /#define COMBO_USAGE_PAGE 0xFFFB0000/,
        'engine.js hard-codes 0xFFFB — remapper.h must still agree');
});

test('combo members are NOT marked in mapped_on_layers (firmware bug #8 must stay fixed)', () => {
    // The member branch runs from `if ((mapping.target_usage & 0xFFFF0000) == COMBO_USAGE_PAGE)`
    // to its `continue;`. If mapped_on_layers is ever assigned inside it, every key used only
    // in a combo goes dead when pressed alone — the exact bug this suite exists to catch.
    const start = CC.indexOf('if ((mapping.target_usage & 0xFFFF0000) == COMBO_USAGE_PAGE)');
    assert.ok(start > 0, 'the combo member branch must exist in remapper.cc');
    const branch = CC.slice(start, CC.indexOf('continue;', start));
    assert.ok(!/mapped_on_layers\s*\[[^\]]*\]\s*(\|)?=/.test(branch),
        'a combo member must not be marked as mapped — that suppresses its passthrough source ' +
        'and kills the key when pressed on its own');
});

test('a combo-page SOURCE is forced to port 0, so the trigger reads what the members write', () => {
    assert.match(CC, /\(\(mapping\.source_usage & 0xFFFF0000\) == COMBO_USAGE_PAGE\)/,
        'the combo page must be in the force-port-0 list alongside EXPR/REGISTER/GPIO — ' +
        'otherwise the trigger reads a different state slot than the members write and never fires');
});

test('evaluate_combos runs BEFORE the layer, macro and output loops', () => {
    const evalAt = CC.indexOf('evaluate_combos(now);');
    assert.ok(evalAt > 0, 'evaluate_combos must be called from process_mapping');
    const processAt = CC.indexOf('void process_mapping(');
    assert.ok(evalAt > processAt, 'and it must be called inside process_mapping');
    // every consumer of the combo output must come after it
    for (const marker of ['for (auto& map_source : reverse_mapping', 'macro_entry_duration']) {
        const at = CC.indexOf(marker, processAt);
        if (at > 0) assert.ok(at > evalAt, marker + ' must run after evaluate_combos');
    }
});

test('the timing window is inclusive and window 0 means "no window"', () => {
    assert.match(CC, /combo\.latched = \(combo\.window_us == 0\) \|\| \(\(last_rise - first_rise\) <= combo\.window_us\)/,
        'the sim asserts the boundary (exactly at the window fires) — the C++ must use <=');
});

test('the window is read from `scaling` in ms and the consume flag from bit 3', () => {
    assert.match(CC, /const uint8_t MAPPING_FLAG_COMBO_CONSUME = 1 << 3;/,
        'bits 0-2 are STICKY/TAP/HOLD; the combo flag must stay on the free bit 3');
    assert.match(CC, /combo\.window_us = \(mapping\.scaling > 0\) \? \(\(uint32_t\) mapping\.scaling \* 1000\) : 0;/,
        'the window rides in the unused `scaling` field as milliseconds; get_time() is in us');
    assert.match(TYPES, /uint64_t rise_at;/, 'rise_at must stay a 64-bit us timestamp');
});

test('combos cost nothing when the feature is compiled out, but are ON by default', () => {
    assert.ok(CC.includes('#ifdef COMBO_ENABLED'),
        'every combo block must be guarded so -DCOMBO_ENABLED=OFF is byte-identical to upstream ' +
        '(CLAUDE.md golden rule #1)');
    const cmake = fs.readFileSync(path.join(__dirname, '..', 'CMakeLists.txt'), 'utf8');
    assert.match(cmake, /option\(COMBO_ENABLED[\s\S]*?\sON\)/,
        'default ON for VX, so the eight .uf2 filenames do not change');
    assert.match(cmake, /add_compile_definitions\(COMBO_ENABLED\)/);
});

test('the nRF52840 build defines COMBO_ENABLED too (firmware bug #9)', () => {
    // firmware-bluetooth compiles the SAME remapper.cc. It has its own CMakeLists, so it does
    // not inherit the option — without this line the Bluetooth boards silently ignore combos.
    const bt = fs.readFileSync(path.join(__dirname, '..', '..', 'firmware-bluetooth', 'CMakeLists.txt'), 'utf8');
    assert.match(bt, /add_compile_definitions\(COMBO_ENABLED\)/,
        'the Bluetooth build shares remapper.cc but not the option — it must define the macro itself');
});

test('NCOMBOS agrees between the firmware and the simulation', () => {
    const m = CC.match(/#define NCOMBOS (\d+)/);
    assert.ok(m, 'NCOMBOS must be defined');
    assert.strictEqual(Number(m[1]), require('./engine.js').NCOMBOS);
});
