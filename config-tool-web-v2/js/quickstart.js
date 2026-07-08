/* ============================================================
   HID Remapper VX — Quick Start tab
   ============================================================ */
(function () {
  const { APP, mk } = window.HRX_STATE;
  const { $, $$, toast } = window.HRX;

  const PRESETS = [
    { icon: ICON.check, color: "#7c5cff", title: "Fix OK Button", sub: "Menu Select → Return (Enter)", add: () => [mk("0x000c0041", "0x00070028", { tint: "nav" })] },
    { icon: ICON.mic, color: "#f06292", title: "Remap Voice Control", sub: "Mic button → AC Home", add: () => [mk("0x000c0221", "0x000c0223", { tint: "system" })] },
    { icon: ICON.volume, color: "#4dd0e1", title: "Volume → Mute Combo", sub: "Vol Up + Vol Down → Mute", add: () => [mk(["0x000c00e9", "0x000c00ea"], "0x000c00e2", { tint: "volume" })] },
    { icon: ICON.home, color: "#ffb74d", title: "Back = Home (hold)", sub: "Hold AC Back → AC Home", add: () => [mk("0x000c0224", "0x000c0223", { tint: "system", hold: true })] },
  ];

  const SHORTCUTS = {
    "Android TV": ["Home", "Back", "Menu", "Settings", "Apps", "Notifications", "Assistant", "Power"],
    Browser: ["New Tab", "Close Tab", "Refresh", "Bookmark", "History", "Find", "Back", "Forward"],
    Windows: ["Copy", "Paste", "Cut", "Undo", "Redo", "Task Manager", "Lock", "Screenshot"],
  };

  const EXAMPLES = [
    { cat: "Keyboard", color: "#5b8cff", icon: ICON.keyboard, title: "WASD → Arrows", desc: "Turn a gamepad or keyboard's WASD cluster into arrow-key navigation.", count: 4 },
    { cat: "Keyboard", color: "#5b8cff", icon: ICON.keyboard, title: "Vim Navigation", desc: "HJKL mapped to arrow keys with a hold-layer toggle.", count: 5 },
    { cat: "Mouse", color: "#4ade80", icon: ICON.mouse, title: "D-Pad → Mouse", desc: "Move the cursor with the remote's directional pad. Center clicks.", count: 5 },
    { cat: "Mouse", color: "#4ade80", icon: ICON.mouse, title: "Smooth Scroll", desc: "Channel up/down become smooth wheel scrolling with scaling.", count: 2 },
    { cat: "Macros", color: "#ffb74d", icon: ICON.macro, title: "Double-Tap Back → Home", desc: "Tap Back twice quickly to fire AC Home via a tap-hold macro.", count: 2 },
    { cat: "Macros", color: "#ffb74d", icon: ICON.macro, title: "Long-press Power Menu", desc: "Hold a key 600ms to open the power menu macro sequence.", count: 1 },
    { cat: "Windows", color: "#a78bff", icon: ICON.win, title: "Media Keys", desc: "Play/pause, next, prev and volume mapped to media usages.", count: 6 },
    { cat: "Windows", color: "#a78bff", icon: ICON.win, title: "Virtual Desktops", desc: "Win+Ctrl+←/→ to switch desktops from two remote buttons.", count: 2 },
  ];

  let activeCat = "All";

  window.renderQuickActions = function (container) {
    const presetCards = PRESETS.map((p, i) => `
      <button class="preset-card" data-preset="${i}">
        <div class="preset-icon" style="color:${p.color}">${p.icon}</div>
        <div><div class="pc-title">${p.title}</div><div class="pc-sub">${p.sub}</div></div>
      </button>`).join("");

    const shortcutSections = Object.entries(SHORTCUTS).map(([group, items]) => `
      <div style="margin-bottom:16px">
        <div class="section-tag" style="margin-bottom:9px;display:block">${group}</div>
        <div class="shortcut-grid">
          ${items.map((s) => `<button class="shortcut-btn" data-shortcut="${s}">${ICON.bolt}<span>${s}</span></button>`).join("")}
        </div>
      </div>`).join("");

    const cats = ["All", ...new Set(EXAMPLES.map((e) => e.cat))];
    const catPills = cats.map((c) => {
      const color = c === "All" ? "var(--purple-hi)" : (EXAMPLES.find((e) => e.cat === c).color);
      return `<button class="cat-pill ${activeCat === c ? "on" : ""}" style="--c:${color}" data-cat="${c}">${c}</button>`;
    }).join("");

    const exCards = EXAMPLES.filter((e) => activeCat === "All" || e.cat === activeCat).map((e, i) => `
      <div class="example-card" style="--c:${e.color}">
        <span class="ec-count">${e.count} maps</span>
        <div class="ec-top">
          <div class="ec-icon">${e.icon}</div>
          <div class="ec-title">${e.title}</div>
        </div>
        <div class="ec-desc">${e.desc}</div>
        <button class="ec-add" data-ex="${EXAMPLES.indexOf(e)}">${ICON.plus}<span>Add</span></button>
      </div>`).join("");

    container.innerHTML = `
    <div class="panel"><div class="panel-body">
      <div class="qa-section">
        <div class="qa-section-head"><h3>Preset fixes</h3><p>One click adds a known-good mapping to your config.</p></div>
        <div class="preset-grid">${presetCards}</div>
      </div>

      <div class="qa-section">
        <div class="qa-section-head"><h3>Shortcut grid</h3><p>Common actions, grouped by platform.</p></div>
        ${shortcutSections}
      </div>

      <div class="qa-section" style="margin-bottom:0">
        <div class="qa-section-head"><h3>Example configs</h3><p>Curated bundles — color-coded by category.</p></div>
        <div class="cat-pills">${catPills}</div>
        <div class="example-grid">${exCards}</div>
      </div>
    </div></div>`;

    wire(container);
  };

  function wire(root) {
    $$('[data-preset]', root).forEach((b) => b.addEventListener("click", () => {
      const p = PRESETS[+b.dataset.preset];
      APP.mappings.push(...p.add());
      toast(`Added: ${p.title}`);
    }));
    $$('[data-shortcut]', root).forEach((b) => b.addEventListener("click", () => {
      APP.mappings.push(mk("0x00000000", "0x00070028"));
      toast(`Shortcut “${b.dataset.shortcut}” added — set its input`);
    }));
    $$('[data-cat]', root).forEach((b) => b.addEventListener("click", () => { activeCat = b.dataset.cat; window.renderQuickActions($("#tabContent")); }));
    $$('[data-ex]', root).forEach((b) => b.addEventListener("click", () => {
      const e = EXAMPLES[+b.dataset.ex];
      for (let i = 0; i < e.count; i++) APP.mappings.push(mk("0x00000000", "0x00000000"));
      toast(`Added “${e.title}” (${e.count} mappings)`);
    }));
  }
})();
