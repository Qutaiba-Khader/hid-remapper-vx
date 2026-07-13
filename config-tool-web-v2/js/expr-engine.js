/* ============================================================
   HID Remapper VX — Shared RPN Expression Engine
   Used by all 4 design options. Pure vanilla JS, no deps.

   Pipeline:
     RPN string  --tokenize-->  tokens
     tokens      --parse------>  expression tree   (functional subset)
     tree        --serialize-->  RPN string         (round-trips exactly)
     tree        --toEnglish-->  plain-language readback

   Stack-trick expressions (dup/swap/store/port/deadzone/dpad/monitor,
   or anything that doesn't reduce to a single result) parse to
   { ok:false, reason }, which the visual panes treat as "code-only".
   ============================================================ */
(function () {
  /* ---- operation metadata ---------------------------------- */
  // arity = values consumed; out = values produced; special = not a clean tree node.
  const OPS = {
    // input fetches (1 -> 1) — the child is a usage code
    input_state:           { arity: 1, out: 1, cat: "input", fetch: true, label: "value of" },
    input_state_binary:    { arity: 1, out: 1, cat: "input", fetch: true, label: "is pressed" },
    input_state_scaled:    { arity: 1, out: 1, cat: "input", fetch: true, label: "value (0-255)" },
    prev_input_state:      { arity: 1, out: 1, cat: "input", fetch: true, label: "previous value of" },
    prev_input_state_binary:{ arity: 1, out: 1, cat: "input", fetch: true, label: "was pressed" },
    prev_input_state_scaled:{ arity: 1, out: 1, cat: "input", fetch: true, label: "previous value (0-255)" },
    // arithmetic (2 -> 1)
    add: { arity: 2, out: 1, cat: "math", infix: "+", commutative: true },
    sub: { arity: 2, out: 1, cat: "math", infix: "\u2212" },
    mul: { arity: 2, out: 1, cat: "math", infix: "\u00d7", commutative: true },
    div: { arity: 2, out: 1, cat: "math", infix: "\u00f7" },
    mod: { arity: 2, out: 1, cat: "math", word: "mod" },
    min: { arity: 2, out: 1, cat: "math", fn: "min", commutative: true },
    max: { arity: 2, out: 1, cat: "math", fn: "max", commutative: true },
    // comparison (2 -> 1)
    eq:  { arity: 2, out: 1, cat: "compare", infix: "=", commutative: true },
    gt:  { arity: 2, out: 1, cat: "compare", infix: ">" },
    lt:  { arity: 2, out: 1, cat: "compare", infix: "<" },
    // unary (1 -> 1)
    not:  { arity: 1, out: 1, cat: "logic", pre: "not " },
    abs:  { arity: 1, out: 1, cat: "math", fn: "abs" },
    sign: { arity: 1, out: 1, cat: "math", fn: "sign" },
    sqrt: { arity: 1, out: 1, cat: "math", fn: "\u221a" },
    round:{ arity: 1, out: 1, cat: "math", fn: "round" },
    relu: { arity: 1, out: 1, cat: "math", fn: "relu" },
    sin:  { arity: 1, out: 1, cat: "trig", fn: "sin" },
    cos:  { arity: 1, out: 1, cat: "trig", fn: "cos" },
    atan2:{ arity: 2, out: 1, cat: "trig", fn: "atan2" },
    bitwise_or:  { arity: 2, out: 1, cat: "bitwise", infix: "|", commutative: true },
    bitwise_and: { arity: 2, out: 1, cat: "bitwise", infix: "&", commutative: true },
    bitwise_not: { arity: 1, out: 1, cat: "bitwise", pre: "~" },
    // ternary (3 -> 1)
    clamp:{ arity: 3, out: 1, cat: "math", fn: "clamp" },
    ifte: { arity: 3, out: 1, cat: "logic", ternary: "ifte" },
    // memory / time
    recall:     { arity: 1, out: 1, cat: "memory", fn: "register" },
    time:       { arity: 0, out: 1, cat: "time", word: "time" },
    time_sec:   { arity: 0, out: 1, cat: "time", word: "time(s)" },
    layer_state:{ arity: 0, out: 1, cat: "state", word: "active layers" },
    plugged_in: { arity: 0, out: 1, cat: "state", word: "plugged-in" },
    sticky_state:{ arity: 1, out: 1, cat: "state", fn: "sticky" },
    tap_state:  { arity: 1, out: 1, cat: "state", fn: "tap" },
    hold_state: { arity: 1, out: 1, cat: "state", fn: "hold" },
    // stack tricks & side-effecting ops — valid RPN, but NOT clean tree nodes
    dup:  { arity: 1, out: 2, special: true, cat: "stack" },
    swap: { arity: 2, out: 2, special: true, cat: "stack" },
    store:{ arity: 2, out: 0, special: true, cat: "memory" },
    port: { arity: 1, out: 0, special: true, cat: "advanced" },
    monitor: { arity: 2, out: 0, special: true, cat: "advanced" },
    deadzone: { arity: 3, out: 2, special: true, cat: "advanced" },

    /* The remaining firmware ops. They were missing entirely, which made `analyze()` flag any
       expression using them as "Unknown operation" and DISABLE Apply — so an expression already on
       the device could not be edited at all. Arities are taken from the firmware's own stack
       validator (remapper.cc validate_expressions): debug/eol change nothing; auto_repeat and
       scaling push one value; the fp32 fetches take one and return one; print_if consumes two. */
    auto_repeat:            { arity: 0, out: 1, cat: "state", word: "auto-repeat" },
    scaling:                { arity: 0, out: 1, cat: "state", word: "scaling" },
    input_state_fp32:       { arity: 1, out: 1, cat: "input", fetch: true, label: "value (fp32)" },
    prev_input_state_fp32:  { arity: 1, out: 1, cat: "input", fetch: true, label: "previous value (fp32)" },
    debug:                  { arity: 0, out: 0, special: true, cat: "advanced" },
    eol:                    { arity: 0, out: 0, special: true, cat: "advanced" },
    print_if:               { arity: 2, out: 0, special: true, cat: "advanced" },
    deadzone2:{ arity: 4, out: 2, special: true, cat: "advanced" },
    dpad: { arity: 4, out: 1, special: true, cat: "advanced" },
  };

  /* friendly names for common usage codes */
  const USAGE_NAMES = {
    "0x00010030": "Left Stick X", "0x00010031": "Left Stick Y",
    "0x00010033": "Right Stick X", "0x00010034": "Right Stick Y",
    "0x00010032": "Z Axis", "0x00010035": "Rz Axis",
    "0x00010036": "Throttle", "0x00010039": "D-Pad / Hat",
    "0x00090001": "Button 1", "0x00090002": "Button 2", "0x00090003": "Button 3",
    "0x000c00e9": "Volume Up", "0x000c00ea": "Volume Down", "0x000c00e2": "Mute",
    "0x00070052": "Cursor Up", "0x00070051": "Cursor Down",
    "0x00070050": "Cursor Left", "0x0007004f": "Cursor Right",
    "0x000c0041": "Menu Select", "0x000c0224": "AC Back",
  };
  // inputs offered in dropdowns / pickers
  const INPUT_CHOICES = [
    "0x00010030", "0x00010031", "0x00010033", "0x00010034",
    "0x00010036", "0x00010039", "0x00090001", "0x00090002",
    "0x000c00e9", "0x000c00ea",
  ].map((c) => ({ code: c, label: USAGE_NAMES[c] || c }));

  function usageLabel(v) {
    const k = String(v).toLowerCase();
    return USAGE_NAMES[k] || v;
  }

  /* ---- tokenize -------------------------------------------- */
  function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, " "); }
  /* A /* comment *​/ is kept as a TOKEN of its own. It used to be stripped here, which meant any
     edit through the block palette silently deleted the user's comments (the lane rebuilds the
     expression from its tokens). device.js strips comments again on the way to the device, so
     keeping them costs nothing on the wire. */
  const COMMENT_RE = /^\/\*[\s\S]*\*\/$/;
  function isCommentTok(t) { return COMMENT_RE.test(t); }
  function tokenize(s) {
    return (String(s).match(/\/\*[\s\S]*?\*\/|\S+/g) || []).filter(Boolean);
  }
  const NUM_RE = /^-?(?:0x[0-9a-fA-F]+|\d+\.?\d*|\.\d+)$/;
  function isNumTok(t) { return NUM_RE.test(t); }
  function isHexTok(t) { return /^-?0x[0-9a-fA-F]+$/.test(t); }

  /* ---- parse: RPN tokens -> expression tree ---------------- */
  // node kinds: {t:'num',v} | {t:'usage',v} | {t:'op',name,args:[...]}
  function parse(input) {
    const toks = Array.isArray(input) ? input : tokenize(input);
    if (!toks.length) return { ok: true, tree: null, empty: true };
    const stack = [];
    for (const tok of toks) {
      if (isCommentTok(tok)) continue;            // a comment is not an operation
      if (isNumTok(tok)) {
        stack.push(isHexTok(tok) ? { t: "usage", v: tok } : { t: "num", v: tok });
        continue;
      }
      const op = OPS[tok];
      if (!op) return { ok: false, reason: `Unknown operation \u201c${tok}\u201d` };
      if (op.special || op.out !== 1)
        return { ok: false, reason: `Uses the stack operation \u201c${tok}\u201d` };
      if (stack.length < op.arity)
        return { ok: false, reason: `Not enough values for \u201c${tok}\u201d` };
      const args = stack.splice(stack.length - op.arity, op.arity);
      stack.push({ t: "op", name: tok, args });
    }
    if (stack.length !== 1)
      return { ok: false, reason: `Expression leaves ${stack.length} values on the stack` };
    return { ok: true, tree: stack[0] };
  }

  /* ---- serialize: tree -> RPN string ----------------------- */
  function serialize(node) {
    if (!node) return "";
    if (node.t === "num" || node.t === "usage") return node.v;
    return node.args.map(serialize).join(" ") + " " + node.name;
  }

  /* ---- toEnglish: tree -> plain language ------------------- */
  function toEnglish(node) {
    if (!node) return "(empty)";
    if (node.t === "num") return node.v;
    if (node.t === "usage") return usageLabel(node.v);
    const op = OPS[node.name];
    const a = node.args.map(toEnglish);
    if (op.fetch) {
      const nm = usageLabel(node.args[0].v);
      if (node.name.includes("binary")) return `${nm} pressed`;
      if (node.name.includes("prev")) return `previous ${nm}`;
      return nm;
    }
    if (op.infix) return `(${a[0]} ${op.infix} ${a[1]})`;
    if (op.word) return op.word;
    if (op.pre) return `${op.pre}${a[0]}`;
    if (op.ternary) return `if ${a[0]} then ${a[1]} else ${a[2]}`;
    if (op.fn === "register") return `register ${a[0]}`;
    if (op.fn) return `${op.fn}(${a.join(", ")})`;
    return `${node.name}(${a.join(", ")})`;
  }

  /* ---- pipeline view (Option B): tree <-> linear steps ----- */
  // A pipeline is a left-spine of unary ops and binary ops whose
  // right operand is a simple leaf. start -> step -> step -> result.
  function isLeaf(n) {
    if (!n) return false;
    if (n.t === "num" || n.t === "usage") return true;
    const op = OPS[n.name];
    if (!op) return false;
    if (op.fetch) return true;            // input fetch counts as a leaf
    if (op.arity === 0) return true;      // time / layer_state
    if (op.fn === "register") return true; // recall
    return false;
  }
  function toPipeline(tree) {
    if (!tree) return { ok: true, steps: [] };
    const steps = [];
    let cur = tree;
    let guard = 0;
    while (guard++ < 64) {
      if (isLeaf(cur)) { steps.push({ kind: "start", node: cur }); break; }
      if (cur.t !== "op") return { ok: false };
      const op = OPS[cur.name];
      if (op.special) return { ok: false };
      if (op.arity === 1) { steps.push({ kind: "unary", name: cur.name }); cur = cur.args[0]; continue; }
      if (op.arity === 2) {
        const [x, y] = cur.args;
        if (isLeaf(y)) { steps.push({ kind: "binary", name: cur.name, operand: y }); cur = x; continue; }
        if (op.commutative && isLeaf(x)) { steps.push({ kind: "binary", name: cur.name, operand: x }); cur = y; continue; }
        return { ok: false };
      }
      return { ok: false }; // ternary not expressible as a simple chain
    }
    steps.reverse();
    return { ok: true, steps };
  }
  function fromPipeline(steps) {
    if (!steps.length) return null;
    let node = steps[0].node;
    for (let i = 1; i < steps.length; i++) {
      const s = steps[i];
      if (s.kind === "unary") node = { t: "op", name: s.name, args: [node] };
      else node = { t: "op", name: s.name, args: [node, s.operand] };
    }
    return node;
  }

  /* ---- node constructors (used by builders) ---------------- */
  const mkNum = (v) => ({ t: "num", v: String(v) });
  const mkUsage = (v) => ({ t: "usage", v });
  const mkOp = (name, args) => ({ t: "op", name, args });
  const mkInput = (usage, fetch) => mkOp(fetch || "input_state", [mkUsage(usage)]);


  window.HRX_EXPR = {
    OPS, USAGE_NAMES, INPUT_CHOICES, usageLabel,
    tokenize, isNumTok, isHexTok, isCommentTok, parse, serialize, toEnglish,
    isLeaf, toPipeline, fromPipeline,
    mkNum, mkUsage, mkOp, mkInput,
  };
})();
