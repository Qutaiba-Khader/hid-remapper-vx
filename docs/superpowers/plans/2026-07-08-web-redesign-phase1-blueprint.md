# Phase 1 Blueprint — port the working tool's logic into the new UI

**Deliverable of Phase 1** (recon done 2026-07-08). Drives Phases 2–5.
Two codebases: **new UI** = `config-tool-web-v2/` (Claude Design mock, no WebHID); **working tool** = `config-tool-web/` (`code.js` = real WebHID + device protocol, `CONFIG_VERSION 18`).

## A. THE CRUX — two different data models
The new UI and the device speak different mapping shapes. This translation is the heart of the port.

**Working `config` (device truth, `code.js`):**
- `config = { version:18, mappings[], macros[32], expressions[8], quirks[], + settings }`
- **mapping** = `{ source_usage, target_usage, layers:[indices 0-7], sticky, tap, hold, scaling(int ×1000), source_port(0-15), target_port(0-15), color? }`
- **8 layers**, exactly **one source per mapping** (firmware has **NO native combos**).

**New UI `APP` (`state.js`):**
- `APP = { connection, device{name,vidpid,firmware,profile}, activeTab, config{title}, comboLayout, groupByInput, groupDisabled, expressions[8], settings{emulatedDevice, tapHold, comboWindow, scrollTimeout, interval, passthrough[4]}, mappings[] }`
- **mapping** = `{ id, inputs:[hex,…], output:hex, enabled, layers:[bool×4], sticky, tap, hold, scale(float), tint }`
- usage codes are **lowercase hex strings** (`"0x000c0041"`).

**Field-mapping table (mock ↔ real):**
| mock field | real field | conversion |
|---|---|---|
| `inputs[0]` | `source_usage` | direct (single-input mapping) |
| `inputs[1..]` (combo) | — | **NOT a device mapping** → goes to additive `combos[]` (see §E) |
| `output` | `target_usage` | direct |
| `enabled` | — (web-only) | if `false`, **skip on save-to-device** |
| `layers:[b0..b3]` | `layers:[indices]` | bool-array → index-array; **extend mock to 8 layers** |
| `sticky/tap/hold` | same | direct |
| `scale` (float) | `scaling` (int) | `scaling = round(scale*1000)`; back: `scale = scaling/1000` |
| `tint` | `color` (`#rrggbb`) | UI-only both sides — map tint→hex |
| — | `source_port` / `target_port` | default 0 (mock has no port UI yet) |

## B. Device layer to PORT from `code.js` (new module `js/device.js`)
Self-contained; copy/adapt these — they don't depend on the old UI:
- **`crc.js`** — copy as-is (IEEE CRC-32; `crc32(buf,len)`).
- **Protocol:** 32-byte feature reports. `REPORT_ID_CONFIG=100`, `REPORT_ID_MONITOR=101`. Frame = `[UINT8 version=18, UINT8 command, …LE fields…, UINT32 crc32(bytes0..27)]`. Helpers: `send_feature_command()`, `read_config_feature()` (retry ×10, backoff).
- **Connect:** `navigator.hid.requestDevice({ filters:[{ usagePage:0xFF00, usage:0x0020 }] })` → pick the device whose collection has usagePage `0xff00`. Register `inputreport` listener. Probe versions `[18..2]` (`check_device_version`) for firmware/tool mismatch.
- **25 command constants** (values verbatim from `code.js:40-64`): SET_CONFIG=2, GET_CONFIG=3, CLEAR_MAPPING=4, ADD_MAPPING=5, GET_MAPPING=6, PERSIST_CONFIG=7, GET_OUR_USAGES=8, GET_THEIR_USAGES=9, SUSPEND=10, RESUME=11, PAIR_NEW_DEVICE=12, CLEAR_BONDS=13, FLASH_B_SIDE=14, CLEAR_MACROS=15, APPEND_TO_MACRO=16, GET_MACRO=17, CLEAR_EXPRESSIONS=19, APPEND_TO_EXPRESSION=20, GET_EXPRESSION=21, SET_MONITOR_ENABLED=22, CLEAR_QUIRKS=23, ADD_QUIRK=24, GET_QUIRK=25, RESET_INTO_BOOTSEL=1.
- **`load_from_device` / `save_to_device`** — reuse the exact flows + byte layouts:
  - GET_CONFIG header, then GET_MAPPING loop (`[u32 target, u32 source, i32 scaling, u8 layer_mask, u8 flags(sticky1|tap2|hold4), u8 hub_ports(src=low nibble,tgt=high)]`), GET_MACRO/GET_EXPRESSION/GET_QUIRK loops.
  - save: SUSPEND → SET_CONFIG → CLEAR_MAPPING + ADD_MAPPING×N → CLEAR_MACROS + APPEND_TO_MACRO → CLEAR_EXPRESSIONS + APPEND_TO_EXPRESSION → CLEAR_QUIRKS + ADD_QUIRK → PERSIST_CONFIG → RESUME.
- **Monitor:** SET_MONITOR_ENABLED, then unsolicited input reports on `REPORT_ID_MONITOR (101)`: 7 slots × 9 bytes = `[u32 usage, i32 value, u8 hub_port]`.

## C. Usages (replace the mock `usages.js` with the real tables)
- The mock `usages.js` is a small curated catalog in `USAGE_CATEGORIES` `[code,name]` form; the picker (`picker.js`) is **fully data-driven** off it, so it needs **no changes** — just feed it real data.
- Build an **adapter**: transform the real `usages.js` (keyed `source_0/1/extra/source` + numeric `0-8` per emulated-profile target sets, each entry `{name,class}`, grouped by `class`) into the mock's `USAGE_CATEGORIES` shape. Bring across the class→section grouping (`usage_classes`, `code.js:1499`).
- **RGB LED codes come in for free** — the real `usages.js` already has the 16 named presets with **real RGB565 codes** (`0xfffaf800`=Red … `0xfffaffff`=White). Per owner decision: keep the preset-collection swatch UI as-is; these real codes just replace the mock sequential ones.
- **Target usages depend on `our_descriptor_number`** (emulated device profile 0-8) — the output picker should show the profile-specific target set. (Source usages also depend on `input_labels` 0/1.)

## D. Wiring (which new modules to add / replace / hook)
- **Add** `js/device.js` (the §B layer) + `js/crc.js`.
- **Add** `js/translate.js` — mock `APP` ⇄ real `config` (the §A table), reusing `settings-json.js`'s existing v18 modelling as a starting point (it already does target_usage/source_usage/scaling/layers/sticky/tap/hold/ports — but **fix its lossy combo path** which only serializes `inputs[0]`, and it ignores macros).
- **Replace** `js/usages.js` with the real-usages adapter (§C).
- **Hook** `app.js handleConn()` (currently fake toasts): connect→`device.connect`, disconnect→`device.disconnect`, save→`translate(APP)→config`+`save_to_device`, load→`load_from_device`+`config→translate→APP`+`render()`. Also revert `boot()` (it force-sets `connection="connected"` → start **disconnected**). Populate `APP.device{firmware,profile,vidpid}` from the real device.
- **Monitor tab** (`tabs.js`): replace `MON_SEED`/`tickMon` fake data with the real `inputreport` stream.
- **Macros tab**: the mock has **no `APP.macros` state at all** (UI shell only) — add the 32-slot state model + wire load/save.
- **Actions tab**: real firmware download URLs, `RESET_INTO_BOOTSEL` flash, `FLASH_B_SIDE`, export/import JSON (`download_json`/`upload_json`), pairing (`PAIR_NEW_DEVICE`/`CLEAR_BONDS`).
- **Settings tab**: wire the real fields — `interval_override` (as the preset dropdown), `tap_hold_threshold`, `partial_scroll_timeout`, `gpio_debounce`, `our_descriptor_number`, `unmapped_passthrough`, etc.

## E. Combos (Wire-only, additive) — the compatibility path
- **Single-input** mapping → normal device mapping (`ADD_MAPPING`).
- **Combo** (`inputs.length > 1`) → stored **only** in an additive **`combos[]`** JSON field; **not sent to the device** (firmware has no combo support yet) and **feature-gated** in the UI (hide/disable when the connected firmware lacks combo support). `CONFIG_VERSION` stays 18 (upstream ignores the extra field).
- Fix the lossy serialize in `settings-json.js` (`mappingToEntry` only keeps `inputs[0]`).

## F. Expressions
- The mock has its **own** `expr-engine.js`. The device wire-format is `code.js`'s postfix text ↔ bytecode (`expr_to_elems`, the 54-op table `code.js:69-125`). **Keep the mock's editor UI**, but device IO must go through the real text↔bytecode path, and the mock engine's ops must be a subset of/consistent with the real 54 ops. (Brief: do not redesign expression logic.)

## Open decisions (resolve at start of Phase 2/3)
1. **4 → 8 layers** in the mock UI (firmware has 8). Extend the layer checkboxes.
2. **Profile-aware target usages** — switch the output picker set by `our_descriptor_number`.
3. **Combo storage schema** (`combos[]` field shape) + **how to feature-detect** firmware combo support (version? a capability flag? — TBD; for now JSON-only, never sent to device).
4. **Translate layer home** — build fresh `js/translate.js`, or extend `settings-json.js`'s existing v18 model (leaning: extend/reuse it).

## Phase 2 kickoff
Build `js/device.js` (+ `crc.js`) and `js/translate.js`; revert `boot()`; wire connect/load/save. **Gate:** a real Pico round-trips **load → edit → save → reload** correctly. Then Phase 3 (tabs), Phase 4 (combos wire→`combos[]`), Phase 5 (gaps).
