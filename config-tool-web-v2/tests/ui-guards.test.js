/* Guards for two bugs that made the tool look broken but were invisible to logic tests.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/* ---- 1. Bootstrap made EVERY toast invisible ----
   Bootstrap ships `.toast:not(.show){display:none}` (specificity 0-2-0), which beats our own
   `.toast{display:flex}` (0-1-0) no matter the load order — and core.js never adds `.show`.
   Toasts are the tool's only feedback channel, so failed saves and errors passed silently.
   Bootstrap was never actually used (no Bootstrap JS call, no Bootstrap class), so it is gone. */

test("Bootstrap is not loaded — it silently hid every toast", () => {
  const html = read("index.html");
  assert.ok(!/bootstrap/i.test(html.replace(/<!--[\s\S]*?-->/g, "")),
    "index.html must not load Bootstrap: its .toast:not(.show) rule hides every toast we show");
});

test("no source file depends on Bootstrap", () => {
  for (const f of fs.readdirSync(path.join(__dirname, "..", "js"))) {
    if (!f.endsWith(".js")) continue;
    const src = read("js/" + f);
    assert.ok(!/data-bs-|bootstrap\.|new bootstrap/i.test(src),
      `js/${f} uses a Bootstrap API — removing Bootstrap would break it`);
  }
});

test("our toast has a display rule of its own", () => {
  const css = read("css/mappings.css") + read("css/app.css");
  assert.ok(/\.toast\s*\{[^}]*display\s*:/.test(css), ".toast must declare its own display");
});

/* ---- 2. Two blank rows merged into one group ----
   Rows are grouped by their first input so one button can fork into several behaviours, and the
   trunk's picker rewires the WHOLE group. Every not-yet-configured row shares the placeholder
   0x00000000, so adding two blank mappings and then picking an input for one silently set BOTH. */

test("unset rows are never grouped together", () => {
  const src = read("js/mappings.js");
  const fn = src.slice(src.indexOf("function groupByFirstInput"), src.indexOf("function branchHtml"));
  assert.ok(/unset-/.test(fn),
    "groupByFirstInput must give each unset row its own group key, or two blank rows merge");
  assert.ok(/m\.id/.test(fn), "the unset key must be per-row (use the row id)");
});

test("the trunk picker rewires only the rows it owns", () => {
  const src = read("js/mappings.js");
  const i = src.indexOf("data-pickgroup]");
  const handler = src.slice(i, i + 900);
  assert.ok(/dataset\.mids/.test(handler),
    "the picker must target the trunk's own row ids (data-mids), not every row sharing a usage code");
  assert.ok(!/m\.inputs\[0\] === oldCode/.test(handler),
    "matching by usage code also hits every OTHER row with that code — including all blank rows");
  assert.ok(/data-mids="\$\{mids\}"/.test(src) || /data-mids="/.test(src),
    "the trunk button must carry its member ids");
});
