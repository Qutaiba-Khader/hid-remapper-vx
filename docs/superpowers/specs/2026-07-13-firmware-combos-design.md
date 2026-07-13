# Native Combo Support — Design Spec

**Date:** 2026-07-13
**Status:** Approved (owner, 2026-07-13)
**Scope:** `firmware/` mapping engine + `config-tool-web-v2/` translation layer.

## Goal

Press N inputs together → fire one output. Today the web tool can *author* combos but parks them
in an additive `combos[]` JSON field that is never sent to the device, so they do nothing. This
makes combos real: persisted on the device, evaluated by the firmware.

## Non-goals

- Combos on `remapper_dual_b` (it is a capture node, runs no mapping engine — same as GPIO/LED today).
- Any change to `CONFIG_VERSION` (stays **18**), `mapping_config11_t`, or `persist_config_t`.
- A global combo-window setting (superseded: the window is now per-combo).

## The core idea: a combo is an AND-gate usage page

Every other target in the engine **sums** its sources — that is an OR. A combo is the same
structure with one operator changed:

> **Usage page `0xFFFB` = COMBO. A target on the combo page is the logical AND of its sources.**

This mirrors how the firmware already models GPIO (`0xFFF4`), MACRO (`0xFFF2`), EXPR (`0xFFF3`),
and RGB_LED (`0xFFFA`): a usage page with special meaning, dispatched in the
`else if ((target & 0xFFFF0000) == X_USAGE_PAGE)` chain in `set_mapping_from_config()`.
`0xFFFB` is recorded in CLAUDE.md as the next free page.

A combo is therefore **three ordinary mappings**, with no new struct and no format change.
`Vol+ & Vol- → Mute`, 50 ms window, consuming its members:

| # | source_usage | target_usage | scaling | flags |
| --- | --- | --- | --- | --- |
| 1 | `0x000c00e9` (Vol+) | `0xfffb0001` (combo 1) | `50` — window in ms | bit 3 = CONSUME |
| 2 | `0x000c00ea` (Vol-) | `0xfffb0001` (combo 1) | `50` — window in ms | bit 3 = CONSUME |
| 3 | `0xfffb0001` (combo 1) | `0x000c00e2` (Mute) | `1000` — ×1.0 | sticky/tap/hold as usual |

### Why this keeps CONFIG_VERSION at 18

Both new pieces of data ride in fields that are *already there but unused* on these mappings:

- **Window** → `scaling`. A mapping whose target is on the combo page has no use for a scaling
  factor, so on those entries `scaling` means **combo window in milliseconds**; `0` = no timing
  constraint (pure AND). Precedent: the RGB LED packs an RGB565 color into a usage.
- **Consume** → `flags` **bit 3** (`MAPPING_FLAG_COMBO_CONSUME`). `MAPPING_FLAG_STICKY/TAP/HOLD`
  are bits 0–2; bits 3–7 are free. Only meaningful on a mapping targeting the combo page.
  Bits 4–7 remain free.

`mapping_config11_t` stays 14 bytes with the same fields. Nothing is added to `persist_config_t`.

### What this buys

- Window is tunable **per combo**, not one global number.
- Consume is settable **per combo, and per member**.
- No ordering dependency between mapping entries; no cap on combo size.
- Sticky / tap / hold / scaling / layers / expressions apply to a combo **for free**, because the
  combo is a real input-state slot flowing through the existing machinery. `0xfffb0001 input_state`
  works in an expression with no extra code.

## Semantics

**Definitions.** *Members* = mappings whose target is `COMBO_USAGE_PAGE | id`. *Trigger* = a
mapping whose source is `COMBO_USAGE_PAGE | id`.

1. **Activation.** A combo is active when every member's input is non-zero **and** every member's
   `layer_mask` intersects the current `layer_state_mask`.
2. **Window.** Let `rise[i]` = the timestamp of each member's most recent 0→non-zero edge. The
   combo fires only if `max(rise) - min(rise) <= window_ms`. `window_ms == 0` disables the check.
   The window is read from the **first member's** `scaling` (the web tool writes the same value to
   every member; the firmware takes the first and ignores the rest).
3. **Latching.** Once a combo fires it **stays** active while all members remain held, even past
   the window. It deactivates when any member goes to zero.
4. **Output.** The combo's state slot holds `1` while active, `0` otherwise. The trigger mapping
   consumes it as a normal binary source, so its own scaling/sticky/tap/hold/layers behave exactly
   as they do for a physical key.
5. **Consume.** While a combo is active, each member carrying bit 3 has its input-state slot marked
   consumed **for that frame**. Consumed slots are skipped by the output, layer, and macro loops —
   so `Vol+ → Vol+` does not fire while the combo owns the key. A member without bit 3 keeps firing
   its own mappings (additive behavior).
6. **A key may belong to several combos.** Consumption is a per-frame mark, not ownership.

## Firmware changes (`COMBO_ENABLED`, default ON)

Build gating per CLAUDE.md rule #1: `option(COMBO_ENABLED "..." ON)` in `firmware/CMakeLists.txt`.
Default **ON** so the shipped VX `.uf2` set keeps its 8 filenames (rule #4) and gains combos;
`-DCOMBO_ENABLED=OFF` yields an upstream-identical build. All new code sits behind `#ifdef COMBO_ENABLED`.

| File | Change |
| --- | --- |
| `src/remapper.h` | `#define COMBO_USAGE_PAGE 0xFFFB0000`; declare the combo pass. |
| `src/types.h` | `struct combo_member_t { int32_t* input_state; uint8_t layer_mask; bool consume; uint64_t rise_at; }` and `struct combo_t { std::vector<combo_member_t> members; uint32_t window_ms; int32_t* out_state; bool latched; }`. |
| `src/remapper.cc` | `MAPPING_FLAG_COMBO_CONSUME = 1 << 3`. Build `combos[]` in `set_mapping_from_config()` from mappings targeting the combo page (mirroring the macro/layer branch). In `process_mapping()`, add `evaluate_combos()` **before** the layer, macro, and output loops: it writes each combo's 1/0 into its state slot and fills a per-frame `consumed[]` byte array indexed by state slot. The three existing loops skip a `map_source` whose slot is consumed. |
| `firmware/CMakeLists.txt` | The `COMBO_ENABLED` option → `target_compile_definitions`. |
| `CLAUDE.md`, `CODEMAP.md` | Record `0xFFFB` as taken (next free becomes `0xFFFC`), add the combo subsystem row. |

`NCOMBOS = 16` (ids 1–16); out-of-range ids are ignored. State slots are allocated dynamically by
the existing `assign_state_slot()`, so this is a sanity cap, not a structural limit.

**Ordering constraint:** the combo pass must run after `input_state` is refreshed and before the
layer pass, so that a combo can drive a layer and so consumption suppresses layer/macro triggers.

## Web tool changes (`config-tool-web-v2`)

| File | Change |
| --- | --- |
| `js/translate.js` | `appToConfig()`: compile each combo row (`inputs.length > 1`) into 1 trigger + N member mappings, assigning combo ids 1..N in row order. `configToApp()`: detect combo-page mappings and re-fold them into a single UI row. **Delete the additive `combos[]` / `combo_window` fields** — combos are now real mappings. |
| `js/state.js` | Per-mapping `comboWindow` (ms, default 50) and `comboConsume` (bool, default true). Remove the global `settings.comboWindow`. |
| `js/mappings.js` | Wire-layout combo row exposes the per-combo window + consume toggle. Remove the dead inline/stacked branch (Phase 4). |
| `js/tabs.js` | Drop the global "Combo window" field from Settings. |

**Firmware capability gating is dropped.** The protocol has no capability query (`GET_CONFIG`
returns only the version, which is 18 either way), so there is nothing to detect. Instead, combos
degrade safely: on firmware built without `COMBO_ENABLED`, mappings to/from `0xFFFB` reference a
page the engine does not know, so they contribute nothing and are simply **inert**. The member keys
keep their own mappings. No corruption, no crash. The UI states the firmware requirement.

## Compatibility

- **Stock jfedor2 web tool:** an exported config loads fine — it sees three ordinary mappings with
  an unfamiliar usage page. **Caveat:** if the user re-saves from that tool it recomputes `flags`
  from its own sticky/tap/hold checkboxes and **erases bit 3**, silently downgrading a consuming
  combo to an additive one. Documented, not defended against.
- **Old VX firmware (v18, no combo support):** combos are inert (above).
- **Existing configs:** unaffected — no current config uses page `0xFFFB` or flag bit 3.

## Testing

- **Node unit tests** (`config-tool-web-v2`, extends the existing 56): combo → 3 mappings compile;
  3 mappings → 1 UI row fold; round-trip stability; ids assigned in order; window/consume survive;
  a non-combo config is untouched.
- **Firmware:** cannot be built on this machine (CLAUDE.md rule #3) — verify via GitHub Actions and
  read the "Verify artifacts" step.
- **Hardware, on `JJ8S` only** (never `CUSS`): flash, then confirm — (a) `Vol+ & Vol- → Mute` fires
  only when both are held; (b) with consume ON the individual Vol+/Vol- do not fire; with it OFF
  they do; (c) a slow rolling press outside the window does **not** fire; (d) a combo drives a layer;
  (e) an existing non-combo config still behaves identically.

## Risks

| Risk | Mitigation |
| --- | --- |
| Stock build is no longer byte-identical to upstream (rule #1) | Owner-approved: `COMBO_ENABLED` exists and can be turned OFF for an identical build. |
| Consuming a key that also triggers a layer could strand a layer on | The combo pass runs before the layer pass and consumption is re-evaluated every frame, so releasing the combo restores the key next frame. Covered by hardware test (d). |
| Frame-cost of the combo pass in the 1 kHz loop | O(total combo members); ≤16 combos. Negligible, but confirm with `print_stats()` if the loop time moves. |
