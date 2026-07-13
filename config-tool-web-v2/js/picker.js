/* ============================================================
   HID Remapper VX — Usage Picker modal
   ============================================================ */
(function () {
  const { USAGE_CATEGORIES } = window.HRX_USAGES;
  const { h, $, $$ } = window.HRX;

  let scrim = null;
  let state = null; // { mode, current, onSelect, query }

  function buildScrim() {
    // `picker-scrim`, NOT the shared `modal-scrim`: expressions.css also styles .modal-scrim and
    // is loaded later, where it sets `display: grid` with no hidden state (its modals are created
    // and removed, not toggled). Sharing the class made the picker impossible to close.
    scrim = h(`<div class="picker-scrim" id="pickerScrim"></div>`);
    document.body.appendChild(scrim);
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && scrim.classList.contains("open")) close(); });
  }

  function close() {
    scrim.classList.remove("open");
    scrim.innerHTML = "";   // drop the old list + its listeners; the next open rebuilds it
    state = null;
  }
  window.HRX_PICKER_IS_OPEN = () => !!(scrim && scrim.classList.contains("open"));

  // opts: { mode:'input'|'output', current, onSelect(code),
  //         port?:number, onPort?(port)  <- optional hub-port control (v1 parity) }
  window.openPicker = function ({ mode, current, onSelect, port, onPort }) {
    if (!scrim) buildScrim();
    state = { mode, current, onSelect, port, onPort, query: "" };
    scrim.innerHTML = pickerHtml();
    scrim.classList.add("open");
    wire();
    setTimeout(() => { const s = $("#pickerSearch"); if (s) s.focus(); }, 30);
  };

  function pickerHtml() {
    const title = state.mode === "input" ? "Select input" : "Select output";
    const kicker = state.mode === "input" ? "Source usage" : "Target usage";
    const nav = categories().map((c) => {
      const dot = c.led
        ? `<span class="nav-dot" style="background:conic-gradient(#ff3b30,#ffe11a,#22c55e,#22d3ee,#3b82f6,#a855f7,#ff5fa2,#ff3b30)"></span>`
        : `<span class="nav-dot" style="background:${c.accent}"></span>`;
      return `<button data-jump="${c.id}">${dot}${c.label}</button>`;
    }).join("");

    return `
    <div class="picker" role="dialog" aria-modal="true">
      <div class="picker-head">
        <div class="picker-titlebar">
          <div>
            <div class="picker-kicker">${kicker}</div>
            <div class="picker-title">${title}</div>
          </div>
          <button class="btn-hx btn-ghost btn-sm picker-close" id="pickerClose">${ICON.x}<span>Close</span></button>
        </div>
        <div class="picker-controls">
          ${portHtml()}
          <div class="field" style="flex:1">
            <label>Search</label>
            <div class="search-wrap">
              ${ICON.search}
              <input class="input-hx" id="pickerSearch" placeholder="Search keys, buttons, codes…" autocomplete="off">
            </div>
          </div>
          <div class="field">
            <label>Custom hex</label>
            <div style="display:flex;gap:6px">
              <input class="input-hx" id="pickerCustom" placeholder="0x000c00e9" style="width:130px;font-family:var(--font-mono)">
              <button class="btn-hx btn-sm" id="pickerCustomApply">${ICON.check}<span>Use</span></button>
            </div>
          </div>
        </div>
      </div>
      <div class="picker-body">
        <div class="picker-nav" id="pickerNav">${nav}</div>
        <div class="picker-list" id="pickerList">${listHtml("")}</div>
      </div>
    </div>`;
  }

  /* Hub port (v1 parity). Only shown when the caller supplies onPort — i.e. when the picker is
     editing a real mapping. The mock had a dead "Port" dropdown here; this is the working one.
     0 = any port; 1-4 = only when the source device is on that USB hub port. */
  function portHtml() {
    if (!state.onPort) return "";
    const cur = state.port || 0;
    const label = state.mode === "input" ? "Source port" : "Target port";
    // the port is a nibble on the wire (0-15), and v1 offers the full range — match it
    const opts = Array.from({ length: 16 }, (_, v) =>
      `<option value="${v}" ${v === cur ? "selected" : ""}>${v === 0 ? "0 — Any" : v}</option>`).join("");
    return `
      <div class="field">
        <label>${label}</label>
        <select class="select-hx" id="pickerPort" style="width:104px">${opts}</select>
      </div>`;
  }

  /* The usages THIS device reports (fetched on load via GET_OUR_USAGES / GET_THEIR_USAGES).
     Shown first, because they are the ones that definitely exist on the hardware in front of you —
     and because a device can emit usages the static catalog has never heard of. */
  function deviceCategory() {
    const APP = window.HRX_STATE && window.HRX_STATE.APP;
    const du = APP && APP.deviceUsages;
    if (!du) return null;
    const list = (state.mode === "input" ? du.source : du.target) || [];
    if (!list.length) return null;
    return {
      id: "device",
      label: state.mode === "input" ? "Reported by your device" : "Supported by your device",
      accent: "#22c55e",
      usages: list.map((code) => [code, window.HRX_USAGES.usageName(code)]),
    };
  }

  /* "Input labels" (Settings). A mouse and a gamepad report the SAME HID codes, so the same number
     is either "Left button" or "Button 1". v1 shows one label set or the other in the source picker;
     we do the same, otherwise the setting would be a control that changes nothing. */
  function labelFiltered(cats) {
    if (state.mode !== "input") return cats;                 // v1 only filters the source picker
    const APP = window.HRX_STATE && window.HRX_STATE.APP;
    const mode = (APP && APP.settings && APP.settings.inputLabels) || 0;   // 0 = mouse, 1 = gamepad
    const drop = mode === 1 ? "mouse" : "gamepad";
    return cats.filter((c) => c.id !== drop);
  }

  /* OUTPUTS FOLLOW THE EMULATED PROFILE.
     `usages[our_descriptor_number]` (from the original tool) is the set of usages a given emulated
     device can actually SEND — a "Nintendo Switch" build cannot emit mouse movement. Offering those
     targets anyway lets you build a mapping the device will silently ignore, so the output list is
     filtered to the current profile, and the profile's own NAME is used where it has one.

     The firmware's internal target pages are always available whatever the profile: layers, macros,
     GPIO, registers, digipot, D-pad and the RGB LED. (Expressions, 0xFFF3, are a SOURCE only — you
     read an expression, you never write to one — so they are correctly not offered as an output.) */
  const ALWAYS_TARGETABLE = ["0xfff1", "0xfff2", "0xfff4", "0xfff5", "0xfff6", "0xfff9", "0xfffa"];
  function profileTargets() {
    if (state.mode !== "output") return null;                // only the target list is constrained
    const v1 = window.HRX_V1_USAGES;
    const APP = window.HRX_STATE && window.HRX_STATE.APP;
    if (!v1 || !APP) return null;
    const table = v1[APP.settings.emulatedDevice] || v1[0];
    if (!table) return null;
    const allowed = new Set(Object.keys(table).map((k) => k.toLowerCase()));
    return { allowed, name: (code) => (table[code] && table[code].name) || null };
  }
  const alwaysOk = (code) => ALWAYS_TARGETABLE.some((p) => code.startsWith(p));

  function categories() {
    const dev = deviceCategory();
    let cats = labelFiltered(dev ? [dev].concat(USAGE_CATEGORIES) : USAGE_CATEGORIES.slice());

    const prof = profileTargets();
    if (prof) {
      cats = cats.map((c) => {
        const usages = c.usages
          .filter(([code]) => prof.allowed.has(code) || alwaysOk(code))
          .map(([code, name]) => [code, prof.name(code) || name]);   // the profile's own label wins
        return Object.assign({}, c, { usages });
      }).filter((c) => c.usages.length);
    }
    return cats;
  }

  function listHtml(query) {
    const q = query.trim().toLowerCase();
    let blocks = "";
    let any = false;
    const cats = categories();
    cats.forEach((cat) => {
      const matches = cat.usages.filter(([code, name]) =>
        !q || name.toLowerCase().includes(q) || code.toLowerCase().includes(q)
      );
      if (!matches.length) return;
      any = true;
      let inner;
      if (cat.led) {
        const { ledColor } = window.HRX_USAGES;
        inner = `<div class="led-grid">` + matches.map(([code, name]) => {
          const active = code === state.current ? "active" : "";
          const col = ledColor(code);
          const chip = col
            ? `<span class="led-chip" style="background:${col};--glow:${col}"></span>`
            : `<span class="led-chip off"></span>`;
          return `<button class="led-swatch ${active}" data-code="${code}" title="LED ${name} — ${code}">
            ${chip}<span class="led-name">${name}</span>
          </button>`;
        }).join("") + `</div>`;
      } else {
        inner = `<div class="usage-grid">` + matches.map(([code, name]) => {
          const active = code === state.current ? "active" : "";
          return `<button class="usage-pill ${active}" data-code="${code}">
            <span>${name}</span><span class="code">${code.replace("0x", "")}</span>
          </button>`;
        }).join("") + `</div>`;
      }
      blocks += `
        <div class="cat-block" id="cat-${cat.id}">
          <div class="cat-title">
            <span class="ct-bar" style="background:${cat.accent}"></span>
            <span class="ct-text">${cat.label}</span>
            <span class="ct-count">${matches.length}</span>
          </div>
          ${inner}
        </div>`;
    });
    if (!any) blocks = `<div class="no-results">No usages match “${query}”. Try the Custom field for a raw hex code.</div>`;
    return blocks;
  }

  function wire() {
    $("#pickerClose").addEventListener("click", close);

    const portSel = $("#pickerPort");
    if (portSel) portSel.addEventListener("change", () => {
      state.port = parseInt(portSel.value, 10) || 0;
      state.onPort(state.port);
    });

    const search = $("#pickerSearch");
    search.addEventListener("input", () => { $("#pickerList").innerHTML = listHtml(search.value); wirePills(); });

    // Custom hex — validated and zero-padded, with a real button (v1 parity). Sending an
    // unpadded or malformed code straight to the device would write a garbage usage.
    const custom = $("#pickerCustom");
    const applyCustom = () => {
      const raw = custom.value.trim().replace(/^0x/i, "");
      if (!/^[0-9a-f]{1,8}$/i.test(raw)) {
        custom.classList.add("bad");
        if (window.HRX && window.HRX.toast) window.HRX.toast("Enter a hex usage code, e.g. 0x000c00e9");
        return;
      }
      const code = "0x" + raw.toLowerCase().padStart(8, "0");
      state.onSelect(code);
      close();
    };
    custom.addEventListener("input", () => custom.classList.remove("bad"));
    custom.addEventListener("keydown", (e) => { if (e.key === "Enter") applyCustom(); });
    $("#pickerCustomApply").addEventListener("click", applyCustom);

    $$('#pickerNav [data-jump]').forEach((b) => b.addEventListener("click", () => {
      $$('#pickerNav button').forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      const list = $("#pickerList");
      const block = $("#cat-" + b.dataset.jump);
      if (!list || !block) return;
      // offsetTop is measured against the nearest POSITIONED ancestor, which is not necessarily
      // the scroll container — using it made the jump land in the wrong place. Measure the real
      // delta between the two boxes instead, which is correct whatever the layout does.
      const delta = block.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTo({ top: list.scrollTop + delta - 10, behavior: "smooth" });
    }));

    wirePills();
  }

  function wirePills() {
    $$('#pickerList .usage-pill, #pickerList .led-swatch').forEach((p) => p.addEventListener("click", () => {
      state.onSelect(p.dataset.code);
      close();
    }));
  }
})();
