/* ============================================================
   HID Remapper VX — Edit config JSON (Settings)

   A popup that shows the full device configuration in the real
   HID-Remapper JSON format (version 18). Edit by hand, validate,
   and Apply — or insert a sample. Nothing is applied until Apply.
   ============================================================ */
(function () {
  const { APP, mk } = window.HRX_STATE;
  const toast = (window.HRX && window.HRX.toast) || function () {};

  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const IC = {
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
    wand: svg('<path d="m15 4 1.5 1.5M3 21l9-9M14 5l5 5M18 2l1 1M22 6l1 1M19 9l1 1"/>'),
  };

  /* a faithful sample in the device format */
  const SAMPLE = {
    version: 18,
    unmapped_passthrough_layers: [0, 1, 2, 3, 4, 5, 6, 7],
    partial_scroll_timeout: 1000000,
    tap_hold_threshold: 200000,
    gpio_debounce_time_ms: 5,
    interval_override: 1,
    our_descriptor_number: 0,
    ignore_auth_dev_inputs: false,
    macro_entry_duration: 1,
    gpio_output_mode: 0,
    input_labels: 0,
    normalize_gamepad_inputs: true,
    mappings: [
      { target_usage: "0x000c0224", source_usage: "0x000c00e2", scaling: 1000, layers: [0], sticky: false, tap: false, hold: false, source_port: 0, target_port: 0 },
      { target_usage: "0x00070073", source_usage: "0x000c00cf", scaling: 1000, layers: [0], sticky: false, tap: false, hold: false, source_port: 0, target_port: 0 },
    ],
    macros: Array.from({ length: 32 }, () => []),
    expressions: ["", "", "", "", "", "", "", ""],
    quirks: [],
  };

  /* ---- APP <-> device JSON — delegated to translate.js (single source of truth).
     configToJson exports the FULL config: combos are real mappings on usage page
     0xFFFB, plus the additive disabled_rows[] so switched-off rows survive a
     round trip. applyJson folds a parsed config back into APP in place. ---- */
  function configToJson() {
    return JSON.stringify(window.HRX_TRANSLATE.appToConfig(APP), null, 4);
  }
  function applyJson(obj) {
    const next = window.HRX_TRANSLATE.configToApp(obj, APP, window.HRX_STATE.uid);
    Object.assign(APP, next);
    // This config no longer mirrors the device — it came from JSON (import, hand-edit, or the
    // modal's sample). app.js will make the user confirm before a save overwrites the device's
    // macros/expressions/quirks with it.
    if (window.HRX.setConfigSource) window.HRX.setConfigSource("json");
  }

  /* ---- modal ---- */
  let mState = null;
  function open() {
    close();
    const initial = configToJson();
    mState = { initial };

    const scrim = document.createElement("div");
    scrim.className = "modal-scrim";
    scrim.addEventListener("click", (e) => { if (e.target === scrim) requestClose(); });
    scrim.innerHTML = `
      <div class="modal modal-json">
        <div class="modal-head">
          <div>
            <div class="modal-kicker">Device configuration</div>
            <div class="modal-title">Edit config JSON</div>
          </div>
          <div class="modal-spacer"></div>
          <span class="cfg-status" id="cfgStatus">${IC.check}<span>Valid JSON</span></span>
          <button class="icon-btn modal-close" id="cfgClose" title="Close">${IC.x}</button>
        </div>
        <div class="modal-body">
          <div class="cfg-hint">Full device configuration in HID-Remapper format (schema <b>version 18</b>). Edit it by hand and press Apply — values map back into Mappings, Settings and Expressions. Nothing changes until you Apply.</div>
          <textarea class="cfg-json" id="cfgJson" spellcheck="false"></textarea>
          <div class="cfg-error" id="cfgError"></div>
        </div>
        <div class="modal-foot">
          <button class="btn-hx btn-sm" id="cfgSample">${IC.doc}<span>Load sample</span></button>
          <button class="btn-hx btn-sm btn-ghost" id="cfgFormat">${IC.wand}<span>Format</span></button>
          <div class="modal-spacer"></div>
          <button class="btn-hx" id="cfgCancel">Cancel</button>
          <button class="btn-hx btn-primary" id="cfgApply">${IC.check}<span>Apply</span></button>
        </div>
      </div>`;
    document.body.appendChild(scrim);
    mState.scrim = scrim;

    const ta = scrim.querySelector("#cfgJson");
    ta.value = initial;
    mState.ta = ta;
    mState.statusEl = scrim.querySelector("#cfgStatus");
    mState.errEl = scrim.querySelector("#cfgError");

    ta.addEventListener("input", validate);
    scrim.querySelector("#cfgClose").addEventListener("click", requestClose);
    scrim.querySelector("#cfgCancel").addEventListener("click", requestClose);
    scrim.querySelector("#cfgFormat").addEventListener("click", format);
    scrim.querySelector("#cfgSample").addEventListener("click", loadSample);
    scrim.querySelector("#cfgApply").addEventListener("click", apply);

    mState.keyHandler = (e) => { if (e.key === "Escape") requestClose(); };
    document.addEventListener("keydown", mState.keyHandler);
    validate();
  }

  function close() {
    if (!mState) return;
    document.removeEventListener("keydown", mState.keyHandler);
    if (mState.scrim) mState.scrim.remove();
    mState = null;
  }
  function requestClose() {
    if (mState && mState.ta.value !== mState.initial) {
      if (!confirm("Discard changes to the config JSON?")) return;
    }
    close();
  }

  function parseCurrent() {
    try { return { ok: true, obj: JSON.parse(mState.ta.value) }; }
    catch (e) { return { ok: false, msg: e.message }; }
  }
  function validate() {
    const res = parseCurrent();
    if (res.ok && res.obj && typeof res.obj === "object") {
      mState.statusEl.className = "cfg-status ok";
      mState.statusEl.innerHTML = `${IC.check}<span>Valid JSON</span>`;
      mState.errEl.style.display = "none";
      mState.ta.classList.remove("bad");
      return true;
    }
    mState.statusEl.className = "cfg-status err";
    mState.statusEl.innerHTML = `${IC.x}<span>Invalid</span>`;
    mState.errEl.style.display = "block";
    mState.errEl.textContent = res.msg ? "Parse error: " + res.msg : "Top level must be a JSON object.";
    mState.ta.classList.add("bad");
    return false;
  }
  function format() {
    const res = parseCurrent();
    if (!res.ok) { validate(); return; }
    mState.ta.value = JSON.stringify(res.obj, null, 4);
    validate();
  }
  function loadSample() {
    mState.ta.value = JSON.stringify(SAMPLE, null, 4);
    validate();
  }
  function apply() {
    if (!validate()) { toast("Fix the JSON before applying"); return; }
    const res = parseCurrent();
    applyJson(res.obj);
    close();
    if (window.HRX && window.HRX.setTab) window.HRX.setTab("settings");
    toast("Configuration applied");
  }

  window.openConfigJson = open;
  window.HRX_JSON = { configToJson, applyJson }; // reused by the Actions tab (export/import file)
})();
