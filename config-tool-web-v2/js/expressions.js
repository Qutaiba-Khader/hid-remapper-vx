/* ============================================================
   HID Remapper VX — Expressions tab

   • The tab is a LIST of the 8 expression slots (read-only).
   • Editing opens a MODAL that works on a DRAFT copy — the live
     config is only touched when you press Apply (Cancel discards).
   • The editor has full UNDO / REDO.

   Inside the modal: the RPN code editor and a visual block tree
   stay in two-way sync. Stack-trick expressions (dup/swap/…)
   show a short "edit as code" note while the editor keeps working.
   ============================================================ */
(function () {
  const { APP } = window.HRX_STATE;
  const E = window.HRX_EXPR;

  /* ---- tiny DOM helpers ---- */
  function el(sel, props, children) {
    const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i) || [];
    const node = document.createElement(m[1] || "div");
    ((m[2] || "").match(/[.#][\w-]+/g) || []).forEach((t) => { if (t[0] === ".") node.classList.add(t.slice(1)); else node.id = t.slice(1); });
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") node.className += (node.className ? " " : "") + v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value") node.value = v;
      else node.setAttribute(k, v);
    }
    if (children != null) (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const EIC = {
    code: svg('<path d="m8 6-6 6 6 6M16 6l6 6-6 6"/>'),
    blocks: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    alert: svg('<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'),
    chev: svg('<path d="M6 9l6 6 6-6"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    trash: svg('<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  };

  /* ---- serializer / hole / summary ---- */
  function ser(n) {
    if (!n) return "";
    if (n.t === "hole") return "?";
    if (n.t === "num" || n.t === "usage") return n.v;
    return n.args.map(ser).join(" ") + " " + n.name;
  }
  function hasHole(n) { if (!n) return false; if (n.t === "hole") return true; if (n.args) return n.args.some(hasHole); return false; }
  /* hole-aware parser: like E.parse but treats “?” as an unfilled slot {t:'hole'},
     so incomplete drafts round-trip through undo/redo/templates without losing the tree. */
  function parseDraft(str) {
    const toks = E.tokenize(str);
    if (!toks.length) return { ok: true, tree: null, empty: true };
    const stack = [];
    for (const tok of toks) {
      if (E.isCommentTok(tok)) continue;                                     // not an operation
      if (tok === "?") { stack.push({ t: "hole" }); continue; }
      if (E.isNumTok(tok)) { stack.push(E.isHexTok(tok) ? { t: "usage", v: tok } : { t: "num", v: tok }); continue; }
      const op = E.OPS[tok];
      if (!op) return { ok: false, reason: "Unknown operation \u201c" + tok + "\u201d" };
      if (op.special || op.out !== 1) return { ok: false, reason: "Uses the stack operation \u201c" + tok + "\u201d" };
      if (stack.length < op.arity) return { ok: false, reason: "Not enough values for \u201c" + tok + "\u201d" };
      const args = stack.splice(stack.length - op.arity, op.arity);
      stack.push({ t: "op", name: tok, args });
    }
    if (stack.length !== 1) return { ok: false, reason: "Expression leaves " + stack.length + " values on the stack" };
    return { ok: true, tree: stack[0], hasHole: hasHole(stack[0]) };
  }
  function summary(str) {
    if (!str || !str.trim()) return null;
    const res = E.parse(str);
    if (res.ok && res.tree) { try { return E.toEnglish(res.tree); } catch (e) { return "Advanced expression"; } }
    return "Advanced expression (RPN)";
  }

  const ARG_LABELS = {
    clamp: ["value", "min", "max"], ifte: ["condition", "if true", "if false"], atan2: ["y", "x"],
    add: ["a", "b"], sub: ["a", "b"], mul: ["a", "b"], div: ["a", "b"], mod: ["a", "b"],
    min: ["a", "b"], max: ["a", "b"], gt: ["a", "b"], lt: ["a", "b"], eq: ["a", "b"],
    bitwise_and: ["a", "b"], bitwise_or: ["a", "b"],
  };
  const OP_GROUPS = [
    ["Math", ["add", "sub", "mul", "div", "mod", "min", "max", "abs", "sign", "round", "sqrt", "relu", "clamp"]],
    ["Compare", ["gt", "lt", "eq"]],
    ["Logic", ["not", "ifte"]],
    ["Trig", ["sin", "cos", "atan2"]],
    ["Bitwise", ["bitwise_and", "bitwise_or", "bitwise_not"]],
  ];
  const OP_LABEL = {
    add: "add (+)", sub: "subtract (−)", mul: "multiply (×)", div: "divide (÷)", mod: "modulo",
    min: "minimum", max: "maximum", abs: "absolute", sign: "sign", round: "round", sqrt: "square root",
    relu: "clip negatives", clamp: "limit to range", gt: "greater than", lt: "less than", eq: "equals",
    not: "invert on/off", ifte: "if / then / else", sin: "sine", cos: "cosine", atan2: "atan2",
    bitwise_and: "bitwise and", bitwise_or: "bitwise or", bitwise_not: "bitwise not",
  };
  const FETCHES = [["input_state", "value"], ["input_state_binary", "pressed?"], ["input_state_scaled", "0–255"]];

  const SYM = { add: "+", sub: "−", mul: "×", div: "÷", mod: "mod", gt: ">", lt: "<", eq: "=", bitwise_and: "&", bitwise_or: "|", bitwise_not: "~" };

  /* token palette — tap to append onto the stack (Option C: stack-lane model) */
  const PALETTE_GROUPS = [
    // `pick: true` = open the real key picker and use whatever the user chooses, instead of
    // injecting a hardcoded usage. `op` is the fetch applied to the chosen key.
    ["Values", [
      { label: "Key value…", title: "Pick a key/axis — its analog value", cat: "input", pick: true, op: "input_state" },
      { label: "Key pressed?…", title: "Pick a key — 1 while it is held, else 0", cat: "input", pick: true, op: "input_state_binary" },
      { label: "Key 0–255…", title: "Pick an axis — its scaled 0-255 value", cat: "input", pick: true, op: "input_state_scaled" },
      { label: "Number", cat: "num", ins: ["0"] },
      { label: "Time", cat: "time", ins: ["time"] },
      { label: "Layers", cat: "state", ins: ["layer_state"] },
      { label: "Register", cat: "memory", ins: ["1", "recall"] },
    ]],
    ["Math", [
      { label: "+", title: "add", cat: "math", ins: ["add"] },
      { label: "−", title: "subtract", cat: "math", ins: ["sub"] },
      { label: "×", title: "multiply", cat: "math", ins: ["mul"] },
      { label: "÷", title: "divide", cat: "math", ins: ["div"] },
      { label: "mod", cat: "math", ins: ["mod"] },
      { label: "min", cat: "math", ins: ["min"] },
      { label: "max", cat: "math", ins: ["max"] },
      { label: "abs", cat: "math", ins: ["abs"] },
      { label: "round", cat: "math", ins: ["round"] },
      { label: "√", title: "square root", cat: "math", ins: ["sqrt"] },
      { label: "limit", title: "clamp to range", cat: "math", ins: ["clamp"] },
    ]],
    ["Compare", [
      { label: "greater >", cat: "compare", ins: ["gt"] },
      { label: "less <", cat: "compare", ins: ["lt"] },
      { label: "equals =", cat: "compare", ins: ["eq"] },
    ]],
    ["Logic", [
      { label: "invert", title: "not", cat: "logic", ins: ["not"] },
      { label: "if / then / else", cat: "logic", ins: ["ifte"] },
    ]],
    ["Stack", [
      { label: "dup", title: "duplicate the top value", cat: "stack", ins: ["dup"] },
      { label: "swap", title: "swap the top two", cat: "stack", ins: ["swap"] },
      { label: "store", title: "store to a register", cat: "memory", ins: ["store"] },
    ]],
    ["More", [
      { label: "sin", cat: "trig", ins: ["sin"] },
      { label: "cos", cat: "trig", ins: ["cos"] },
      { label: "atan2", cat: "trig", ins: ["atan2"] },
      { label: "sign", cat: "math", ins: ["sign"] },
      { label: "relu", cat: "math", ins: ["relu"] },
      { label: "and &", title: "bitwise and", cat: "bitwise", ins: ["bitwise_and"] },
      { label: "or |", title: "bitwise or", cat: "bitwise", ins: ["bitwise_or"] },
      { label: "not ~", title: "bitwise not", cat: "bitwise", ins: ["bitwise_not"] },
    ]],
  ];

  /* ============================================================
     LIST VIEW
     ============================================================ */
  let listHost = null;
  function render(container) {
    listHost = container;
    clear(container);
    const panel = el(".panel");
    const head = el(".panel-head");
    head.appendChild(el("div", null, [
      el(".panel-title", null, "Expressions"),
      el(".panel-sub", null, "8 RPN expression slots. Editing opens a draft — nothing changes until you press Apply."),
    ]));
    panel.appendChild(head);
    const body = el(".panel-body");
    const list = el(".expr-list");
    for (let i = 0; i < 8; i++) list.appendChild(rowEl(i));
    body.appendChild(list);
    panel.appendChild(body);
    container.appendChild(panel);
  }

  function rowEl(i) {
    const code = (APP.expressions[i] || "").trim();
    const filled = code.length > 0;
    const row = el(".expr-row" + (filled ? "" : ".empty"));
    row.appendChild(el(".er-badge", null, String(i)));

    const mid = el(".er-mid");
    if (filled) {
      mid.appendChild(el(".er-reads", null, summary(code)));
      mid.appendChild(el(".er-code", null, code));
    } else {
      mid.appendChild(el(".er-reads.muted", null, "Empty slot"));
    }
    row.appendChild(mid);

    const acts = el(".er-acts");
    if (filled) {
      acts.appendChild(el("button.btn-hx.btn-sm", { onclick: () => openEditor(i) }, [el("span", { html: EIC.edit }), "Edit"]));
      acts.appendChild(el("button.icon-btn", { title: "Clear slot", onclick: () => clearSlot(i) }, [el("span", { html: EIC.trash })]));
    } else {
      acts.appendChild(el("button.btn-hx.btn-sm.btn-primary", { onclick: () => openEditor(i) }, [el("span", { html: EIC.plus }), "Add expression"]));
    }
    row.appendChild(acts);
    return row;
  }

  function clearSlot(i) {
    APP.expressions[i] = "";
    render(listHost);
    if (window.HRX && window.HRX.toast) window.HRX.toast("Expression " + i + " cleared");
  }

  /* ============================================================
     MODAL EDITOR  (draft + undo/redo)
     ============================================================ */
  let M = null; // modal state

  function openEditor(slot) {
    closeEditor();
    M = {
      slot,
      draft: APP.expressions[slot] || "",
      tree: null,
      hist: [APP.expressions[slot] || ""],
      hi: 0,
      lastTyping: false,
      lastTime: 0,
      syncing: false,
    };

    const scrim = el(".modal-scrim", { onclick: (e) => { if (e.target === scrim) requestClose(); } });
    const modal = el(".modal");

    // header
    const head = el(".modal-head");
    head.appendChild(el("div", null, [
      el(".modal-kicker", null, "Edit expression"),
      el(".modal-title", null, "Slot " + slot),
    ]));
    head.appendChild(el(".modal-spacer"));
    M.undoBtn = el("button.icon-btn", { title: "Undo (Ctrl+Z)", onclick: undo }, [el("span", { html: EIC.undo })]);
    M.redoBtn = el("button.icon-btn", { title: "Redo (Ctrl+Shift+Z)", onclick: redo }, [el("span", { html: EIC.redo })]);
    head.appendChild(M.undoBtn);
    head.appendChild(M.redoBtn);
    M.syncEl = el(".sync-ind.ok");
    head.appendChild(M.syncEl);
    head.appendChild(el("button.icon-btn.modal-close", { title: "Close", onclick: requestClose }, [el("span", { html: EIC.x })]));
    modal.appendChild(head);

    // body — palette (left) + canvas (right)
    const body = el(".modal-body");
    const main = el(".modal-main");

    // LEFT: block palette. (The mock had a "Start from a template" gallery of canned recipes
    // hardcoded to Mouse X / Button 1. It was example data, not the user's device — removed.)
    const pal = el(".palette");
    const bsec = el(".pal-sec");
    bsec.appendChild(el(".pal-sec-title", null, "Add a block"));
    bsec.appendChild(el(".pal-hint", null, "Tap to append onto the stack — watch it build on the right."));
    PALETTE_GROUPS.forEach(([label, items]) => {
      bsec.appendChild(el(".pal-grp-label", null, label));
      const chips = el(".pal-chips");
      items.forEach((it) => {
        chips.appendChild(el("button.pal-chip.cat-" + it.cat, { title: it.title || it.label, onclick: () => addFromPalette(it) }, it.label));
      });
      bsec.appendChild(chips);
    });
    pal.appendChild(bsec);
    main.appendChild(pal);

    // RIGHT: canvas
    const canvas = el(".canvas-col");
    const laneHead = el(".lane-head");
    laneHead.appendChild(el(".expr-col-label", { style: "margin:0" }, [el("span", { html: EIC.blocks }), "Stack lane"]));
    laneHead.appendChild(el(".lane-hint", null, "Drag chips to reorder · tap × to remove"));
    M.clearBtn = el("button.btn-hx.btn-sm.btn-ghost", { onclick: () => { if (!M.tokens.length) return; M.tokens = []; commitTokens(false); } }, [el("span", { html: EIC.trash }), "Clear"]);
    laneHead.appendChild(M.clearBtn);
    canvas.appendChild(laneHead);
    M.blocksEl = el(".expr-blocks.canvas");
    canvas.appendChild(M.blocksEl);
    M.readEl = el(".readback");
    canvas.appendChild(M.readEl);
    main.appendChild(canvas);

    body.appendChild(main);

    // generated-expression bar (the RPN code, editable + copyable)
    const gen = el(".gen-bar");
    const genHead = el(".gen-head");
    genHead.appendChild(el(".expr-col-label", { style: "margin:0" }, [el("span", { html: EIC.code }), "Generated RPN"]));
    M.copyBtn = el("button.btn-hx.btn-sm", { onclick: copyRpn }, [el("span", { html: EIC.copy }), "Copy"]);
    genHead.appendChild(M.copyBtn);
    gen.appendChild(genHead);
    M.codeEl = el("textarea.expr-code.gen-code", { spellcheck: "false", oninput: onCode });
    gen.appendChild(M.codeEl);
    body.appendChild(gen);

    modal.appendChild(body);

    // footer
    const foot = el(".modal-foot");
    foot.appendChild(el(".hint", null, "Changes apply only when you press Apply."));
    foot.appendChild(el(".modal-spacer"));
    foot.appendChild(el("button.btn-hx", { onclick: requestClose }, "Cancel"));
    M.applyBtn = el("button.btn-hx.btn-primary", { onclick: applyEditor }, [el("span", { html: EIC.check }), "Apply"]);
    foot.appendChild(M.applyBtn);
    modal.appendChild(foot);

    scrim.appendChild(modal);
    document.body.appendChild(scrim);
    M.scrim = scrim;
    M.keyHandler = (e) => {
      if (e.key === "Escape") { requestClose(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); }
    };
    document.addEventListener("keydown", M.keyHandler);

    loadDraft(M.draft);
    updateHistButtons();
  }

  function closeEditor() {
    if (!M) return;
    document.removeEventListener("keydown", M.keyHandler);
    if (M.scrim) M.scrim.remove();
    M = null;
  }
  function requestClose() {
    if (M && M.draft !== (APP.expressions[M.slot] || "")) {
      if (!confirm("Discard changes to this expression?")) return;
    }
    closeEditor();
  }
  function applyEditor() {
    const a = analyze(M.tokens);
    const valid = !M.tokens.length || (!a.unknown && !a.underflow && a.depth === 1);
    if (!valid) { toastMsg("Finish the expression first — it must leave exactly one result."); return; }
    APP.expressions[M.slot] = M.draft;
    const slot = M.slot;
    closeEditor();
    render(listHost);
    if (window.HRX && window.HRX.toast) window.HRX.toast("Expression " + slot + " applied");
  }

  /* ---- history ---- */
  function snapshot(fromTyping) {
    const v = M.draft;
    if (v === M.hist[M.hi]) return;
    const now = performance.now();
    if (fromTyping && M.lastTyping && now - M.lastTime < 700) {
      M.hist[M.hi] = v; // coalesce a run of typing into one undo step
    } else {
      M.hist.length = M.hi + 1; // drop redo branch
      M.hist.push(v);
      M.hi = M.hist.length - 1;
    }
    M.lastTyping = fromTyping; M.lastTime = now;
    updateHistButtons();
  }
  function undo() { if (M.hi > 0) { M.hi--; M.lastTyping = false; loadDraft(M.hist[M.hi]); updateHistButtons(); } }
  function redo() { if (M.hi < M.hist.length - 1) { M.hi++; M.lastTyping = false; loadDraft(M.hist[M.hi]); updateHistButtons(); } }
  function updateHistButtons() {
    if (!M) return;
    M.undoBtn.classList.toggle("disabled", M.hi <= 0);
    M.redoBtn.classList.toggle("disabled", M.hi >= M.hist.length - 1);
  }

  /* ---- code <-> stack lane (draft-bound) ----
     The DRAFT is canonical RPN (with `eol` tokens). The code box SHOWS `eol` as a real line break
     and turns typed line breaks back into `eol`, which is how v1 presents multi-line expressions. */
  function loadDraft(str) {
    M.draft = String(str);
    M.syncing = true; M.codeEl.value = toDisplay(M.draft); M.syncing = false;
    M.tokens = E.tokenize(M.draft);
    renderLane();
  }
  function onCode() {
    if (M.syncing) return;
    M.draft = fromDisplay(M.codeEl.value);          // newlines -> eol
    M.tokens = E.tokenize(M.draft);
    snapshot(true);
    renderLane();
  }
  // `eol` IS the firmware's line break. v1 shows it as a newline; do the same in the code box, and
  // turn newlines back into `eol` tokens on the way in, so a multi-line expression survives.
  const toDisplay = (d) => String(d).replace(/\s*\beol\b\s*/g, "\n");
  const fromDisplay = (v) => String(v).replace(/\n+/g, " eol ").replace(/[ \t]+/g, " ").trim();

  function commitTokens(fromTyping) {
    M.draft = M.tokens.join(" ");
    M.syncing = true; M.codeEl.value = toDisplay(M.draft); M.syncing = false;
    snapshot(!!fromTyping);
    renderLane();
  }
  function commitInline(fromTyping) {
    // value / usage edits don't change the stack structure, so don't rebuild
    // the lane (keeps the field focused) — just refresh code, status & readback.
    M.draft = M.tokens.join(" ");
    M.syncing = true; M.codeEl.value = toDisplay(M.draft); M.syncing = false;
    snapshot(!!fromTyping);
    statusAndRead();
  }

  /* ---- palette append + copy ---- */
  function addFromPalette(it) {
    // A usage chip must NOT inject a hardcoded placeholder code (the mock shipped 0x00010030
    // "Mouse X" and 0x00090001 "Button 1" and left them there). Open the real key picker and
    // let the user choose, exactly like the Mappings tab does.
    if (it.pick && window.openPicker) {
      window.openPicker({
        mode: "input",
        current: null,
        onSelect: (code) => {
          M.tokens.push(code, it.op);
          commitTokens(false);
        },
      });
      return;
    }
    M.tokens.push.apply(M.tokens, it.ins);
    commitTokens(false);
  }
  function copyRpn() {
    const txt = M.draft || "";
    const done = () => { clear(M.copyBtn); M.copyBtn.appendChild(el("span", { html: EIC.check })); M.copyBtn.appendChild(document.createTextNode("Copied")); setTimeout(() => { clear(M.copyBtn); M.copyBtn.appendChild(el("span", { html: EIC.copy })); M.copyBtn.appendChild(document.createTextNode("Copy")); }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(() => { M.codeEl.select(); done(); });
    else { M.codeEl.select(); document.execCommand && document.execCommand("copy"); done(); }
  }
  function toastMsg(m) { if (window.HRX && window.HRX.toast) window.HRX.toast(m); }

  /* ---- stack analysis ---- */
  function analyze(tokens) {
    let depth = 0, underflow = false, unknown = false;
    const rows = tokens.map((t) => {
      if (E.isCommentTok(t)) return { t, depth, ok: true, comment: true };   // not an operation
      if (E.isNumTok(t)) { depth += 1; return { t, depth, ok: true }; }
      const op = E.OPS[t];
      if (!op) { unknown = true; return { t, depth, ok: false }; }
      if (depth < op.arity) { underflow = true; return { t, depth, ok: false }; }
      depth = depth - op.arity + op.out;
      return { t, depth, ok: true };
    });
    return { rows, depth, underflow, unknown };
  }

  /* ---- render the stack lane ---- */
  function renderLane() {
    clear(M.blocksEl);
    const lane = el(".stack-lane");
    if (!M.tokens.length) lane.appendChild(el(".lane-empty", null, "Empty — pick a template, or tap a block below to start building the stack."));
    const a = analyze(M.tokens);
    a.rows.forEach((r, i) => {
      const cell = el(".lane-cell", { draggable: "true" });
      cell.appendChild(tokenChip(r, i));
      const badge = el(".depth" + (r.ok ? "" : ".bad"), { title: r.ok ? "values on the stack after this step" : "not enough values" });
      badge.appendChild(el("span.dnum", null, r.ok ? String(r.depth) : "!"));
      cell.appendChild(badge);
      // drag to reorder (don't hijack edits inside inputs / selects)
      cell.addEventListener("dragstart", (e) => {
        if (e.target.closest("input,select")) { e.preventDefault(); return; }
        M.dragIdx = i; cell.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(i)); } catch (_) {}
      });
      cell.addEventListener("dragend", () => { cell.classList.remove("dragging"); lane.querySelectorAll(".lane-cell").forEach((c) => c.classList.remove("drag-over")); M.dragIdx = null; });
      cell.addEventListener("dragover", (e) => { if (M.dragIdx == null) return; e.preventDefault(); cell.classList.add("drag-over"); });
      cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
      cell.addEventListener("drop", (e) => { e.preventDefault(); const from = M.dragIdx; M.dragIdx = null; moveToken(from, i); });
      lane.appendChild(cell);
    });
    M.blocksEl.appendChild(lane);
    statusAndRead(a);
  }
  function statusAndRead(a) {
    a = a || analyze(M.tokens);
    let kind = "ok", msg = "Valid · one result on top";
    if (!M.tokens.length) { kind = "ok"; msg = "Empty"; }
    else if (a.unknown) { kind = "err"; msg = "Unknown operation"; }
    else if (a.underflow) { kind = "err"; msg = "Stack underflow — not enough values"; }
    else if (a.depth !== 1) { kind = "warn"; msg = "Leaves " + a.depth + " values on the stack"; }
    setSync(kind, msg, kind === "ok" && M.tokens.length > 0);
    M.codeEl.classList.toggle("bad", !!(M.tokens.length && (a.unknown || a.underflow || a.depth !== 1)));
    // block Apply unless the result is exactly one value (empty = clears the slot, allowed)
    const valid = !M.tokens.length || (!a.unknown && !a.underflow && a.depth === 1);
    if (M.applyBtn) { M.applyBtn.disabled = !valid; M.applyBtn.title = valid ? "" : "Expression must leave exactly one result"; }
    const res = E.parse(M.draft);
    setRead(res.ok && res.tree ? E.toEnglish(res.tree) : null);
  }

  /* ---- token chips ---- */
  function tokenChip(r, i) {
    const t = r.t;
    if (E.isHexTok(t)) {
      const chip = el(".tok.cat-usage" + (r.ok ? "" : ".bad"));
      const name = (window.HRX_USAGES && window.HRX_USAGES.usageName) ? window.HRX_USAGES.usageName(t) : E.usageLabel(t);
      const btn = el("button.tok-usage", { type: "button", title: t + " — click to pick any usage" }, [el("span.u-name", null, name), el("span.tok-chev", { html: EIC.chev })]);
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.openPicker) window.openPicker({ mode: "input", current: t, onSelect: (code) => { M.tokens[i] = code; commitTokens(false); } });
      });
      chip.appendChild(btn); chip.appendChild(tokX(i));
      return chip;
    }
    if (E.isNumTok(t)) {
      const chip = el(".tok.cat-num" + (r.ok ? "" : ".bad"));
      const inp = el("input.tok-num", { value: t, spellcheck: "false" });
      inp.addEventListener("input", () => { M.tokens[i] = inp.value.trim() || "0"; commitInline(true); });
      chip.appendChild(inp); chip.appendChild(tokX(i));
      return chip;
    }
    const op = E.OPS[t];
    const cat = op ? (op.special ? "stack" : op.cat) : "math";
    const chip = el(".tok.op.cat-" + cat + (r.ok ? "" : ".bad"), { title: op ? (OP_LABEL[t] || t) : "unknown" });
    chip.appendChild(el("span.tok-name", null, SYM[t] || t));
    chip.appendChild(tokX(i));
    return chip;
  }
  function tokX(i) {
    return el("button.tok-x", { title: "Delete", onclick: () => { M.tokens.splice(i, 1); commitTokens(false); } }, [el("span", { html: EIC.x })]);
  }
  function moveToken(from, to) {
    if (from == null || from === to || from < 0 || to < 0 || from >= M.tokens.length || to >= M.tokens.length) return;
    const [tk] = M.tokens.splice(from, 1);
    M.tokens.splice(to, 0, tk);
    commitTokens(false);
  }

  function setSync(kind, label, flash) {
    M.syncEl.className = "sync-ind " + kind + (flash ? " flash" : "");
    clear(M.syncEl);
    M.syncEl.appendChild(el("span", { html: kind === "ok" ? EIC.check : kind === "warn" ? EIC.alert : EIC.info }));
    M.syncEl.appendChild(document.createTextNode(label));
  }
  function setRead(text) {
    clear(M.readEl);
    if (!text) { M.readEl.style.display = "none"; return; }
    M.readEl.style.display = "block";
    M.readEl.appendChild(el(".rb-k", null, "Reads as"));
    M.readEl.appendChild(el(".rb-v", null, text));
  }

  window.renderExpressions = render;
})();
