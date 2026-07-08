/* ============================================================
   HID Remapper VX — Mappings tab (rows, combos, interactions)
   ============================================================ */
(function () {
  const { APP, ROW_TINTS, tintById, mk } = window.HRX_STATE;
  const { usageName, usageAccent } = window.HRX_USAGES;
  const { h, $, $$, toast } = window.HRX;

  const COMBO_LAYOUTS = [
    { id: "wire", label: "Wire" },
    { id: "inline", label: "Inline" },
    { id: "stacked", label: "Stacked" },
  ];

  function findMap(id) { return APP.mappings.find((m) => m.id === +id); }
  function indexOfMap(id) { return APP.mappings.findIndex((m) => m.id === +id); }

  /* ---------- usage button ---------- */
  function usageBtnHtml(code, { mid, role, i = 0 } = {}) {
    const empty = !code || code === "0x00000000";
    const accent = usageAccent(code);
    const { isLed, ledColor } = window.HRX_USAGES;
    if (isLed(code)) {
      const col = ledColor(code);
      const chip = col
        ? `<span class="led-swatch-mini" style="background:${col};--glow:${col}"></span>`
        : `<span class="led-swatch-mini off"></span>`;
      return `
        <button class="usage-btn led-out" style="--cat:${col || "var(--border-bright)"}"
          data-pick="1" data-mid="${mid}" data-role="${role}" data-i="${i}" title="Hardware RGB LED output">
          ${chip}
          <span class="u-name">LED ${usageName(code)}</span>
          <span class="chev">${ICON.chevron}</span>
        </button>`;
    }
    return `
      <button class="usage-btn ${empty ? "empty" : ""}" style="--cat:${accent}"
        data-pick="1" data-mid="${mid}" data-role="${role}" data-i="${i}">
        <span class="u-cat-dot"></span>
        <span class="u-name">${usageName(code)}</span>
        <span class="chev">${ICON.chevron}</span>
      </button>`;
  }

  /* ---------- input cell — ONE cell for both solo & combo ----------
     Signal-flow metaphor: the input key sits at the start, a line runs toward
     the output. A solo press = empty line. A combo = extra key(s) dropped ONTO
     that same line on the way to the output. Same cell, same structure — the
     only difference is whether the line carries combo keys. */
  function inputCellHtml(m) {
    const isCombo = m.inputs.length > 1;
    const layout = APP.comboLayout;
    const canAdd = m.inputs.length < 4;

    const chip = (code, i, removable) => {
      removable = removable !== undefined ? removable : m.inputs.length > 1;
      return `
        <div class="combo-chip">
          ${usageBtnHtml(code, { mid: m.id, role: "input", i })}
          ${removable ? `<button class="chip-x" data-rmin="1" data-mid="${m.id}" data-i="${i}" title="Remove this input">${ICON.x}</button>` : ""}
        </div>`;
    };
    const addBtn = (cls) => canAdd
      ? `<button class="combo-add ${cls || (isCombo ? "inline-plus" : "")}" data-addin="1" data-mid="${m.id}"
           title="${isCombo ? "Add another key to this combo" : "Drop a key on the line — fires only when pressed together"}">${ICON.plus}</button>`
      : "";

    /* ---- WIRE (default) ---- */
    if (layout === "wire") {
      const nodes = m.inputs.slice(1).map((code, idx) => {
        const i = idx + 1;
        return `<div class="wire-node">
          ${usageBtnHtml(code, { mid: m.id, role: "input", i })}
          <button class="chip-x" data-rmin="1" data-mid="${m.id}" data-i="${i}" title="Remove this combo key">${ICON.x}</button>
        </div>`;
      }).join('<span class="wire-plus-join">+</span>');
      return `
        <div class="input-cell wire ${isCombo ? "is-combo" : "is-solo"}">
          <div class="wire-start">${chip(m.inputs[0], 0, false)}</div>
          <div class="wire-track" title="${isCombo ? "Combo — these keys must be pressed together" : "Fires on its own — drop a key on the line to make a combo"}">
            <span class="wire-line"></span>
            <div class="wire-on">${nodes}${addBtn("wire-add")}</div>
          </div>
        </div>`;
    }

    /* ---- INLINE / STACKED (alternates) ---- */
    if (!isCombo) {
      return `
        <div class="input-cell">
          ${chip(m.inputs[0], 0)}
          ${addBtn()}
        </div>`;
    }
    let inner = "";
    m.inputs.forEach((code, i) => {
      if (i > 0) inner += `<span class="combo-join" title="and">+</span>`;
      inner += chip(code, i);
    });
    const stacked = layout === "stacked" ? "stacked" : "";
    return `
      <div class="input-cell">
        <div class="combo-group ${stacked}">
          <span class="combo-group-label">${ICON.link}<span>Press together</span></span>
          <div class="combo-keys ${stacked}">${inner}</div>
        </div>
        ${addBtn()}
      </div>`;
  }

  /* ---------- flags: layers (line 1) + Sticky/Tap/Hold (line 2) — LOCKED 2-line ---------- */
  function flagsHtml(m) {
    const layers = m.layers.map((on, i) =>
      `<span class="chk layer ${on ? "on" : ""}" data-layer="${i}" data-mid="${m.id}" title="Active on layer ${i}">${i}</span>`
    ).join("");
    const sth = [
      ["sticky", "Sticky", "Sticky — output latches on; press again to release"],
      ["tap", "Tap", "Tap — fires on a quick tap (shorter than the tap-hold threshold)"],
      ["hold", "Hold", "Hold — fires only when the key is held down"],
    ].map(([k, lbl, title]) =>
      `<span class="chk mode word m-${k} ${m[k] ? "on" : ""}" data-flag="${k}" data-mid="${m.id}" title="${title}">${lbl}</span>`
    ).join("");
    return `
      <div class="flags-cell">
        <div class="flag-line">
          <span class="flag-key">Layers</span>
          <div class="chk-row">${layers}</div>
        </div>
        <div class="flag-line">
          <span class="flag-key">When</span>
          <div class="chk-row seg modes">${sth}</div>
        </div>
      </div>`;
  }

  /* ---------- one row ---------- */
  function rowHtml(m, idx) {
    const t = tintById(m.tint);
    const isCombo = m.inputs.length > 1;
    // default striping = alternating purple / green; a chosen category color overrides it
    const zebra = m.tint ? "" : (idx % 2 === 0 ? "zebra-a" : "zebra-b");
    const style = m.tint ? `style="background:${t.fill};border-left-color:${t.edge}"` : "";
    const off = m.enabled ? "" : "disabled";
    return `
    <div class="map-row ${zebra} ${isCombo ? "combo" : ""} ${off}" data-mid="${m.id}" draggable="true" ${style}>
      <div class="row-ctrls">
        <button class="icon-btn power ${m.enabled ? "" : "off"}" data-toggle="1" data-mid="${m.id}" title="${m.enabled ? "Disable this mapping" : "Enable this mapping"}">${ICON.power}</button>
        <button class="icon-btn drag" title="Drag to reorder" data-drag="1">${ICON.grip}</button>
        <button class="icon-btn" data-move="up" data-mid="${m.id}" title="Move up" ${idx === 0 ? "disabled" : ""}>${ICON.up}</button>
        <button class="icon-btn" data-move="down" data-mid="${m.id}" title="Move down" ${idx === APP.mappings.length - 1 ? "disabled" : ""}>${ICON.down}</button>
        <button class="icon-btn" data-clone="1" data-mid="${m.id}" title="Clone">${ICON.clone}</button>
        <button class="icon-btn del" data-del="1" data-mid="${m.id}" title="Delete">${ICON.x}</button>
      </div>
      ${inputCellHtml(m)}
      <div class="map-arrow">${ICON.arrow}</div>
      <div class="output-cell">${usageBtnHtml(m.output, { mid: m.id, role: "output" })}</div>
      ${flagsHtml(m)}
      <div class="scale-wrap"><input class="scale-input" type="number" step="0.001" value="${(+m.scale.toFixed(3))}" data-scale="1" data-mid="${m.id}" title="Scaling factor"></div>
      <div class="tint-wrap" style="position:relative">
        <button class="tint-btn" data-tint="1" data-mid="${m.id}" title="Row color / category">
          <span class="tint-core" style="background:${t.id ? t.edge : "transparent"};border:${t.id ? "none" : "1px dashed var(--label)"}"></span>
        </button>
      </div>
      ${m.enabled ? "" : `<div class="disabled-badge">Disabled</div>`}
    </div>`;
  }

  /* ---------- WIRE forked groups: same button = one cell, wire forks per behavior ---------- */
  function groupByFirstInput(list) {
    const groups = [];
    const idx = {};
    list.forEach((m) => {
      const k = m.inputs[0];
      if (idx[k] === undefined) { idx[k] = groups.length; groups.push({ key: k, members: [] }); }
      groups[idx[k]].members.push(m);
    });
    return groups;
  }

  function branchHtml(m) {
    const isCombo = m.inputs.length > 1;
    const canAdd = m.inputs.length < 4;
    const nodes = m.inputs.slice(1).map((code, idx) => {
      const i = idx + 1;
      return `<div class="wire-node">
        ${usageBtnHtml(code, { mid: m.id, role: "input", i })}
        <button class="chip-x" data-rmin="1" data-mid="${m.id}" data-i="${i}" title="Remove this combo key">${ICON.x}</button>
      </div>`;
    }).join('<span class="wire-plus-join">+</span>');
    const add = canAdd
      ? `<button class="combo-add wire-add" data-addin="1" data-mid="${m.id}" title="${isCombo ? "Add another key to this combo" : "Drop a key on this branch — fires only when pressed together"}">${ICON.plus}</button>`
      : "";
    const t = tintById(m.tint);
    const style = m.tint ? `style="background:${t.fill}"` : "";
    const off = m.enabled ? "" : "disabled";
    return `
      <div class="wg-branch ${isCombo ? "is-combo" : "is-solo"} ${off}" data-mid="${m.id}" draggable="true" ${style}>
        <div class="wire-track branch-wire" title="${isCombo ? "Combo branch — these keys must be pressed together" : "This button pressed on its own"}">
          <span class="wire-line"></span>
          <div class="wire-on">${nodes}${add}</div>
        </div>
        <div class="map-arrow">${ICON.arrow}</div>
        <div class="output-cell">${usageBtnHtml(m.output, { mid: m.id, role: "output" })}</div>
        ${flagsHtml(m)}
        <div class="scale-wrap"><input class="scale-input" type="number" step="0.001" value="${(+m.scale.toFixed(3))}" data-scale="1" data-mid="${m.id}" title="Scaling factor"></div>
        <div class="tint-wrap" style="position:relative">
          <button class="tint-btn" data-tint="1" data-mid="${m.id}" title="Row color / category">
            <span class="tint-core" style="background:${t.id ? t.edge : "transparent"};border:${t.id ? "none" : "1px dashed var(--label)"}"></span>
          </button>
        </div>
        <div class="row-ctrls compact">
          <button class="icon-btn power ${m.enabled ? "" : "off"}" data-toggle="1" data-mid="${m.id}" title="${m.enabled ? "Disable this behavior" : "Enable this behavior"}">${ICON.power}</button>
          <button class="icon-btn drag bdrag" title="Drag to reorder">${ICON.grip}</button>
          <button class="icon-btn" data-clone="1" data-mid="${m.id}" title="Clone">${ICON.clone}</button>
          <button class="icon-btn del" data-del="1" data-mid="${m.id}" title="Delete">${ICON.x}</button>
        </div>
        ${m.enabled ? "" : `<div class="disabled-badge">Disabled</div>`}
      </div>`;
  }

  function groupHtml(group) {
    const code = group.key;
    const empty = !code || code === "0x00000000";
    const forked = group.members.length > 1 ? "forked" : "";
    const combos = group.members.filter((m) => m.inputs.length > 1).length;
    const meta = group.members.length > 1
      ? `<span class="trunk-meta">${group.members.length} ways${combos ? ` · ${combos} combo` : ""}</span>`
      : "";
    return `
      <div class="wire-group ${forked}" data-groupkey="${code}" draggable="true">
        <div class="wg-trunk">
          <button class="usage-btn trunk-btn ${empty ? "empty" : ""}" style="--cat:${usageAccent(code)}" data-pickgroup="${code}" title="Change this input — applies to every behavior below">
            <span class="grip-dots" title="Drag to reorder this button">${ICON.grip}</span>
            <span class="u-cat-dot"></span>
            <span class="u-name">${usageName(code)}</span>
            <span class="chev">${ICON.chevron}</span>
          </button>
          ${meta}
        </div>
        <div class="wg-branches">
          <div class="wg-rows">${group.members.map(branchHtml).join("")}</div>
          <button class="wg-add" data-addbranch="${code}" title="Add another behavior for this button — pressed alone or as a combo">${ICON.plus}</button>
        </div>
      </div>`;
  }

  function wireHeadHtml() {
    return `
      <div class="wire-head">
        <div class="wh-trunk">Input button</div>
        <div class="wh-cols">
          <div>Pressed alone / in a combo</div>
          <div class="mh-arrow"></div>
          <div>Output</div>
          <div>Layers · Modes</div>
          <div style="text-align:center">Scale</div>
          <div style="text-align:center">Color</div>
          <div style="text-align:center">Edit</div>
        </div>
      </div>`;
  }

  function mapHeadHtml() {
    return `
      <div class="map-head">
        <div>Reorder · Edit</div>
        <div>Input <span style="color:var(--purple-hi)">· + makes a combo</span></div>
        <div class="mh-arrow"></div>
        <div>Output</div>
        <div>Layers · Modes</div>
        <div style="text-align:center">Scale</div>
        <div style="text-align:center">Color</div>
      </div>`;
  }

  /* ---------- whole tab ---------- */
  window.renderMappings = function (container) {
    const layoutSeg = COMBO_LAYOUTS.map((l) =>
      `<button class="${APP.comboLayout === l.id ? "on" : ""}" data-layout="${l.id}">${l.label}</button>`
    ).join("");

    const isWire = APP.comboLayout === "wire";
    const emptyState = `<div class="empty-state">
          <div class="es-glyph">${ICON.chip}</div>
          <h4>No mappings yet</h4>
          <div>Add a mapping, or jump to <b>Quick Start</b> for one-click presets.</div>
        </div>`;

    let bodyInner;
    if (isWire) {
      let groups = groupByFirstInput(APP.mappings);
      if (APP.groupDisabled) {
        // disabled behaviors sink within each button…
        groups.forEach((g) => g.members.sort((a, b) => (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1)));
        // …and fully-disabled buttons sink to the bottom of the list
        groups = [...groups].sort((a, b) => {
          const ad = a.members.every((m) => !m.enabled);
          const bd = b.members.every((m) => !m.enabled);
          return ad === bd ? 0 : ad ? 1 : -1;
        });
      }
      bodyInner = `${wireHeadHtml()}<div id="rowList" class="wire-list">${groups.length ? groups.map(groupHtml).join("") : emptyState}</div>`;
    } else {
      let list = APP.mappings;
      if (APP.groupByInput) {
        list = [...APP.mappings].sort((a, b) => usageName(a.inputs[0]).localeCompare(usageName(b.inputs[0])));
      }
      if (APP.groupDisabled) {
        list = [...list].sort((a, b) => (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1));
      }
      const rows = list.length ? list.map((m, i) => rowHtml(m, i)).join("") : emptyState;
      bodyInner = `${mapHeadHtml()}<div id="rowList">${rows}</div>`;
    }

    const groupNote = isWire
      ? `<span class="hint" style="margin-left:auto">Same button = one cell · the wire forks for each behavior</span>`
      : `<span class="hint" style="margin-left:auto">${APP.mappings.length} mapping${APP.mappings.length === 1 ? "" : "s"} · ${APP.mappings.filter((m) => m.inputs.length > 1).length} combo${APP.mappings.filter((m) => m.inputs.length > 1).length === 1 ? "" : "s"}</span>`;

    container.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">Mappings</div>
          <div class="panel-sub">${isWire ? "Each input button lives in one cell. The wire forks into a separate path for every behavior — alone, or as a combo." : "Map any input key, button or axis to an output. Press keys together with combos."}</div>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="hint" style="font-family:var(--font-mono);font-size:10px;letter-spacing:1px;text-transform:uppercase">Combo layout</span>
            <div class="seg-ctrl" id="layoutSeg">${layoutSeg}</div>
          </div>
        </div>
      </div>
      <div class="panel-body">
        ${bodyInner}
        <div class="toolbar-row">
          <button class="btn-hx btn-primary" id="addMap">${ICON.plus}<span>Add mapping</span></button>
          ${isWire ? "" : `<button class="btn-hx ${APP.groupByInput ? "btn-primary" : "btn-ghost"}" id="groupBtn">${ICON.layers}<span>Group by Input</span></button>`}
          <button class="btn-hx ${APP.groupDisabled ? "btn-primary" : "btn-ghost"}" id="groupDisabledBtn">${ICON.power}<span>Disabled last</span></button>
          ${groupNote}
        </div>
      </div>
    </div>`;

    wireMappings(container);
  };

  /* ---------- wiring ---------- */
  function refresh() {
    const root = $("#tabContent");
    const snap = window.HRX_FLIP ? window.HRX_FLIP.flipCapture(root) : null;
    window.renderMappings(root);
    if (snap) window.HRX_FLIP.flipPlay($("#tabContent"), snap);
  }

  function wireMappings(root) {
    // combo layout switch
    $$('#layoutSeg [data-layout]', root).forEach((b) =>
      b.addEventListener("click", () => { APP.comboLayout = b.dataset.layout; refresh(); }));

    $("#addMap", root).addEventListener("click", () => {
      APP.mappings.push(mk("0x00000000", "0x00000000"));
      refresh();
      toast("Mapping added");
    });

    const groupBtn = $("#groupBtn", root);
    if (groupBtn) groupBtn.addEventListener("click", () => { APP.groupByInput = !APP.groupByInput; refresh(); });

    const groupDisabledBtn = $("#groupDisabledBtn", root);
    if (groupDisabledBtn) groupDisabledBtn.addEventListener("click", () => { APP.groupDisabled = !APP.groupDisabled; refresh(); });

    // change a forked group's shared input — applies to all its behaviors
    $$('[data-pickgroup]', root).forEach((b) => b.addEventListener("click", () => {
      const oldCode = b.dataset.pickgroup;
      window.openPicker({
        mode: "input",
        current: oldCode,
        onSelect: (code) => {
          APP.mappings.forEach((m) => { if (m.inputs[0] === oldCode) m.inputs[0] = code; });
          refresh();
        },
      });
    }));

    // add another behavior (branch) for the same button
    $$('[data-addbranch]', root).forEach((b) => b.addEventListener("click", () => {
      APP.mappings.push(mk(b.dataset.addbranch, "0x00000000"));
      refresh();
      toast("New behavior added for this button");
    }));

    // usage picker triggers
    $$('[data-pick]', root).forEach((b) => b.addEventListener("click", () => {
      const m = findMap(b.dataset.mid);
      const role = b.dataset.role;
      const i = +b.dataset.i;
      const current = role === "input" ? m.inputs[i] : m.output;
      window.openPicker({
        mode: role,
        current,
        onSelect: (code) => {
          if (role === "input") {
            // no duplicate keys within one combo
            if (code !== "0x00000000" && m.inputs.some((c, j) => j !== i && c === code)) {
              toast("That key is already in this combo");
              return;
            }
            m.inputs[i] = code;
          } else m.output = code;
          refresh();
        },
      });
    }));

    // add combo input
    $$('[data-addin]', root).forEach((b) => b.addEventListener("click", () => {
      const m = findMap(b.dataset.mid);
      if (m.inputs.length >= 4) return;
      m.inputs.push("0x00000000");
      refresh();
      toast(m.inputs.length === 2 ? "Combo created — press both keys together" : "Combo key added");
    }));

    // remove combo input
    $$('[data-rmin]', root).forEach((b) => b.addEventListener("click", () => {
      const m = findMap(b.dataset.mid);
      m.inputs.splice(+b.dataset.i, 1);
      if (m.inputs.length === 0) m.inputs = ["0x00000000"];
      refresh();
    }));

    // move up/down
    $$('[data-move]', root).forEach((b) => b.addEventListener("click", () => {
      const idx = indexOfMap(b.dataset.mid);
      const to = b.dataset.move === "up" ? idx - 1 : idx + 1;
      if (to < 0 || to >= APP.mappings.length) return;
      const [row] = APP.mappings.splice(idx, 1);
      APP.mappings.splice(to, 0, row);
      refresh();
    }));

    // clone
    $$('[data-clone]', root).forEach((b) => b.addEventListener("click", () => {
      const idx = indexOfMap(b.dataset.mid);
      const m = APP.mappings[idx];
      const copy = JSON.parse(JSON.stringify(m));
      copy.id = window.HRX_STATE.uid();
      APP.mappings.splice(idx + 1, 0, copy);
      refresh();
      toast("Mapping cloned");
    }));

    // delete
    $$('[data-del]', root).forEach((b) => b.addEventListener("click", () => {
      const idx = indexOfMap(b.dataset.mid);
      APP.mappings.splice(idx, 1);
      refresh();
    }));

    // enable / disable toggle
    $$('[data-toggle]', root).forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = findMap(b.dataset.mid);
      m.enabled = !m.enabled;
      refresh();
      toast(m.enabled ? "Mapping enabled" : "Mapping disabled");
    }));

    // layers
    $$('[data-layer]', root).forEach((b) => b.addEventListener("click", () => {
      const m = findMap(b.dataset.mid);
      m.layers[+b.dataset.layer] = !m.layers[+b.dataset.layer];
      b.classList.toggle("on");
    }));

    // S/T/H flags
    $$('[data-flag]', root).forEach((b) => b.addEventListener("click", () => {
      const m = findMap(b.dataset.mid);
      m[b.dataset.flag] = !m[b.dataset.flag];
      b.classList.toggle("on");
    }));

    // scale
    $$('[data-scale]', root).forEach((inp) => inp.addEventListener("change", () => {
      const m = findMap(inp.dataset.mid);
      m.scale = parseFloat(inp.value) || 0;
    }));

    // tint picker
    $$('[data-tint]', root).forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      openTintPop(b, findMap(b.dataset.mid));
    }));

    wireDrag(root);
  }

  /* ---------- tint popover ---------- */
  function openTintPop(btn, m) {
    $$('.tint-pop').forEach((p) => p.remove());
    const swatches = ROW_TINTS.map((t) =>
      `<div class="tint-swatch ${m.tint === t.id ? "sel" : ""}" data-t="${t.id}" title="${t.name}"
        style="background:${t.id ? t.edge : "var(--bg-deep)"}">${t.id ? "" : `<span class="x-line">∅</span>`}</div>`
    ).join("");
    const pop = h(`<div class="tint-pop open"><div class="hint" style="margin-bottom:7px;font-family:var(--font-mono);font-size:10px;letter-spacing:1px;text-transform:uppercase">Category color</div><div class="tint-grid">${swatches}</div></div>`);
    btn.parentElement.appendChild(pop);
    $$('.tint-swatch', pop).forEach((sw) => sw.addEventListener("click", () => {
      m.tint = sw.dataset.t === "null" ? null : sw.dataset.t;
      pop.remove();
      refresh();
    }));
    setTimeout(() => document.addEventListener("click", function close(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("click", close); }
    }), 0);
  }

  /* ---------- drag & drop reorder ---------- */
  function reorderMappings(fromId, toId) {
    const from = indexOfMap(fromId);
    const to = indexOfMap(toId);
    if (from === -1 || to === -1 || from === to) return;
    const [r] = APP.mappings.splice(from, 1);
    APP.mappings.splice(to, 0, r);
    refresh();
  }

  function reorderGroups(fromKey, toKey) {
    const groups = groupByFirstInput(APP.mappings);
    const fi = groups.findIndex((g) => g.key === fromKey);
    const ti = groups.findIndex((g) => g.key === toKey);
    if (fi === -1 || ti === -1 || fi === ti) return;
    const [moved] = groups.splice(fi, 1);
    groups.splice(ti, 0, moved);
    APP.mappings = groups.reduce((acc, g) => acc.concat(g.members), []);
    refresh();
  }

  function wireDrag(root) {
    let dragId = null;

    // inline / stacked rows
    $$('.map-row', root).forEach((row) => {
      row.addEventListener("dragstart", (e) => {
        dragId = row.dataset.mid;
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => { row.classList.remove("dragging"); $$('.map-row', root).forEach((r) => r.classList.remove("drag-over")); });
      row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drag-over"); });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", (e) => { e.preventDefault(); reorderMappings(dragId, row.dataset.mid); });
    });

    // WIRE — branch drag (reorder behaviors) — innermost, stops bubbling to group
    $$('.wg-branch', root).forEach((br) => {
      br.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        dragId = br.dataset.mid;
        br.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", "b"); } catch (_) {}
      });
      br.addEventListener("dragend", (e) => { e.stopPropagation(); br.classList.remove("dragging"); $$('.wg-branch', root).forEach((x) => x.classList.remove("drag-over")); });
      br.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); br.classList.add("drag-over"); });
      br.addEventListener("dragleave", (e) => { e.stopPropagation(); br.classList.remove("drag-over"); });
      br.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); reorderMappings(dragId, br.dataset.mid); });
    });

    // WIRE — group drag (reorder whole buttons)
    let dragKey = null;
    $$('.wire-group', root).forEach((g) => {
      g.addEventListener("dragstart", (e) => {
        if (e.target.closest(".wg-branch")) return; // branch handles its own
        dragKey = g.dataset.groupkey;
        g.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      g.addEventListener("dragend", () => { g.classList.remove("dragging"); $$('.wire-group', root).forEach((x) => x.classList.remove("drag-over")); });
      g.addEventListener("dragover", (e) => { if (!dragKey) return; e.preventDefault(); g.classList.add("drag-over"); });
      g.addEventListener("dragleave", () => g.classList.remove("drag-over"));
      g.addEventListener("drop", (e) => {
        if (!dragKey) return;
        e.preventDefault();
        const k = dragKey; dragKey = null;
        reorderGroups(k, g.dataset.groupkey);
      });
    });
  }
})();
