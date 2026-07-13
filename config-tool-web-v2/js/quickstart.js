/* ============================================================
   HID Remapper VX — Quick Start tab

   Two things, both REAL:
     * Presets     — one click appends a working mapping.
     * Examples    — the 72 ready-made configs from the original tool (js/examples.js,
                     copied verbatim so it can be re-synced upstream).

   The design mock's "Shortcut grid" and "Example configs" gallery were FAKE — the
   shortcut buttons added the same nothing->Enter mapping whatever you clicked, and each
   "example" pushed N BLANK mappings while the toast claimed it had added a working
   config. Both are gone; these are the genuine article.
   ============================================================ */
(function () {
  const { APP, mk } = window.HRX_STATE;
  const { $, $$, toast } = window.HRX;
  const T = window.HRX_TRANSLATE;

  // Each preset builds real mappings from real usages. `add()` returns the rows to append.
  const PRESETS = [
    { icon: ICON.check, color: "#7c5cff", title: "Fix the OK button", sub: "Menu Select → Return (Enter)",
      add: () => [mk("0x000c0041", "0x00070028", { tint: "nav" })] },
    { icon: ICON.mic, color: "#f06292", title: "Remap voice control", sub: "Mic button → AC Home",
      add: () => [mk("0x000c0221", "0x000c0223", { tint: "system" })] },
    { icon: ICON.home, color: "#ffb74d", title: "Hold Back for Home", sub: "Hold AC Back → AC Home",
      add: () => [mk("0x000c0224", "0x000c0223", { tint: "system", hold: true })] },
    { icon: ICON.keyboard, color: "#5b8cff", title: "D-pad → arrow keys", sub: "Up / Down / Left / Right → keyboard arrows",
      add: () => [
        mk("0x00070052", "0x00070052", { tint: "nav" }),
        mk("0x00070051", "0x00070051", { tint: "nav" }),
        mk("0x00070050", "0x00070050", { tint: "nav" }),
        mk("0x0007004f", "0x0007004f", { tint: "nav" }),
      ] },
    { icon: ICON.macro, color: "#81c784", title: "Play/pause on tap", sub: "Play/Pause fires only on a quick tap",
      add: () => [mk("0x000c00cd", "0x000c00cd", { tint: "media", tap: true })] },
  ];

  /* ---- the 72 example configs from the original tool ----
     They are stored in the DEVICE config format (older ones use the v3 shape), so they must be
     migrated and unit-converted before they can be used — an example's expression constants are
     integers ×1000, and its scaling is ×1000. Getting that wrong silently corrupts the config. */
  function migrate(cfg) {
    const c = JSON.parse(JSON.stringify(cfg));
    if (c.version === 3) {
      // v3: a single boolean passthrough, one layer per mapping, 8 macros
      c.unmapped_passthrough_layers = c.unmapped_passthrough ? [0] : [];
      delete c.unmapped_passthrough;
      (c.mappings || []).forEach((m) => { m.layers = [m.layer || 0]; delete m.layer; });
      c.macros = Array.from({ length: 32 }, () => []);
    }
    (c.mappings || []).forEach((m) => {
      if ("layer" in m && !("layers" in m)) { m.layers = [m.layer]; delete m.layer; }
      if (!("layers" in m)) m.layers = [0];
      if (!("tap" in m)) m.tap = false;
      if (!("hold" in m)) m.hold = false;
      if (!("sticky" in m)) m.sticky = false;
      if (!("scaling" in m)) m.scaling = 1000;
      if (!("source_port" in m)) m.source_port = 0;
      if (!("target_port" in m)) m.target_port = 0;
    });
    return c;
  }

  // APPEND an example (v1's add_example): its mappings are added, and its expressions/macros only
  // fill slots that are still EMPTY — so it never clobbers what you already have.
  function addExample(i) {
    const ex = migrate(window.HRX_EXAMPLES[i].config);
    let added = 0, exprs = 0, macros = 0;

    (ex.mappings || []).forEach((cm) => {
      APP.mappings.push(T.configMappingToApp(cm, window.HRX_STATE.uid));
      added++;
    });

    (ex.expressions || []).forEach((e, n) => {
      if (e && !APP.expressions[n]) { APP.expressions[n] = T.exprToApp(e); exprs++; }   // device -> human units
    });

    (ex.macros || []).forEach((m, n) => {
      if (m && m.length && APP.macros[n] && APP.macros[n].length === 0) { APP.macros[n] = m; macros++; }
    });

    const bits = [added + " mapping" + (added === 1 ? "" : "s")];
    if (exprs) bits.push(exprs + " expression" + (exprs === 1 ? "" : "s"));
    if (macros) bits.push(macros + " macro" + (macros === 1 ? "" : "s"));
    toast("Added: " + bits.join(", "));
    window.HRX.setTab("mappings");
  }

  // REPLACE the whole config with an example (v1's load_example). Destructive — so it confirms,
  // and it marks the config as no longer device-sourced, which makes Save ask before overwriting.
  function loadExample(i) {
    const ex = window.HRX_EXAMPLES[i];
    if (!confirm('Replace your ENTIRE config with "' + ex.description + '"?\n\n' +
                 "Every mapping, macro and expression on this page is discarded. (The device itself " +
                 "only changes when you press Save to device.)")) return;
    window.HRX_JSON.applyJson(migrate(ex.config));   // applyJson marks the source as "json"
    toast('Loaded: "' + ex.description + '"');
    window.HRX.setTab("mappings");
  }

  let exQuery = "";

  window.renderQuickActions = function (container) {
    const presetCards = PRESETS.map((p, i) => `
      <button class="preset-card" data-preset="${i}">
        <div class="preset-icon" style="color:${p.color}">${p.icon}</div>
        <div><div class="pc-title">${p.title}</div><div class="pc-sub">${p.sub}</div></div>
      </button>`).join("");

    const all = window.HRX_EXAMPLES || [];
    const q = exQuery.trim().toLowerCase();
    const hits = all
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !q || e.description.toLowerCase().includes(q));

    const exRows = hits.map(({ e, i }) => {
      const c = e.config || {};
      const bits = [];
      if (c.mappings && c.mappings.length) bits.push(c.mappings.length + " mapping" + (c.mappings.length === 1 ? "" : "s"));
      if ((c.expressions || []).some((x) => x)) bits.push("expressions");
      if ((c.macros || []).some((m) => m && m.length)) bits.push("macros");
      return `
        <div class="example-row">
          <div class="ex-main">
            <div class="ex-title">${e.description}</div>
            <div class="ex-meta">${bits.join(" · ") || "config"}</div>
          </div>
          <button class="btn-hx btn-primary btn-sm" data-exadd="${i}" title="Append this example's mappings to your config">${ICON.plus}<span>Add</span></button>
          <button class="btn-hx btn-sm" data-exload="${i}" title="Replace your entire config with this example">${ICON.download}<span>Replace</span></button>
        </div>`;
    }).join("");

    container.innerHTML = `
    <div class="panel"><div class="panel-body">
      <div class="qa-section">
        <div class="qa-section-head">
          <h3>Preset fixes</h3>
          <p>One click appends a real, working mapping. Nothing reaches the device until you press
             <b>Save to device</b>.</p>
        </div>
        <div class="preset-grid">${presetCards}</div>
      </div>

      <div class="qa-section" style="margin-bottom:0">
        <div class="qa-section-head">
          <h3>Examples <span class="section-tag" style="margin-left:6px">${all.length}</span></h3>
          <p>The ready-made configs from the original tool. <b>Add</b> appends an example's mappings
             to what you already have (its expressions and macros only fill empty slots).
             <b>Replace</b> swaps your whole config for it.</p>
        </div>
        <div class="search-wrap" style="max-width:420px;margin-bottom:12px">
          ${ICON.search}
          <input class="input-hx" id="exSearch" placeholder="Search examples — scroll, dpi, macro, gamepad…"
                 value="${exQuery}" autocomplete="off">
        </div>
        <div class="example-list">
          ${exRows || `<div class="macro-empty">No example matches “${exQuery}”.</div>`}
        </div>
      </div>
    </div></div>`;

    $$('[data-preset]', container).forEach((b) => b.addEventListener("click", () => {
      const p = PRESETS[+b.dataset.preset];
      const rows = p.add();
      APP.mappings.push(...rows);
      toast(`Added: ${p.title} (${rows.length} mapping${rows.length === 1 ? "" : "s"})`);
    }));

    $$('[data-exadd]', container).forEach((b) => b.addEventListener("click", () => addExample(+b.dataset.exadd)));
    $$('[data-exload]', container).forEach((b) => b.addEventListener("click", () => loadExample(+b.dataset.exload)));

    const s = $("#exSearch", container);
    if (s) s.addEventListener("input", () => {
      exQuery = s.value;
      const pos = s.selectionStart;
      window.renderQuickActions($("#tabContent"));
      const s2 = $("#exSearch");
      if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
    });
  };
})();
