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
    const nav = USAGE_CATEGORIES.map((c) => {
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
            <label>Custom</label>
            <input class="input-hx" id="pickerCustom" placeholder="0x000c00e9" style="width:130px;font-family:var(--font-mono)">
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
    const opts = [[0, "0 — Any"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]]
      .map(([v, t]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${t}</option>`).join("");
    return `
      <div class="field">
        <label>${label}</label>
        <select class="select-hx" id="pickerPort" style="width:104px">${opts}</select>
      </div>`;
  }

  function listHtml(query) {
    const q = query.trim().toLowerCase();
    let blocks = "";
    let any = false;
    USAGE_CATEGORIES.forEach((cat) => {
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

    $("#pickerCustom").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.value.trim()) {
        let v = e.target.value.trim();
        if (!v.startsWith("0x")) v = "0x" + v;
        state.onSelect(v.toLowerCase());
        close();
      }
    });

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
