/* MODAL tests — guard the CSS collision that made the usage picker impossible to close.

   There are three modals and they use two DIFFERENT conventions:
     * picker.js       keeps ONE scrim alive and toggles `.open`  -> it NEEDS a hidden default
     * expressions.js  creates a scrim and .remove()s it          -> must be visible immediately
     * settings-json.js  same as expressions

   They all used the class `.modal-scrim`. mappings.css hid it by default; expressions.css —
   loaded LATER — redefined it with `display: grid` and no hidden state. Same specificity, later
   file wins, so the picker's scrim was ALWAYS displayed: removing `.open` did nothing and neither
   the Close button nor picking a usage could dismiss it.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the picker uses its OWN scrim class, not the shared one", () => {
  const js = read("js/picker.js");
  assert.ok(js.includes('class="picker-scrim"'), "picker.js must build a .picker-scrim");
  assert.ok(!/class="modal-scrim"/.test(js),
    "the picker must NOT reuse .modal-scrim — expressions.css overrides it and it can never hide");
});

test("the picker scrim is hidden by default and shown only with .open", () => {
  const css = read("css/mappings.css");
  const base = css.match(/\.picker-scrim\s*\{[^}]*\}/);
  assert.ok(base, ".picker-scrim must be styled");
  assert.ok(/display:\s*none/.test(base[0]), ".picker-scrim must default to display:none");
  assert.ok(/\.picker-scrim\.open\s*\{[^}]*display:\s*flex/.test(css),
    ".picker-scrim.open must display it");
});

test("no other stylesheet can override the picker's hidden state", () => {
  // any file loaded after mappings.css must not style .picker-scrim's display
  for (const f of ["css/expressions.css", "css/settings.css", "css/app.css"]) {
    const css = read(f);
    const hit = css.match(/\.picker-scrim[^{]*\{[^}]*display[^}]*\}/);
    assert.strictEqual(hit, null,
      `${f} sets display on .picker-scrim — that is exactly the bug that broke Close`);
  }
});

test("the picker sits ABOVE the expression modal (it can be opened from inside it)", () => {
  const zOf = (css, sel) => {
    const m = css.match(new RegExp(sel.replace(".", "\\.") + "\\s*\\{[^}]*z-index:\\s*(\\d+)"));
    return m ? Number(m[1]) : null;
  };
  const pickerZ = zOf(read("css/mappings.css"), ".picker-scrim");
  const modalZ = zOf(read("css/expressions.css"), ".modal-scrim");
  assert.ok(pickerZ !== null && modalZ !== null, "both z-indexes must be declared");
  assert.ok(pickerZ > modalZ,
    `the picker (z=${pickerZ}) must stack above the expression modal (z=${modalZ}), or picking a key from an expression is invisible`);
});

test("close() clears the picker so stale listeners cannot fire", () => {
  const js = read("js/picker.js");
  const close = js.match(/function close\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(close, "close() must exist");
  assert.ok(/classList\.remove\("open"\)/.test(close[0]), "close() must remove .open");
  assert.ok(/innerHTML\s*=\s*""/.test(close[0]), "close() must drop the old list and its listeners");
});

test("the monitor's + button takes the user to the mapping it creates", () => {
  const js = read("js/tabs.js");
  const i = js.indexOf("data-mkmap]");
  assert.ok(i > -1, "the data-mkmap handler must exist");
  // the handler lives in mapThis(), bound ONCE to a stable <tr> (a live redraw must not
  // destroy the button mid-click — see monitor.test.js)
  const j = js.indexOf("function mapThis");
  assert.ok(j > -1, "the + handler must be a named function bound to a stable row");
  const handler = js.slice(j, j + 700);
  assert.ok(/setTab\("mappings"\)/.test(handler),
    'clicking + must switch to the Mappings tab — otherwise nothing visible happens and the button looks dead');
  assert.ok(/HRX_STATE\.mk\(r\.usage/.test(handler), "and it must create the mapping for that usage");
  assert.ok(/HRX_STATE\.mk\(/.test(handler), "it must actually create a mapping");
});
