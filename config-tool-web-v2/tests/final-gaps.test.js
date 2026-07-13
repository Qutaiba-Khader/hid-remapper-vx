/* The last five v1 gaps: profile-aware targets, sort-by-column, back-to-top, multi-line
   expressions (eol), and comments surviving a palette edit.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const v1usages = require("../js/usages-v1.js");
const T = require("../js/translate.js");

/* ---- 1. the OUTPUT list follows the emulated profile ---- */

test("v1's per-profile usage tables are ported for all 9 profiles", () => {
  for (let p = 0; p <= 8; p++) {
    assert.ok(v1usages[p], "profile " + p + " must have a target table");
    assert.ok(Object.keys(v1usages[p]).length > 50, "profile " + p + " must be populated");
  }
  // and the whole point: a Switch cannot send what a mouse can
  assert.ok(Object.keys(v1usages[0]).length > Object.keys(v1usages[2]).length,
    "Mouse+Keyboard must expose more targets than Nintendo Switch");
});

test("usages-v1.js is a classic script, not an ES module", () => {
  const src = read("js/usages-v1.js");
  assert.ok(!/^\s*export\s/m.test(src),
    "v1's usages.js ends with `export default usages;` — an `export` in a classic script is a " +
    "SyntaxError that would kill the file and silently empty the picker");
  assert.ok(/window\.HRX_V1_USAGES\s*=/.test(src));
});

test("the picker filters OUTPUTS by the emulated profile, and relabels them", () => {
  const p = read("js/picker.js");
  assert.ok(/function profileTargets/.test(p), "there must be a profile filter");
  assert.ok(/state\.mode !== "output"/.test(p), "it must apply to the target list only");
  assert.ok(/HRX_V1_USAGES/.test(p), "using v1's per-profile tables");
  assert.ok(/settings\.emulatedDevice/.test(p), "keyed by the selected profile");
  assert.ok(/prof\.name\(code\) \|\| name/.test(p),
    "the profile's own name must win — 0x00090001 is 'Left button' on a mouse, 'Button 1' on a gamepad");
  assert.ok(/ALWAYS_TARGETABLE/.test(p),
    "the firmware's own target pages (layers/macros/GPIO/registers/digipot/dpad/LED) must stay " +
    "available on every profile");
});

test("expressions (0xFFF3) are a SOURCE only, never offered as an output", () => {
  const p = read("js/picker.js");
  const always = p.match(/ALWAYS_TARGETABLE\s*=\s*\[([^\]]+)\]/)[1];
  assert.ok(!always.includes("0xfff3"),
    "you read an expression, you never write to one — offering it as a target is a mapping that " +
    "silently does nothing");
  for (const page of ["0xfff1", "0xfff2", "0xfff4", "0xfff9", "0xfffa"]) {
    assert.ok(always.includes(page), page + " must remain targetable on every profile");
  }
});

/* ---- 2. sort by column ---- */

test("the mapping columns are click-to-sort", () => {
  const m = read("js/mappings.js");
  assert.ok(/data-sort="input"/.test(m) && /data-sort="output"/.test(m) && /data-sort="layers"/.test(m),
    "input, output and layers must all be sortable");
  assert.ok(/APP\.sortDir = -APP\.sortDir/.test(m), "clicking the same column again must reverse it");
  assert.ok(/APP\.mappings\.sort\(/.test(m), "and it must actually reorder the mappings");

  const s = read("js/state.js");
  assert.ok(/sortKey: null/.test(s) && /sortDir: 1/.test(s), "the sort state must live in APP");
});

/* ---- 3. back to top ---- */

test("there is a back-to-top button", () => {
  const a = read("js/app.js");
  assert.ok(/function mountBackToTop/.test(a));
  assert.ok(/scrollTo\(\{ top: 0/.test(a), "it must scroll to the top");
  assert.ok(/window\.scrollY > \d+/.test(a), "and only appear once you have scrolled");
  assert.ok(/\.back-to-top/.test(read("css/app.css")), "and be styled");
});

/* ---- 4. multi-line expressions: eol <-> newline ---- */

test("the code box shows `eol` as a line break and turns line breaks back into `eol`", () => {
  const e = read("js/expressions.js");
  assert.ok(/const toDisplay/.test(e) && /const fromDisplay/.test(e));
  assert.ok(/M\.draft = fromDisplay\(M\.codeEl\.value\)/.test(e),
    "typing a newline must become an `eol` token");
  assert.ok(/M\.codeEl\.value = toDisplay\(M\.draft\)/.test(e),
    "and an `eol` token must display as a newline");
});

test("the eol transform round-trips exactly", () => {
  const toDisplay = (d) => String(d).replace(/\s*\beol\b\s*/g, "\n");
  const fromDisplay = (v) => String(v).replace(/\n+/g, " eol ").replace(/[ \t]+/g, " ").trim();
  const draft = "1 recall eol 2 recall eol mul";
  assert.strictEqual(toDisplay(draft), "1 recall\n2 recall\nmul");
  assert.strictEqual(fromDisplay(toDisplay(draft)), draft, "a multi-line expression must survive");
});

/* ---- 5. comments survive ---- */

test("a /* comment */ is a token, so a palette edit cannot delete it", () => {
  const eng = read("js/expr-engine.js");
  assert.ok(/function isCommentTok/.test(eng), "comments must be recognised as tokens");
  assert.ok(/\/\\\*\[\\s\\S\]\*\?\\\*\\\/\|\\S\+/.test(eng) || /match\(\/\\\/\\\*/.test(eng) ||
            eng.includes('match(/\\/\\*[\\s\\S]*?\\*\\/|\\S+/g)'),
    "tokenize must keep comment blocks whole");
  assert.ok(/if \(isCommentTok\(tok\)\) continue;/.test(eng), "parse must skip them");

  const exprs = read("js/expressions.js");
  assert.ok(/E\.isCommentTok\(t\)/.test(exprs), "analyze must treat a comment as no-op");
});

test("a number INSIDE a comment is never rescaled", () => {
  // "/* speed 0.5 */" must survive untouched; the real 0.05 must become 50
  const withComment = "/* speed 0.5 */ 0x00010030 input_state 0.05 mul";
  const dev = T.exprToDevice(withComment);
  assert.ok(dev.includes("/* speed 0.5 */"),
    "the comment must be untouched — rescaling inside it would rewrite the user's text: " + dev);
  assert.ok(dev.includes("50 mul"), "but the real constant must be scaled: " + dev);

  const back = T.exprToApp(dev);
  assert.ok(back.includes("/* speed 0.5 */"), "and still untouched coming back");
  assert.ok(back.includes("0.05 mul"), "with the constant restored: " + back);
});

test("device.js still strips comments on the way to the wire", () => {
  const D = require("../js/device.js");
  const elems = D.exprToElems("/* a note */ 0x00010030 input_state 50 mul");
  // PUSH_USAGE, INPUT_STATE, PUSH, MUL — the comment must not become an opcode
  assert.strictEqual(elems.length, 4, "the comment must not reach the device: " + JSON.stringify(elems));
});
