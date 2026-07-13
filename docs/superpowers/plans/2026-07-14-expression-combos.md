# Expression Combos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the web tool a combo feature — *N keys pressed together within a timing window fire
one output* — **without changing a single line of firmware.** It compiles down to the stock
expression engine, so it works on `r2026-07-06`, on every older VX release, and on **upstream
jfedor2 firmware**.

**Architecture:** A combo row in the UI is *compiled* into **one expression + one mapping**. The
expression uses registers to remember when each key last went down, and fires only when every key
is down *and* their press times are within the window. Nothing new is persisted: expressions and
mappings are existing `CONFIG_VERSION 18` fields.

**Tech Stack:** `config-tool-web-v2/` (vanilla JS, no build step), Node `node:test`.

---

## Why this exists

Native combos (usage page `0xFFFB`) were built, hit three real hardware bugs, and were removed on
2026-07-13. This approach has a different risk profile: **the firmware is not touched**, so it
cannot brick a mouse, cannot leak a click through a firmware bug, and cannot be wrong on a board we
cannot test. The worst failure mode is "the expression doesn't fire", which is visible and harmless.

---

## Global Constraints

- **NO firmware changes.** Not one line. If a task seems to need one, the task is wrong — stop.
- **`CONFIG_VERSION` stays 18.** Combos persist as ordinary expressions + mappings.
- **Never touch `config-tool-web/`** (the live v1 tool).
- The tool must be honest about budget: **8 expressions and 32 registers, total, for the whole
  device.** A combo costs **1 expression + 2 registers per key**. Say so in the UI *before* saving.
- Expression constants in the editor are **×1000 fixed point** on the wire (`translate.js`
  `exprToDevice`). Write `50` in the editor, the device sees `50000`.
- Deploy rule: bump `?v=<date>` on every asset in `index.html`, verify with `curl` against the
  **served** files — never by looking at the browser.

---

## The compilation (verified against `firmware/src/remapper.cc`, 2026-07-14)

These facts were read out of the source, not remembered:

| Op | Enum | Semantics in `eval_expr()` |
| --- | --- | --- |
| `input_state_binary` | 10 | `!!(*state) * 1000` → `0` or `1000` |
| `prev_input_state_binary` | 28 | same, on the previous frame |
| `not` | 9 | `(!x) * 1000` |
| `mul` | 4 | `a * b / 1000` — fixed-point multiply, so it is a logical **AND** on 0/1000 values |
| `time` | 6 | `(frame_counter * 1000) & 0x7fffffff`. **`process_mapping()` runs on the 1 ms USB tick (`main.cc`: `if (tick)`), so `frame_counter` is milliseconds.** |
| `store` | 29 | `registers[stack[ptr]/1000 - 1] = stack[ptr-1]`; **pops both** (`ptr -= 2`) |
| `recall` | 30 | `stack[ptr] = registers[stack[ptr]/1000 - 1]` |
| `ifte` | 41 | `cond then else ifte` |
| `sub`, `abs`, `lt` | 46, 11, 49 | `lt` yields `1000` when true |

An expression returns `stack[ptr]` — **the top of the stack — so it must end with exactly one
value.** `store` leaves nothing, which is why the stores come first and the result is computed last.

**A two-key combo, window 50 ms, registers 1 and 2 — ONE expression:**

```
/* remember when key A last went down */
0x00090001 input_state_binary 0x00090001 prev_input_state_binary not mul
time 1 recall ifte 1 store

/* remember when key B last went down */
0x00090002 input_state_binary 0x00090002 prev_input_state_binary not mul
time 2 recall ifte 2 store

/* fire when BOTH are down AND their press times are within the window */
0x00090001 input_state_binary 0x00090002 input_state_binary mul
1 recall 2 recall sub abs 50 lt mul
```

Then one mapping: **Expression 1 (`0xFFF30001`) → output**. The output loop divides the EXPR page
by 1000, so a result of `1000` becomes a press of `1`.

**Cost:** 1 expression + 2 registers per key. So **up to 8 combos** (expressions are the limit;
32 registers cover 16 keys' worth).

### What this gives you, and what it does not

| | Expression combo | (removed) native combo |
| --- | --- | --- |
| AND of N keys | ✅ | ✅ |
| Real timing window | ✅ (`time` is ms) | ✅ |
| How many | 8 (uses your expression budget) | 16 |
| **Consume** (member keys suppressed) | ⚠️ see Task 5 — costs an extra expression per key **and still leaks a brief click** | ✅ (but this is exactly what took 3 firmware bugs to get right) |
| Firmware risk | **none** | it bricked a mouse |

**Consume is the honest weak point.** The firmware cannot defer a key press from an expression —
deferral is what native combos needed and it is gone. Default the UI to **additive** (no consume),
which is what the owner ended up using anyway.

---

## File Structure

- **Create** `config-tool-web-v2/js/combo-compile.js` — pure functions, no DOM. Compiles a combo row
  to `{ expression: string, mapping: {...}, registers: [n,n] }`, and decompiles it back. Testable in
  Node.
- **Modify** `config-tool-web-v2/js/state.js` — a combo row: `{ keys: [hex,...], output, windowMs }`.
- **Modify** `config-tool-web-v2/js/translate.js` — `appToConfig` allocates expression slots and
  registers, and emits the compiled expression + mapping. `configToApp` recognises a compiled
  expression and folds it back into a combo row (round-trip).
- **Modify** `config-tool-web-v2/js/tabs.js` — a **Combos** section showing the live budget
  ("3 of 8 expressions used").
- **Create** `config-tool-web-v2/tests/combo-compile.test.js`.

---

### Task 1: The compiler (pure, testable)

**Files:** Create `js/combo-compile.js`, `tests/combo-compile.test.js`

**Interfaces:**
- Produces: `compileCombo({keys, output, windowMs}, {exprIndex, regBase}) -> {expr, mapping}`
  and `decompileCombo(exprText) -> {keys, windowMs} | null`

- [ ] **Step 1: Write the failing test**

```js
const { compileCombo } = require("../js/combo-compile.js");
test("a 2-key combo compiles to one expression that ANDs the keys inside the window", () => {
  const { expr, mapping } = compileCombo(
    { keys: ["0x00090001", "0x00090002"], output: "0x0007001b", windowMs: 50 },
    { exprIndex: 0, regBase: 1 });
  assert.match(expr, /0x00090001 input_state_binary 0x00090001 prev_input_state_binary not mul/);
  assert.match(expr, /time 1 recall ifte 1 store/);
  assert.match(expr, /1 recall 2 recall sub abs 50 lt mul/);
  assert.strictEqual(mapping.source_usage, "0xfff30001");  // Expression 1
  assert.strictEqual(mapping.target_usage, "0x0007001b");
});
```

- [ ] **Step 2: Run it, watch it fail** — `node --test tests/combo-compile.test.js` → "Cannot find module".
- [ ] **Step 3: Implement `compileCombo`** — emit the three blocks above; `windowMs: 0` omits the
      `... lt mul` clause entirely (a pure AND with no timing check).
- [ ] **Step 4: Run it, watch it pass.**
- [ ] **Step 5: Commit.**

### Task 2: N keys, not just 2

- [ ] Test a 3-key combo: three store blocks; the window clause must compare **max − min** of the
      three rise times. Implement with nested `max`/`min` (ops 39/40 exist).
- [ ] Test that the stack ends with exactly ONE value (count pushes vs pops) — an expression that
      leaves 0 or 2 values is a silent misfire, and the device will not tell you.
- [ ] Commit.

### Task 3: Budget allocation + round-trip

- [ ] `appToConfig` assigns expression slots and register pairs; **if it runs out (8 expressions or
      32 registers), it must return a COUNT of what it dropped** — never silently drop a combo.
      (This exact bug bit us before.)
- [ ] `configToApp` decompiles a recognised combo expression back into a combo row, so a device
      round-trip does not shred the user's combos into raw expression text.
- [ ] Test: `APP -> config -> APP` is identity for 1, 2 and 8 combos; the 9th is reported, not lost.
- [ ] Commit.

### Task 4: UI

- [ ] A **Combos** panel: pick 2–4 keys, an output, a window. Show **"uses expression 3 of 8"** live.
- [ ] Refuse to add a combo when the expression budget is exhausted, and say why.
- [ ] Reuse the existing picker, and exclude constant/stuck usages (`window.HRX_MON_STUCK`) —
      the `0xffa00008` lesson.
- [ ] Commit.

### Task 5: Consume — OPTIONAL, and only if Task 4 is solid

- [ ] Spike first. `keyA AND NOT combo` needs one extra expression per key, and the key must be
      explicitly mapped (which kills its unmapped passthrough).
- [ ] **It still leaks a brief click** — the first key is already on its way to the host before the
      second one arrives. That is unavoidable without firmware deferral. If the spike confirms the
      leak, **write it up and do not ship the feature** — a "consume" that fires stray clicks is
      worse than no consume.

### Task 6: Hardware verification (JJ8S ONLY — never CUSS)

- [ ] Flash stock `r2026-07-06`. Build `Left + Right → X`, window 50.
- [ ] Both together → X fires.
- [ ] Each key alone → normal click, **instantly** (no deferral exists, so no latency — this is
      strictly better than the native version).
- [ ] Hold Left 2 s, then Right → must **not** fire. Window 0 → it does.
- [ ] Watch the Monitor: the expression's state is visible on page `0xFFF3`.

---

## Risks

1. **`time` is `frame_counter`, not a clock.** It is milliseconds *because* `process_mapping()` runs
   on the 1 ms USB tick. If a future firmware changes that, every window silently changes scale.
   Pin it: `tests/contract.test.js` should assert `main.cc` still calls `process_mapping()` inside
   `if (tick)`.
2. **`time` wraps** (`& 0x7fffffff` on a ×1000 value → ~35 minutes). A combo straddling the wrap
   could see a negative delta. `abs` covers it, but add a test.
3. **Expression budget is small (8).** Combos compete with everything else expressions are good for.
   The UI must show the budget, not hide it.
