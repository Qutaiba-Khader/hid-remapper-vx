# Web Config Tool Redesign — Integration Work Plan

## ✅ STATUS: COMPLETE (2026-07-13) — `master` = `2af9565`, 104 tests, LIVE
All 6 phases done. The redesigned tool is live at
**https://qutaiba-khader.github.io/hid-remapper-vx/config-tool-web-v2/** and the original tool at
`/config-tool-web/` is untouched and still working.

| Phase | | Notes |
| --- | --- | --- |
| 0 Scaffold | ✅ | `config-tool-web-v2/`, branch merged to `master` |
| 1 Recon & mapping | ✅ | `2026-07-08-web-redesign-phase1-blueprint.md` |
| 2 Device layer | ✅ | `js/device.js` (WebHID + 32-byte protocol), `js/translate.js` (the APP⇄config boundary), real `usages.js` |
| 3 Feature tabs | ✅ | Mappings, Monitor (live), Settings, **Macros editor**, **Quirks editor**, Expressions, Quick Start, Actions |
| 4 Combos | ✅ | **Superseded and improved:** combos are NATIVE in the firmware (AND-gate usage page `0xFFFB`) rather than a web-only `combos[]` field. `CONFIG_VERSION` still 18. Wire layout only; Inline/Stacked deleted. |
| 5 Gaps & polish | ✅ | RGB LED presets, full 27-file firmware download grid with the live release tag, empty/error states |
| 6 Verify & deploy | ✅ deployed / ⏳ hardware | Deployed + verified live. **The hardware test on `JJ8S` is the only thing left** (never `CUSS`). |

**v1 feature parity is COMPLETE** — macros, quirks, expressions (all 55 ops), hub ports,
device-reported usages, layer-forcing safety, monitor, JSON, firmware downloads. v2 additionally
has combos, per-field reset-to-firmware-default, and per-row enable/disable.

**What the review caught (all fixed):** Bootstrap made every toast invisible (so buttons looked
dead); expression constants are ×1000 fixed point and `0.05 mul` was being written as `0 mul`; a
`.modal-scrim` CSS collision made the usage picker impossible to close; two blank rows merged into
one group; a failed save left the device SUSPENDED; save could wipe macros/expressions/quirks.
See memory `learning_hid_vx_web_ui_bugs.md`.

**Deploy gotcha:** GitHub Pages caches ~10 min — **bump `?v=<date>` on every asset in
`config-tool-web-v2/index.html` on every deploy**, and verify with `curl`, never the browser.

---

**Original plan (2026-07-08) below, kept for the record.**

**Status:** PLAN ONLY — do not start implementation yet.
**Date:** 2026-07-08

## Goal
Ship a **new, redesigned** web config tool that keeps the Claude Design UI (amber theme, combos, device name, disable toggle, RGB-LED swatches) but has the **full working functionality** of the current tool (WebHID, real device protocol, real usage tables, RGB LED, load/save, monitor). Built on a **separate branch** and as a **separate web tool directory** — the current `config-tool-web/` stays untouched and live. Combos: **Wire layout only** (drop Inline/Stacked).

## Source files (confirmed complete)
- **Design export** = `hid-remapper-vx/` (from Claude Design project `c3d7878f-276c-4a39-817e-23e7aa93a1c6`). Available three ways: DesignSync `get_file`, and two zips in `C:\Users\qzaid\Downloads\hid-remapper-rede\` (`hid-remapper.zip` = code only; `hid-remapper (1).zip` = + screenshots). Files: `index.html` + `css/{app,mappings,expressions,settings}.css` + `js/{usages,state,icons,core,anim,picker,mappings,quickstart,tabs,expr-engine,expressions,settings-json,app}.js`.
- **Current working tool** = `config-tool-web/` in this repo: `index.html` + `code.js` (WebHID + binary protocol + load/save + monitor) + `usages.js` (full HID tables) + `examples.js`.

## The core reality: reskin **and** rewire
- The **design is a non-functional UI mock** — Bootstrap 5.1.3 + plain `<script>` tags, renders into `<div id="app">` from a **mock `state.js`**. It has **NO WebHID** (verified: no `navigator.hid` / `requestDevice` / `sendReport` anywhere). "Load/Save from device" are cosmetic.
- The **current tool is functional but old-looking**. It owns the real device layer, protocol, full usages, RGB-LED codes, monitor, and the config format (`CONFIG_VERSION 18`).
- **Integration = put the current tool's brains inside the new UI.** Not a drop-in.

### RGB LED (decision 2026-07-08 — keep it simple)
**Keep the current static preset-collection approach** — the fixed set of named LED colors as swatches. **No special `0xFFFA` code handling / no custom color picker / no raw hex.** The real 16-preset LED collection already lives in the current `config-tool-web/usages.js`, so it simply comes across when that file is ported (Phase 2) — there is **no separate "swap the codes" task**. The design's swatch UI is kept; it's just backed by the real preset list.

## Approach (recommended)
**Hybrid, leaning "start from the design shell":** the design is the target look and is already modular, so use `hid-remapper-vx/` as the base and **port the real subsystems from `code.js` into it, module by module, verifying each against a real device.** (Alternative — reskin the working tool with the design's markup/CSS — is more disruptive to the design's structure. Decide at Phase 0; recommendation stands.)

## Setup
- **Branch:** `feature/web-redesign` (off `master`).
- **New tool dir:** `config-tool-web-v2/` (name TBD — see open decisions). Copy the design's `hid-remapper-vx/` files in as the starting shell. **Leave `config-tool-web/` alone.**
- Keep the design files re-pullable via DesignSync `get_file` so a Claude Design update can be re-based cleanly.

## Phases

### Phase 0 — Scaffold
Create branch + `config-tool-web-v2/`; drop in the design files; confirm it opens statically in Chrome (mock data, no device). Decide the base-direction (design-shell vs reskin) here.

### Phase 1 — Recon & mapping (produces the granular task list)
Read both codebases fully. Map **every** real subsystem in `code.js` to its home in the new modules: connect/disconnect, `load_from_device`, `save_to_device`, the command constants + binary framing, monitor, macros, settings fields, expressions engine, quick actions, JSON import/export, RGB LED, device-name/disable. Confirm the design's `usages.js`/`state.js` are mock and list exactly what the real versions must provide.

### Phase 2 — Port the device layer (hardest)
Wire **real WebHID** connect/disconnect into the new top bar; port the **binary protocol** + load/save; swap the design's mock `usages.js` for the **real full usage tables** (incl. the real RGB-LED codes); point the new `picker.js` at them. **Gate:** a real Pico round-trips load → edit → save → reload correctly.

### Phase 3 — Port the feature tabs
Mappings (rows/layers/modes/scale/per-row tint/disable) on real data; Monitor (real HID activity + "+ to add mapping"); Macros; Settings (real fields incl. tap-hold + combo timing); Quick Actions. **Expressions:** keep the real engine/ops (match `firmware/EXPRESSIONS.md`); the design's expressions.js is a UI shell — do **not** redesign the logic.

### Phase 4 — Combos = WIRE ONLY
Keep only the **Wire** combo layout; **remove the Inline/Stacked toggle and their code** from `mappings.js` / `mappings.css`. Data model: additive **`combos[]`** JSON + **firmware-capability gating** (hide/disable the combo UI when the connected firmware lacks combo support). **CONFIG_VERSION stays 18.** (Actual firmware combo support is a separate future task; the web tool represents/stores combos now.)

### Phase 5 — Gaps & polish
- **RGB LED:** keep the swatch UI **and the current static preset-collection as-is** (it comes across with the ported `usages.js`); show the color in the row's output. No custom color picker / no raw hex / no special code-swap.
- **Firmware download grid** (Actions): grouped per board (Pico/Pico W, Pico 2/2 W, RP2040-Zero, RP2350-Zero) with single/dual/LED variants and the real `.uf2` URLs.
- Consistency polish across all tabs; empty/disconnected/error states.

### Phase 6 — Verify & deploy
Full pass on a real device (connect, load, edit, save, reload; every tab; RGB LED on an LED board; combos UI). Decide the deploy path for the separate tool (a GitHub Pages subpath, or keep unpublished until ready).

## Constraints (carry through all phases)
- Vanilla JS + Bootstrap 5.1.3, **no build step**. Chrome/Edge (WebHID).
- **`CONFIG_VERSION` stays 18**; all new saved data is **additive** JSON (device name, disable, combos).
- Expressions logic unchanged; hard limits **8 layers / 32 macros / 8 expressions**.
- **Feature-gate firmware-dependent UI** (combos; RGB LED on non-LED boards) by detecting device capability on connect.
- Keep `config-tool-web/` (the current live tool) fully intact and working.

## Decisions (locked 2026-07-08)
1. **New tool directory:** `config-tool-web-v2/`. ✅
2. **Branch:** `feature/web-redesign` (off master). ✅
3. **Design source of truth:** the CURRENT export (Downloads zips + DesignSync project `c3d7878f`) is **already the post-gaps version** (the owner sent the gaps message to Claude Design and this is what came back). Use it as-is; re-pull via DesignSync only if the design is changed again. NOTE: Claude Design's RGB-LED **swatch UI** is kept as-is. Per owner (2026-07-08): **keep the current static LED preset-collection approach — no special 0xFFFA code work, no custom picker**; the real preset list arrives with the ported `usages.js`. ✅
4. **Deploy:** publish the new tool to a **separate GitHub Pages path** as we go. ✅
5. **Cutover** (later, not now): decide whether to eventually replace `config-tool-web/` or run both.
