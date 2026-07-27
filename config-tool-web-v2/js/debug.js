/* Diagnostic logging. OFF unless the URL carries ?debug=1, so it costs nothing normally.
 *
 * Why this exists: the bugs in this tool are never visible in the UI. A stale GitHub Pages
 * build looks identical to a fresh one, a mapping filtered on load looks identical to one the
 * device never had, and a usage the firmware reports oddly looks like a tool bug. Every one of
 * those cost a round trip of screenshots. This prints the RAW data at each boundary so the
 * answer is in one paste.
 *
 * Use:  <tool url>?debug=1     then in the console:  HRX_DEBUG.dump()
 * The dump is also copied to the clipboard when you call HRX_DEBUG.copy().
 */
(function () {
  "use strict";

  const ON = /[?&]debug=1\b/.test(location.search);
  const buf = [];
  const t0 = Date.now();

  function rec(tag, data) {
    const line = { t: Date.now() - t0, tag, data };
    buf.push(line);
    if (buf.length > 2000) buf.shift();          // bounded: the monitor can be chatty
    // eslint-disable-next-line no-console
    console.log("[hrx " + String(line.t).padStart(6) + "ms] " + tag, data);
  }

  // A device mapping in one short line: what actually sits in flash.
  const mapLine = (m) =>
    `${m.source_usage} -> ${m.target_usage}  scaling=${m.scaling}` +
    `  layers=[${(m.layers || []).join(",")}]` +
    `${m.sticky ? " sticky" : ""}${m.tap ? " tap" : ""}${m.hold ? " hold" : ""}`;

  const API = {
    on: ON,
    log: (tag, data) => { if (ON) rec(tag, data); },
    entries: () => buf.slice(),
    dump() {
      const out = [
        "=== hid-remapper-vx v2 debug ===",
        "url:   " + location.href,
        "build: " + (document.querySelector('script[src*="?v="]') || {}).src,
        "ua:    " + navigator.userAgent,
        "modules: " + ["HRX_DEVICE", "HRX_TRANSLATE", "HRX_IR", "HRX_USAGES", "HRX_STATE"]
          .map((k) => k + "=" + (window[k] ? "ok" : "MISSING")).join(" "),
        "",
      ];
      buf.forEach((l) => {
        out.push("[" + l.t + "ms] " + l.tag);
        if (l.data !== undefined) {
          out.push("    " + (typeof l.data === "string" ? l.data : JSON.stringify(l.data)));
        }
      });
      const s = out.join("\n");
      // eslint-disable-next-line no-console
      console.log(s);
      return s;
    },
    async copy() {
      try { await navigator.clipboard.writeText(API.dump()); return "copied"; }
      catch (e) { return "clipboard blocked - select the console output instead"; }
    },
  };
  window.HRX_DEBUG = API;
  if (!ON) return;

  rec("boot", { href: location.href });

  /* Wrap the boundaries that have actually produced bugs. Done on a timer so every module has
     registered itself first; wrapping is idempotent-safe because we only do it once. */
  window.addEventListener("load", () => setTimeout(() => {
    const D = window.HRX_DEVICE;
    const T = window.HRX_TRANSLATE;

    rec("modules", {
      HRX_DEVICE: !!D, HRX_TRANSLATE: !!T, HRX_IR: !!window.HRX_IR,
      HRX_USAGES: !!window.HRX_USAGES,
      // The single most common false alarm: an old cached build with no IR support at all.
      irAware: !!(T && T.IR_PIN_USAGE),
    });
    if (T && !T.IR_PIN_USAGE) {
      rec("STALE BUILD", "translate.js has no IR_PIN_USAGE -- this page is a cached pre-IR " +
        "build. Hard-refresh (Ctrl+Shift+R). Every IR symptom below is a consequence of this.");
    }

    if (D && D.loadFromDevice) {
      const orig = D.loadFromDevice.bind(D);
      D.loadFromDevice = async function (...a) {
        const cfg = await orig(...a);
        rec("loadFromDevice: RAW device mappings", (cfg && cfg.mappings || []).map(mapLine));
        rec("loadFromDevice: counts", {
          mappings: (cfg && cfg.mappings || []).length,
          macros: (cfg && cfg.macros || []).filter((m) => m && m.length).length,
          quirks: (cfg && cfg.quirks || []).length,
          version: cfg && cfg.version,
        });
        return cfg;
      };
    }

    if (D && D.saveToDevice) {
      const orig = D.saveToDevice.bind(D);
      D.saveToDevice = async function (cfg, ...a) {
        rec("saveToDevice: payload", (cfg && cfg.mappings || []).map(mapLine));
        const res = await orig(cfg, ...a);
        rec("saveToDevice: result", res);
        return res;
      };
    }

    if (T && T.configToApp) {
      const orig = T.configToApp;
      T.configToApp = function (cfg, ...a) {
        const out = orig.call(T, cfg, ...a);
        rec("configToApp", {
          deviceMappings: (cfg && cfg.mappings || []).length,
          appRows: (out && out.mappings || []).length,
          filtered: (cfg && cfg.mappings || []).length - (out && out.mappings || []).length,
          irOutputPin: out && out.settings && out.settings.irOutputPin,
        });
        return out;
      };
    }
  }, 0));

  /* The Monitor, aggregated. One line per usage on demand rather than a flood: the raw stream
     is thousands of records and the useful question is always "what did each usage DO". */
  API.mon = () => {
    const rows = (window.HRX_MON_LIVE && window.HRX_MON_LIVE()) || [];
    const stuck = window.HRX_MON_STUCK || new Set();
    return rows.map((r) =>
      `${r.usage} ${r.name || ""} port=${r.hub_port} last=${r.last} min=${r.min} max=${r.max}` +
      ` seen=${r.seen}${stuck.has(r.usage) ? "  [FLAGGED not-a-button]" : ""}`);
  };
})();
