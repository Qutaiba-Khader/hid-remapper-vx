# Native Combo Support — Implementation Plan

## ✅ STATUS: BUILT, CI-VERIFIED, RELEASED (2026-07-13). Only the hardware test remains.

Tasks 1–7 done. Firmware and web tool are on `master` (`2af9565`), released as **`r2026-07-13`**
(Latest — includes the nRF52840 Bluetooth builds), and the web tool is live on GitHub Pages.

- **Design held:** a combo is an **AND-gate on usage page `0xFFFB`**, persisted as three ordinary
  mappings (N members + 1 trigger). **`CONFIG_VERSION` stayed 18** — the per-combo timing window
  rides in the members' unused `scaling` (ms) and per-member *consume* in free `flags` bit 3.
- **CMake `COMBO_ENABLED` defaults ON** → no `.uf2` filename changed; `-DCOMBO_ENABLED=OFF` gives an
  upstream-identical build. **Also enabled for the nRF52840 build** (`firmware-bluetooth/CMakeLists.txt`
  compiles the same `remapper.cc` but never defined it — Bluetooth boards would have silently
  ignored combos).
- **Firmware bug caught in review:** the combo member branch marked its key in `mapped_on_layers`, so
  a key used ONLY in a combo silently **stopped working when pressed alone** (unmapped passthrough
  defaults to all 8 layers). Fixed — suppression is the *consume* flag's job, and it is dynamic.
- **Verified without hardware:** `evaluate_combos()` was ported line-for-line to JS and exercised
  with 17 behavioural cases (AND semantics, the timing window, latch/re-arm, per-member consume,
  layer gating). The web side has 104 tests, including a full end-to-end flow against a fake device
  that asserts the exact bytes on the wire.

### ⏳ Task 8 — the hardware test on `JJ8S` ONLY (never `CUSS`)
Flash from the Actions tab, open the tool, **Open device** (it auto-loads), then:
(a) add `Vol+ & Vol- → Mute`, Win 50, Consume on → Save → reload → comes back as **ONE** combo row;
**(b) each key alone still fires** ← this is what the firmware bug above broke;
(c) both together → Mute only; (d) Consume off → all three fire;
(e) hold Vol+ ~2 s then tap Vol- → does **NOT** fire; set Win 0 → it does;
(f) a combo drives a layer; (g) an old non-combo config behaves identically.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make combos (N inputs pressed together → one output) real: persisted on the device and evaluated by the firmware, instead of being parked in a web-only JSON field.

**Architecture:** A combo is an **AND-gate usage page**. Usage page `0xFFFB` is COMBO; a target on that page is the logical AND of its sources (every other target sums its sources, which is an OR). One combo persists as three ordinary mappings — two members (`key → 0xfffb0001`) and one trigger (`0xfffb0001 → output`) — so `mapping_config11_t` and `persist_config_t` are untouched. The per-combo timing window rides in the members' otherwise-unused `scaling` field; per-member "consume" rides in free `flags` bit 3.

**Tech Stack:** C++17 (Pico SDK, RP2040/RP2350), vanilla JS (no build step), Node 22 `node --test`.

**Spec:** `docs/superpowers/specs/2026-07-13-firmware-combos-design.md`

## Global Constraints

- **`CONFIG_VERSION` stays 18.** No field may be added to `mapping_config11_t` or `persist_config_t`. If you find yourself needing one, stop and re-read the spec.
- **Combo usage page is `0xFFFB0000`.** Ids 1–16 (`NCOMBOS = 16`). Out-of-range ids are ignored.
- **`flags` bit 3 = `MAPPING_FLAG_COMBO_CONSUME` (`1 << 3`).** Bits 0–2 are STICKY/TAP/HOLD and must not be touched. Bits 4–7 stay free.
- **On a mapping targeting the combo page, `scaling` means the combo window in milliseconds** (`0` = no timing check). `get_time()` returns **microseconds**, so compare against `window_ms * 1000`.
- **Firmware does not build on this machine** (Windows, no Pico SDK — CLAUDE.md rule #3). Verify firmware via GitHub Actions: `gh run watch <id> --exit-status` and read the "Verify artifacts" step. Never claim a firmware change compiles without that.
- **Firmware filenames must not change** (CLAUDE.md rule #4). `COMBO_ENABLED` defaults ON, so the existing 8 `.uf2` names gain combos and no new file appears.
- **Hardware testing happens on the device named `JJ8S` ONLY.** `CUSS` is the owner's live device — never save, flash, or pair to it. Confirm the name in the device bar before any write.
- **Do not modify `config-tool-web/`** (the live tool). All web work is in `config-tool-web-v2/`.
- **Web UI: pure white text in dark surfaces, never grey** (CLAUDE.md rule #5).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `config-tool-web-v2/tests/translate.test.js` | **Create.** Node unit tests for combo compile/fold. |
| `config-tool-web-v2/js/translate.js` | **Modify.** Compile combo rows → 3 mappings; fold 3 mappings → 1 row. Drop `combos[]`/`combo_window`. |
| `config-tool-web-v2/js/device.js` | **Modify.** Send/read `flags` bit 3. |
| `config-tool-web-v2/js/state.js` | **Modify.** Per-mapping `comboWindow`/`comboConsume`; drop global `settings.comboWindow`. |
| `config-tool-web-v2/js/mappings.js` | **Modify.** Combo row UI for window + consume; delete inline/stacked dead code. |
| `config-tool-web-v2/js/tabs.js` | **Modify.** Remove the global "Combo window" Settings field. |
| `firmware/src/remapper.h` | **Modify.** `COMBO_USAGE_PAGE`. |
| `firmware/src/types.h` | **Modify.** `combo_member_t`, `combo_t`. |
| `firmware/src/remapper.cc` | **Modify.** Build combos in `set_mapping_from_config()`; `evaluate_combos()` + consumption in `process_mapping()`. |
| `firmware/CMakeLists.txt` | **Modify.** `option(COMBO_ENABLED ... ON)`. |
| `CLAUDE.md`, `CODEMAP.md`, `CHANGELOG.md` | **Modify.** Record page `0xFFFB` as taken; document the feature. |

---

### Task 1: Node test harness + combo compile (`appToConfig`)

**Files:**
- Create: `config-tool-web-v2/tests/translate.test.js`
- Modify: `config-tool-web-v2/js/translate.js`

**Interfaces:**
- Consumes: existing `module.exports` from `js/translate.js` (`appToConfig`, `configToApp`, `normHex`).
- Produces: `COMBO_USAGE_PAGE = 0xfffb0000`, `NCOMBOS = 16`, and `appToConfig(APP, {forDevice})` now emitting combo mappings. Task 2 relies on the exact mapping shape below.

**Contract.** An APP row `{inputs:[A,B], output:X, scale:1, layers:[t,f,...], sticky/tap/hold, comboWindow:50, comboConsume:true}` compiles to, in this order:

```
{source_usage: A, target_usage: '0xfffb0001', scaling: 50,   layers: L, combo_consume: true,  sticky:false, tap:false, hold:false}
{source_usage: B, target_usage: '0xfffb0001', scaling: 50,   layers: L, combo_consume: true,  sticky:false, tap:false, hold:false}
{source_usage: '0xfffb0001', target_usage: X, scaling: 1000, layers: L, combo_consume: false, sticky/tap/hold from the row}
```

Combo ids are assigned 1..N in row order. Rows beyond `NCOMBOS` are dropped (and reported by the caller).

- [ ] **Step 1: Write the failing test**

Create `config-tool-web-v2/tests/translate.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const T = require("../js/translate.js");

const L0 = [true, false, false, false, false, false, false, false];

function appWith(mappings) {
  return { mappings, expressions: [], settings: { emulatedDevice: 0, passthrough: L0 } };
}

test("combo row compiles to 2 members + 1 trigger", () => {
  const app = appWith([
    { id: 1, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: true,
      layers: L0, sticky: false, tap: false, hold: false, scale: 1,
      comboWindow: 50, comboConsume: true },
  ]);
  const cfg = T.appToConfig(app, { forDevice: true });

  assert.strictEqual(cfg.version, 18);
  assert.strictEqual(cfg.mappings.length, 3);

  const [m1, m2, trig] = cfg.mappings;
  assert.strictEqual(m1.source_usage, "0x000c00e9");
  assert.strictEqual(m1.target_usage, "0xfffb0001");
  assert.strictEqual(m1.scaling, 50);          // window in ms
  assert.strictEqual(m1.combo_consume, true);

  assert.strictEqual(m2.source_usage, "0x000c00ea");
  assert.strictEqual(m2.target_usage, "0xfffb0001");

  assert.strictEqual(trig.source_usage, "0xfffb0001");
  assert.strictEqual(trig.target_usage, "0x000c00e2");
  assert.strictEqual(trig.scaling, 1000);      // ×1.0
  assert.strictEqual(trig.combo_consume, false);

  assert.strictEqual(cfg.combos, undefined);   // the old additive field is gone
});

test("trigger carries sticky/tap/hold, members never do", () => {
  const app = appWith([
    { id: 1, inputs: ["0x00070004", "0x00070005"], output: "0x00070029", enabled: true,
      layers: L0, sticky: true, tap: true, hold: false, scale: 2,
      comboWindow: 0, comboConsume: false },
  ]);
  const [m1, m2, trig] = T.appToConfig(app, { forDevice: true }).mappings;
  assert.strictEqual(m1.sticky, false);
  assert.strictEqual(m2.tap, false);
  assert.strictEqual(m1.scaling, 0);           // window 0 = pure AND
  assert.strictEqual(m1.combo_consume, false);
  assert.strictEqual(trig.sticky, true);
  assert.strictEqual(trig.tap, true);
  assert.strictEqual(trig.scaling, 2000);      // ×2.0
});

test("combo ids increment per combo row; singles are untouched", () => {
  const app = appWith([
    { id: 1, inputs: ["0x00070052"], output: "0x00070052", enabled: true, layers: L0, scale: 1 },
    { id: 2, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: true,
      layers: L0, scale: 1, comboWindow: 50, comboConsume: true },
    { id: 3, inputs: ["0x00070004", "0x00070005"], output: "0x00070029", enabled: true,
      layers: L0, scale: 1, comboWindow: 50, comboConsume: true },
  ]);
  const cfg = T.appToConfig(app, { forDevice: true });
  assert.strictEqual(cfg.mappings.length, 1 + 3 + 3);
  assert.strictEqual(cfg.mappings[0].target_usage, "0x00070052"); // the single
  assert.strictEqual(cfg.mappings[1].target_usage, "0xfffb0001");
  assert.strictEqual(cfg.mappings[4].target_usage, "0xfffb0002");
  assert.strictEqual(cfg.mappings[6].source_usage, "0xfffb0002");
});

test("disabled combo rows are not sent to the device", () => {
  const app = appWith([
    { id: 1, inputs: ["0x000c00e9", "0x000c00ea"], output: "0x000c00e2", enabled: false,
      layers: L0, scale: 1, comboWindow: 50, comboConsume: true },
  ]);
  assert.strictEqual(T.appToConfig(app, { forDevice: true }).mappings.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd config-tool-web-v2 && node --test tests/
```

Expected: FAIL — the current `appToConfig` puts combos in `cfg.combos` and emits 0 mappings for a combo row, so `cfg.mappings.length` is `0`, not `3`.

- [ ] **Step 3: Implement the compile side in `js/translate.js`**

Add near the top constants (after `const CONFIG_VERSION = 18;`):

```js
  const COMBO_USAGE_PAGE = 0xfffb0000;
  const NCOMBOS = 16;
  const DEFAULT_COMBO_WINDOW_MS = 50;
  const comboUsage = (id) => normHex(COMBO_USAGE_PAGE | id);
  const isComboUsage = (u) => (parseInt(normHex(u), 16) >>> 0 & 0xffff0000) === COMBO_USAGE_PAGE;
  const comboId = (u) => (parseInt(normHex(u), 16) >>> 0) & 0xffff;
```

Add the compile helper next to `appMappingToConfig`:

```js
  // A combo row -> N member mappings (key -> combo usage) + 1 trigger (combo usage -> output).
  // Window rides in the members' scaling (ms); consume rides in flags bit 3 (device.js).
  function appComboToConfigMappings(m, id) {
    const layers = boolLayersToIndices(m.layers);
    const window = m.comboWindow == null ? DEFAULT_COMBO_WINDOW_MS : Math.max(0, Math.round(m.comboWindow));
    const consume = m.comboConsume !== false;
    const target = comboUsage(id);

    const members = m.inputs.map((code) => ({
      source_usage: normHex(code),
      target_usage: target,
      layers,
      sticky: false, tap: false, hold: false,
      combo_consume: consume,
      scaling: window,
      source_port: m.source_port || 0,
      target_port: 0,
    }));

    const trigger = {
      source_usage: target,
      target_usage: normHex(m.output),
      layers,
      sticky: !!m.sticky, tap: !!m.tap, hold: !!m.hold,
      combo_consume: false,
      scaling: Math.round((m.scale == null ? 1 : m.scale) * 1000),
      source_port: 0,
      target_port: m.target_port || 0,
    };
    const color = tintToColor(m.tint);
    if (color) trigger.color = color;

    return members.concat([trigger]);
  }
```

Give `appMappingToConfig` a `combo_consume: false` field so every mapping has the same shape — add this line inside its returned object, after `hold: !!m.hold,`:

```js
      combo_consume: false,
```

Now replace the body of `appToConfig` from `const singles = ...` down to the `return config;` with:

```js
    const rows = APP.mappings || [];
    const usable = opts.forDevice ? rows.filter((m) => m.enabled !== false) : rows;

    const mappings = [];
    let nextComboId = 1;
    usable.forEach((m) => {
      if ((m.inputs || []).length > 1) {
        if (nextComboId > NCOMBOS) return;  // over the cap — caller warns
        mappings.push(...appComboToConfigMappings(m, nextComboId++));
      } else {
        mappings.push(appMappingToConfig(m));
      }
    });

    const s = APP.settings || {};
    const config = {
      version: CONFIG_VERSION,
      mappings,
      expressions: (APP.expressions || []).slice(),
      macros: APP.macros ? APP.macros.slice() : Array.from({ length: 32 }, () => []),
      quirks: APP.quirks ? APP.quirks.slice() : [],
      unmapped_passthrough_layers: boolLayersToIndices(s.passthrough || []),
      partial_scroll_timeout: (s.scrollTimeout == null ? 1000 : s.scrollTimeout) * 1000, // ms -> µs
      tap_hold_threshold: (s.tapHold == null ? 200 : s.tapHold) * 1000, // ms -> µs
      interval_override: toInt(s.interval),
      our_descriptor_number: toInt(s.emulatedDevice),
      gpio_debounce_time_ms: s.gpioDebounce == null ? 5 : toInt(s.gpioDebounce),
      macro_entry_duration: toInt(s.macroEntryDuration) || 10,
      ignore_auth_dev_inputs: !!s.ignoreAuthDevInputs,
      gpio_output_mode: s.gpioOutputMode ? 1 : 0,
      input_labels: toInt(s.inputLabels),
      normalize_gamepad_inputs: s.normalizeGamepad == null ? true : !!s.normalizeGamepad,
    };
    // additive, web-only: which rows are switched off (combos are now real mappings,
    // so there is no combos[] / combo_window field any more)
    if (!opts.forDevice) {
      config.disabled_rows = rows.map((m) => m.enabled === false);
    }
    return config;
```

Delete the now-unused `appComboToJson` and `jsonComboToApp` functions and drop them from the exported `API` object. Add the new names to `API`:

```js
    COMBO_USAGE_PAGE, NCOMBOS, DEFAULT_COMBO_WINDOW_MS,
    isComboUsage, comboId, comboUsage,
    appComboToConfigMappings,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd config-tool-web-v2 && node --test tests/
```

Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add config-tool-web-v2/tests/translate.test.js config-tool-web-v2/js/translate.js
git commit -m "feat(web-v2): compile combo rows into real device mappings (page 0xFFFB)"
```

---

### Task 2: Combo fold (`configToApp`) + round-trip

**Files:**
- Modify: `config-tool-web-v2/js/translate.js`
- Modify: `config-tool-web-v2/tests/translate.test.js`

**Interfaces:**
- Consumes: `isComboUsage`, `comboId`, `NCOMBOS` from Task 1.
- Produces: `configToApp(config, base, uid)` returns APP rows where a combo is **one** row with `inputs.length > 1`, plus `comboWindow` and `comboConsume`.

**Contract.** Walk `config.mappings` in order. A mapping whose **target** is on the combo page is a member — stash it under its id, emit nothing. A mapping whose **source** is on the combo page is a trigger — emit the folded row *at that position*. A trigger with no members, or a member whose trigger never arrives, degrades to a plain single-input row (never dropped, never crashes).

- [ ] **Step 1: Write the failing test**

Append to `config-tool-web-v2/tests/translate.test.js`:

```js
test("3 mappings fold back into 1 combo row", () => {
  const cfg = {
    version: 18,
    mappings: [
      { source_usage: "0x000c00e9", target_usage: "0xfffb0001", scaling: 50, layers: [0], combo_consume: true },
      { source_usage: "0x000c00ea", target_usage: "0xfffb0001", scaling: 50, layers: [0], combo_consume: true },
      { source_usage: "0xfffb0001", target_usage: "0x000c00e2", scaling: 1000, layers: [0], sticky: true },
    ],
  };
  const app = T.configToApp(cfg, {}, null);
  assert.strictEqual(app.mappings.length, 1);

  const row = app.mappings[0];
  assert.deepStrictEqual(row.inputs, ["0x000c00e9", "0x000c00ea"]);
  assert.strictEqual(row.output, "0x000c00e2");
  assert.strictEqual(row.comboWindow, 50);
  assert.strictEqual(row.comboConsume, true);
  assert.strictEqual(row.sticky, true);
  assert.strictEqual(row.scale, 1);
  assert.strictEqual(row.layers[0], true);
});

test("combo survives a full APP -> config -> APP round trip", () => {
  const app0 = appWith([
    { id: 1, inputs: ["0x00070052"], output: "0x00070052", enabled: true, layers: L0, scale: 1 },
    { id: 2, inputs: ["0x000c00e9", "0x000c00ea", "0x000c00cd"], output: "0x000c00e2", enabled: true,
      layers: L0, sticky: false, tap: true, hold: false, scale: 1,
      comboWindow: 120, comboConsume: false },
  ]);
  const back = T.configToApp(T.appToConfig(app0, { forDevice: true }), {}, null);

  assert.strictEqual(back.mappings.length, 2);
  const combo = back.mappings[1];
  assert.strictEqual(combo.inputs.length, 3);           // 3-key combo
  assert.deepStrictEqual(combo.inputs, ["0x000c00e9", "0x000c00ea", "0x000c00cd"]);
  assert.strictEqual(combo.comboWindow, 120);
  assert.strictEqual(combo.comboConsume, false);
  assert.strictEqual(combo.tap, true);
});

test("an orphan combo mapping degrades to a plain row instead of vanishing", () => {
  const cfg = {
    version: 18,
    mappings: [
      { source_usage: "0x000c00e9", target_usage: "0xfffb0003", scaling: 50, layers: [0] }, // no trigger
    ],
  };
  const app = T.configToApp(cfg, {}, null);
  assert.strictEqual(app.mappings.length, 1);
  assert.deepStrictEqual(app.mappings[0].inputs, ["0x000c00e9"]);
  assert.strictEqual(app.mappings[0].output, "0xfffb0003");
});

test("a config with no combos is unchanged by the fold", () => {
  const cfg = {
    version: 18,
    mappings: [{ source_usage: "0x00070052", target_usage: "0x00070051", scaling: 1000, layers: [0, 1] }],
  };
  const app = T.configToApp(cfg, {}, null);
  assert.strictEqual(app.mappings.length, 1);
  assert.deepStrictEqual(app.mappings[0].inputs, ["0x00070052"]);
  assert.strictEqual(app.mappings[0].layers[1], true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd config-tool-web-v2 && node --test tests/
```

Expected: FAIL — `configToApp` currently returns 3 separate rows, so `app.mappings.length` is `3`, not `1`.

- [ ] **Step 3: Implement the fold**

In `js/translate.js`, replace the first three lines of `configToApp` (the `const singles = ...` / `disabled_singles` / `combos` block, down to and including `const mappings = singles.concat(combos);`) with:

```js
    const raw = config.mappings || [];
    const membersById = {};   // combo id -> [config mapping, ...] in order
    raw.forEach((cm) => {
      if (isComboUsage(cm.target_usage)) {
        const id = comboId(cm.target_usage);
        (membersById[id] = membersById[id] || []).push(cm);
      }
    });

    const mappings = [];
    raw.forEach((cm) => {
      if (isComboUsage(cm.target_usage)) return;   // member — folded into its trigger below

      if (isComboUsage(cm.source_usage)) {
        const id = comboId(cm.source_usage);
        const members = membersById[id];
        if (members && members.length) {
          const row = configMappingToApp(cm, uid);   // trigger supplies output/scale/flags/layers
          row.inputs = members.map((mm) => normHex(mm.source_usage));
          row.comboWindow = members[0].scaling == null ? DEFAULT_COMBO_WINDOW_MS : members[0].scaling;
          row.comboConsume = members.some((mm) => !!mm.combo_consume);
          mappings.push(row);
          return;
        }
        // trigger with no members -> fall through, keep it as a plain row (visible, not lost)
      }
      mappings.push(configMappingToApp(cm, uid));
    });

    // members whose trigger never arrived: keep them as plain rows so nothing silently vanishes
    Object.keys(membersById).forEach((id) => {
      const hasTrigger = raw.some((cm) => isComboUsage(cm.source_usage) && comboId(cm.source_usage) === Number(id));
      if (!hasTrigger) membersById[id].forEach((cm) => mappings.push(configMappingToApp(cm, uid)));
    });

    // restore which rows were switched off (additive, web-only)
    if (Array.isArray(config.disabled_rows)) {
      config.disabled_rows.forEach((off, i) => { if (mappings[i] && off) mappings[i].enabled = false; });
    }
```

In the same function, delete the `comboWindow:` line from the `settings` object (the global setting is gone).

In `configMappingToApp`, add two defaults to the returned object so every row has the fields the UI reads:

```js
      comboWindow: DEFAULT_COMBO_WINDOW_MS,
      comboConsume: true,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd config-tool-web-v2 && node --test tests/
```

Expected: PASS — 8/8.

- [ ] **Step 5: Commit**

```bash
git add config-tool-web-v2/js/translate.js config-tool-web-v2/tests/translate.test.js
git commit -m "feat(web-v2): fold combo mappings back into one UI row on load"
```

---

### Task 3: Send and read `flags` bit 3 (`device.js`)

**Files:**
- Modify: `config-tool-web-v2/js/device.js`
- Modify: `config-tool-web-v2/tests/` — add `config-tool-web-v2/tests/device.test.js`

**Interfaces:**
- Consumes: `combo_consume` on each config mapping (Task 1).
- Produces: `HRX_DEVICE` sends bit 3 in `ADD_MAPPING` and reads it back in `GET_MAPPING` as `combo_consume`. `buildCommand` is already exported for tests.

- [ ] **Step 1: Write the failing test**

Create `config-tool-web-v2/tests/device.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const D = require("../js/device.js");

// ADD_MAPPING payload: [u8 version][u8 cmd][u32 target][u32 source][i32 scaling]
//                      [u8 layer_mask][u8 flags][u8 hub_ports][u32 crc]
test("combo_consume sets flags bit 3 without disturbing sticky/tap/hold", () => {
  const buf = D.buildCommand(5 /* ADD_MAPPING */, [
    ["u32", 0xfffb0001],
    ["u32", 0x000c00e9],
    ["i32", 50],
    ["u8", 0b00000001],           // layer 0
    ["u8", (1 << 3) | (1 << 0)],  // COMBO_CONSUME | STICKY
    ["u8", 0],
  ]);
  const dv = new DataView(buf);
  assert.strictEqual(dv.getUint8(0), 18);            // CONFIG_VERSION unchanged
  assert.strictEqual(dv.getUint8(1), 5);             // ADD_MAPPING
  assert.strictEqual(dv.getUint32(2, true), 0xfffb0001);
  assert.strictEqual(dv.getUint32(6, true), 0x000c00e9);
  assert.strictEqual(dv.getInt32(10, true), 50);     // window in ms
  const flags = dv.getUint8(15);
  assert.strictEqual(flags & (1 << 3), 1 << 3);      // consume
  assert.strictEqual(flags & (1 << 0), 1 << 0);      // sticky untouched
  assert.strictEqual(flags & (1 << 1), 0);           // tap clear
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd config-tool-web-v2 && node --test tests/device.test.js
```

Expected: PASS on the byte layout (`buildCommand` is generic) — **this test is a regression guard, not a red test.** If it fails, the frame layout drifted and you must stop and fix that first. The real red test is Step 3's; run it after the edit.

- [ ] **Step 3: Wire the flag in `js/device.js`**

Add the constant beside the others (line ~30):

```js
  const COMBO_CONSUME_FLAG = 1 << 3;
```

In `saveToDevice`, extend the `ADD_MAPPING` flags byte:

```js
          [U8, (m.sticky ? STICKY_FLAG : 0) | (m.tap ? TAP_FLAG : 0) | (m.hold ? HOLD_FLAG : 0) |
               (m.combo_consume ? COMBO_CONSUME_FLAG : 0)],
```

In `loadFromDevice`, read it back — add to the pushed mapping object:

```js
          combo_consume: !!(mapFlags & COMBO_CONSUME_FLAG),
```

Export `COMBO_CONSUME_FLAG` on the public API object alongside the other exported helpers.

- [ ] **Step 4: Run the whole suite**

```bash
cd config-tool-web-v2 && node --test tests/
```

Expected: PASS — 9/9.

- [ ] **Step 5: Commit**

```bash
git add config-tool-web-v2/js/device.js config-tool-web-v2/tests/device.test.js
git commit -m "feat(web-v2): send/read combo-consume flag (bit 3) over the wire"
```

---

### Task 4: Combo row UI — per-combo window + consume; delete inline/stacked dead code

**Files:**
- Modify: `config-tool-web-v2/js/state.js`
- Modify: `config-tool-web-v2/js/mappings.js:49-108` (the `inputCellHtml` inline/stacked branch), `:534`
- Modify: `config-tool-web-v2/js/tabs.js` (Settings "Combo window" field)
- Modify: `config-tool-web-v2/css/mappings.css:113,140-141,144-152,177-197`

**Interfaces:**
- Consumes: `comboWindow` / `comboConsume` on each APP row (Tasks 1–2).
- Produces: nothing downstream — this is the last web task.

- [ ] **Step 1: `state.js` — per-row combo fields, drop the global setting**

In `mk()`, add to the returned object after `tint: opts.tint || null,`:

```js
    comboWindow: opts.comboWindow == null ? 50 : opts.comboWindow,  // ms; 0 = no timing window
    comboConsume: opts.comboConsume !== false,                       // members suppressed while combo is held
```

Remove `comboWindow: 50,` from `APP.settings`. Remove `comboLayout: "wire",` from `APP` (it is now the only layout).

- [ ] **Step 2: `mappings.js` — delete the dead layouts, add the combo controls**

In `inputCellHtml`, delete `const layout = APP.comboLayout;`, delete the `if (layout === "wire") {` guard (keep its body, which becomes the only path), and **delete everything from `/* ---- INLINE / STACKED (alternates) ---- */` to the end of the function.** Delete the now-unused `chip()` and `addBtn()` `cls` parameter indirection: `addBtn` is only ever called as `addBtn("wire-add")`.

Fix the stale comment at line ~534: `// inline / stacked rows` becomes `// map rows`.

In `rowHtml`, after the `.scale-wrap` div, add a combo-only control cell:

```js
      ${isCombo ? `
      <div class="combo-opts">
        <label class="combo-win" title="All keys must go down within this many milliseconds. 0 = no timing window.">
          <span class="flag-key">Win</span>
          <input class="combo-win-input" type="number" min="0" max="5000" step="10"
                 value="${m.comboWindow == null ? 50 : m.comboWindow}" data-cwin="1" data-mid="${m.id}">
          <span class="unit">ms</span>
        </label>
        <span class="chk mode word ${m.comboConsume !== false ? "on" : ""}" data-cconsume="1" data-mid="${m.id}"
              title="Consume: while the combo is held, the member keys do not fire their own mappings">Consume</span>
      </div>` : ""}
```

Wire both controls where the other row handlers are registered (next to the `data-scale` handler):

```js
    $$('[data-cwin]', root).forEach((el) => el.addEventListener("change", () => {
      const m = findMap(el.dataset.mid);
      if (m) { m.comboWindow = Math.max(0, Math.min(5000, parseInt(el.value, 10) || 0)); }
    }));
    $$('[data-cconsume]', root).forEach((el) => el.addEventListener("click", () => {
      const m = findMap(el.dataset.mid);
      if (m) { m.comboConsume = m.comboConsume === false; refresh(); }
    }));
```

(`findMap` is the existing helper used by the other row handlers — reuse it; do not add a second lookup.)

- [ ] **Step 3: `css/mappings.css` — remove dead rules, style the new cell**

Delete these now-unreferenced rules: `.input-cell.stacked` (line 113), `.combo-add.inline-plus` (140–141), `.combo-join` (144–152), `.combo-group` / `.combo-group.stacked` / `.combo-group-label` / `.combo-keys` / `.combo-keys.stacked` (177–197).

Add (pure white text — CLAUDE.md rule #5):

```css
/* combo-only per-row controls: timing window + consume */
.combo-opts { display: flex; align-items: center; gap: 8px; }
.combo-win { display: inline-flex; align-items: center; gap: 4px; }
.combo-win-input {
  width: 54px; padding: 3px 5px;
  background: var(--bg-deep); border: 1px solid var(--border); border-radius: 6px;
  color: #fff; font-family: var(--font-mono); font-size: 11px;
}
.combo-win .unit { font-family: var(--font-mono); font-size: 9px; color: #fff; opacity: 0.75; }
```

- [ ] **Step 4: `tabs.js` — drop the global Combo window field**

Delete the Settings row that renders the "Combo window" input (it is the `numField(...)` / input bound to `settings.comboWindow`). The window is per-combo now. Leave tap-hold, scroll timeout and interval alone.

- [ ] **Step 5: Verify — syntax, tests, and a real browser**

```bash
cd config-tool-web-v2
node --check js/state.js && node --check js/mappings.js && node --check js/tabs.js && node --check js/translate.js
node --test tests/
grep -rn "comboLayout\|inline-plus\|combo-group\|combo-keys\|stacked" js/ css/    # expect NO hits
python -m http.server 8971 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8971` in Chrome. Expected: page boots with **no console errors**; the Vol+/Vol- combo row shows a `Win 50 ms` field and a lit `Consume` chip; single-input rows show neither. **Gotcha (known):** do not hammer Ctrl+Shift+R — repeated hard reloads make the browser tool's `document_idle` hang on the page's Google-Fonts/Bootstrap CDN fetch. Use a normal reload.

- [ ] **Step 6: Commit**

```bash
git add config-tool-web-v2/js/state.js config-tool-web-v2/js/mappings.js config-tool-web-v2/js/tabs.js config-tool-web-v2/css/mappings.css
git commit -m "feat(web-v2): per-combo window + consume controls; drop inline/stacked dead code"
```

---

### Task 5: Firmware — page, types, CMake option (no behavior yet)

**Files:**
- Modify: `firmware/src/remapper.h`
- Modify: `firmware/src/types.h`
- Modify: `firmware/CMakeLists.txt`

**Interfaces:**
- Produces: `COMBO_USAGE_PAGE`, `combo_member_t`, `combo_t`, and the `COMBO_ENABLED` compile definition. Task 6 consumes all of them.

This task changes no behavior. Its gate is that CI still builds every target.

- [ ] **Step 1: `src/remapper.h` — claim the page**

Add below `#define RGB_LED_USAGE_PAGE 0xFFFA0000`:

```c
#define COMBO_USAGE_PAGE 0xFFFB0000  // target = AND of its sources; see docs/superpowers/specs/2026-07-13-firmware-combos-design.md
```

- [ ] **Step 2: `src/types.h` — the combo structs**

Add after `struct map_source_t { ... };`:

```cpp
struct combo_member_t {
    int32_t* input_state;
    uint8_t layer_mask;
    bool consume;
    uint64_t rise_at;  // timestamp (µs) of this member's most recent 0 -> non-zero edge
};

struct combo_t {
    uint32_t window_us;  // all members must go down within this span; 0 = no timing check
    int32_t* out_state;
    bool latched;
    std::vector<combo_member_t> members;
};
```

- [ ] **Step 3: `firmware/CMakeLists.txt` — the opt-in switch, default ON**

Add immediately after the existing `add_compile_definitions(GPIO_VALID_PINS_BASE=...)` line (before the first `add_executable`), so it applies to every engine target:

```cmake
# --- Native combos (usage page 0xFFFB: a target on that page is the AND of its
# sources). ON by default for VX builds, so the shipped .uf2 filenames are
# unchanged and gain combo support. Pass -DCOMBO_ENABLED=OFF for a build with
# the combo engine compiled out (upstream-identical behavior). Adds no persisted
# config field -- CONFIG_VERSION stays 18. ---
option(COMBO_ENABLED "Native combo support (AND-gate usage page 0xFFFB)" ON)
if(COMBO_ENABLED)
    add_compile_definitions(COMBO_ENABLED)
endif()
```

- [ ] **Step 4: Verify via CI (cannot build locally)**

```bash
git add firmware/src/remapper.h firmware/src/types.h firmware/CMakeLists.txt
git commit -m "feat(fw): claim usage page 0xFFFB for combos + COMBO_ENABLED option (no behavior yet)"
git push
gh run list --limit 1
gh run watch <id> --exit-status
```

Expected: green, and the "Verify artifacts" step still lists all 8 `.uf2` files with unchanged names.

---

### Task 6: Firmware — the combo engine

**Files:**
- Modify: `firmware/src/remapper.cc`

**Interfaces:**
- Consumes: `COMBO_USAGE_PAGE`, `combo_t`, `combo_member_t`, `COMBO_ENABLED` (Task 5); existing `assign_state_slot()`, `get_state_ptr()`, `get_time()` (µs), `input_state[]`, `PREV_STATE_OFFSET`, `used_state_slots`, `layer_state_mask`.
- Produces: combos evaluated每 frame. No new public symbols outside `remapper.cc`.

- [ ] **Step 1: Constants and globals**

Beside `const uint8_t MAPPING_FLAG_HOLD = 1 << 2;` (line ~24):

```cpp
const uint8_t MAPPING_FLAG_COMBO_CONSUME = 1 << 3;
```

Beside the other file-scope globals (near `int32_t input_state[MAX_INPUT_STATES * 2];`, line ~85):

```cpp
#ifdef COMBO_ENABLED
#define NCOMBOS 16
std::vector<combo_t> combos;
uint8_t combo_consumed[MAX_INPUT_STATES];  // per-frame: this input is owned by an active combo
#endif
```

- [ ] **Step 2: Build the combos in `set_mapping_from_config()`**

Clear them where the other tables are cleared (beside `reverse_mapping.clear();`, line ~425):

```cpp
#ifdef COMBO_ENABLED
    combos.clear();
    combos.resize(NCOMBOS);
    memset(combo_consumed, 0, sizeof(combo_consumed));
#endif
```

Inside the `for (auto const& mapping : config_mappings)` loop, **before** the existing `if (assign_state_slot(mapping.source_usage, source_port, false)) {` block, add the member branch. A member must NOT also become an ordinary OR-source of the combo target, so it `continue`s:

```cpp
#ifdef COMBO_ENABLED
        if ((mapping.target_usage & 0xFFFF0000) == COMBO_USAGE_PAGE) {
            uint16_t id = mapping.target_usage & 0xFFFF;
            if ((id >= 1) && (id <= NCOMBOS)) {
                combo_t& combo = combos[id - 1];
                if (assign_state_slot(mapping.source_usage, source_port, false) &&
                    assign_state_slot(mapping.target_usage, 0, false)) {
                    combo.out_state = get_state_ptr(mapping.target_usage, 0);
                    // the window lives in the FIRST member's scaling, in ms; get_time() is µs
                    if (combo.members.empty()) {
                        combo.window_us = (mapping.scaling > 0) ? (uint32_t) mapping.scaling * 1000 : 0;
                    }
                    combo.members.push_back((combo_member_t){
                        .input_state = get_state_ptr(mapping.source_usage, source_port),
                        .layer_mask = layer_mask,
                        .consume = (mapping.flags & MAPPING_FLAG_COMBO_CONSUME) != 0,
                        .rise_at = 0,
                    });
                    mapped_on_layers[mapping.source_usage] |= layer_mask;
                }
            }
            continue;  // a combo member is not an OR-source of its target
        }
#endif
```

The trigger mapping (`source_usage` on the combo page) needs **no** special case: `assign_state_slot()` already gives the combo usage a state slot, so the existing code treats it as a normal binary source and sticky/tap/hold/scaling/layers work unchanged.

- [ ] **Step 3: Evaluate combos in `process_mapping()`**

Add the function above `void process_mapping(bool auto_repeat) {`:

```cpp
#ifdef COMBO_ENABLED
// Runs before the layer/macro/output loops. Writes each combo's 1/0 into its state slot
// and marks the input slots that an active combo has consumed for this frame.
static void evaluate_combos(uint64_t now) {
    memset(combo_consumed, 0, sizeof(combo_consumed));

    for (auto& combo : combos) {
        if (combo.members.empty() || (combo.out_state == NULL)) {
            continue;
        }

        bool all_down = true;
        uint64_t first_rise = UINT64_MAX;
        uint64_t last_rise = 0;

        for (auto& member : combo.members) {
            // record this member's most recent rising edge
            if ((*member.input_state != 0) && (*(member.input_state + PREV_STATE_OFFSET) == 0)) {
                member.rise_at = now;
            }
            if ((*member.input_state == 0) || !(layer_state_mask & member.layer_mask)) {
                all_down = false;
                continue;
            }
            if (member.rise_at < first_rise) {
                first_rise = member.rise_at;
            }
            if (member.rise_at > last_rise) {
                last_rise = member.rise_at;
            }
        }

        if (!all_down) {
            combo.latched = false;
            *combo.out_state = 0;
            continue;
        }

        // fire once the window is satisfied; then LATCH while everything stays held
        if (!combo.latched) {
            combo.latched = (combo.window_us == 0) || ((last_rise - first_rise) <= combo.window_us);
        }

        *combo.out_state = combo.latched ? 1 : 0;

        if (combo.latched) {
            for (auto const& member : combo.members) {
                if (member.consume) {
                    combo_consumed[member.input_state - input_state] = 1;
                }
            }
        }
    }
}

static inline bool is_consumed(const map_source_t& src) {
    return (src.input_state != NULL) && combo_consumed[src.input_state - input_state];
}
#endif
```

Call it at the top of `process_mapping()`, immediately after `uint64_t now = get_time(); frame_counter++;` and **before** the `tap_hold_usages` loop:

```cpp
#ifdef COMBO_ENABLED
    evaluate_combos(now);
#endif
```

- [ ] **Step 4: Honour consumption in the three source loops**

Add the same guard as the first statement of the per-source loop body in each of the three places:

```cpp
#ifdef COMBO_ENABLED
            if (is_consumed(map_source)) {
                continue;
            }
#endif
```

1. The layer loop — `for (auto const& map_source : rev_map.sources)` inside `for (auto const& rev_map : reverse_mapping_layers)`.
2. The macro loop — the same line inside `for (auto const& rev_map : reverse_mapping_macros)`.
3. The output loop — **both** branches inside `for (auto& rev_map : reverse_mapping)`: the `if (rev_map.is_relative)` source loop and the `else` (absolute) source loop.

A combo's own trigger is never consumed (its source is the combo usage, not a member key), so it fires normally.

- [ ] **Step 5: Verify via CI**

```bash
git add firmware/src/remapper.cc
git commit -m "feat(fw): evaluate combos (AND-gate page 0xFFFB) with per-combo window + consume"
git push
gh run list --limit 1
gh run watch <id> --exit-status
```

Expected: green; "Verify artifacts" lists the same 8 `.uf2` filenames. If the compiler warns about the designated-initializer order in `combo_member_t`, reorder the initializers to match the struct declaration order (`-Wall` is on, and C++17 requires declaration order).

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (custom usage pages line)
- Modify: `CODEMAP.md` (subsystem table)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: `CLAUDE.md` — the page is no longer free**

In the "Custom output usage pages" section, append `0xFFFB` and move the pointer:

```
`0xFFF9` DPAD · `0xFFFA` RGB_LED (low 16 bits = RGB565 color) · `0xFFFB` COMBO (target = AND of its sources; members' `scaling` = window in ms, `flags` bit 3 = consume). **Next free: `0xFFFC`** (`0xFFFF` is `OUR_OUT_INTERFACE`).
```

- [ ] **Step 2: `CODEMAP.md` — the subsystem rows**

Add to the subsystem table:

```
| Combo engine | `src/remapper.cc` | `evaluate_combos()`, `combos[]`, `combo_consumed[]`, `MAPPING_FLAG_COMBO_CONSUME`, `#ifdef COMBO_ENABLED` |
| Combo page   | `src/remapper.h`  | `COMBO_USAGE_PAGE 0xFFFB0000` |
| Combo (web)  | `config-tool-web-v2/js/translate.js` | `appComboToConfigMappings()`, `isComboUsage()` |
```

- [ ] **Step 3: `CHANGELOG.md`**

```markdown
### Added
- **Native combos.** N inputs pressed together fire one output. A combo is an AND-gate on usage
  page `0xFFFB`: members map `key -> 0xfffb00NN`, a trigger maps `0xfffb00NN -> output`. Per-combo
  timing window (ms, `0` = none) and per-member "consume" (the member keys do not fire their own
  mappings while the combo is held). Built by default (`-DCOMBO_ENABLED=OFF` compiles it out);
  **`CONFIG_VERSION` stays 18** and no `.uf2` filename changed.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CODEMAP.md CHANGELOG.md
git commit -m "docs: combos — usage page 0xFFFB, engine + web entry points"
```

---

### Task 8: Release, flash, and prove it on hardware

**Files:** none (verification only).

**This is the only task that needs the owner and a physical device. Do not start it without them.**

- [ ] **Step 1: Tag a release so the `.uf2` is downloadable**

```bash
git tag r2026-07-13
git push origin r2026-07-13
gh run watch <id> --exit-status
gh release edit r2026-07-13 --draft=false --latest
```

- [ ] **Step 2: Flash `JJ8S` — never `CUSS`**

Confirm the device name in the web tool's device bar reads **JJ8S** before flashing. `CUSS` is the owner's live device and must not be touched.

- [ ] **Step 3: Serve the web tool and round-trip a combo**

```bash
cd config-tool-web-v2 && python -m http.server 8971 --bind 127.0.0.1
```

Open `http://127.0.0.1:8971` in Chrome → **Open device** → confirm **JJ8S** → **Load**.

- [ ] **Step 4: Walk the acceptance checks**

| # | Check | Expected |
| --- | --- | --- |
| a | Add `Vol+ & Vol- → Mute`, window 50 ms, Consume ON. Save. Reload. | The row comes back as **one** combo row with both inputs, window 50, Consume lit. |
| b | Press Vol+ alone, then Vol- alone. | Each fires its own mapping. Mute does not fire. |
| c | Press both together. | **Mute only.** Vol+/Vol- do not fire (consume). |
| d | Turn Consume OFF, save, press both. | Vol+, Vol- **and** Mute all fire. |
| e | Hold Vol+ for ~2 s, then press Vol-. | Combo does **not** fire (outside the 50 ms window). Set window to 0, save → it now fires. |
| f | Map a combo to a layer target and hold it. | The layer activates. |
| g | Load a pre-existing non-combo config. | Behaves exactly as before. |

- [ ] **Step 5: Deploy the web tool to GitHub Pages**

Only after (a)–(g) pass. Fast-forward-merge the additive `config-tool-web-v2/` work to `master`; Pages rebuilds in 1–2 minutes. `config-tool-web/` is never touched.

- [ ] **Step 6: Record the outcome**

Update `.remember/now.md` and the `project_hid_vx_web_redesign` memory with the hardware result — including anything that failed.
