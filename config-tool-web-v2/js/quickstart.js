/* ============================================================
   HID Remapper VX — Quick Start tab

   Every card here creates a REAL mapping. The design mock also shipped a
   "Shortcut grid" and an "Example configs" gallery; both were fake — the
   shortcut buttons added the same nothing->Enter mapping whatever you
   clicked, and each "example" pushed N BLANK mappings while the toast
   claimed it had added a working config. They are gone.
   ============================================================ */
(function () {
  const { APP, mk } = window.HRX_STATE;
  const { $, $$, toast } = window.HRX;

  // Each preset builds real mappings from real usages. `add()` returns the rows to append.
  const PRESETS = [
    {
      icon: ICON.check, color: "#7c5cff",
      title: "Fix the OK button",
      sub: "Menu Select → Return (Enter)",
      add: () => [mk("0x000c0041", "0x00070028", { tint: "nav" })],
    },
    {
      icon: ICON.mic, color: "#f06292",
      title: "Remap voice control",
      sub: "Mic button → AC Home",
      add: () => [mk("0x000c0221", "0x000c0223", { tint: "system" })],
    },
    {
      icon: ICON.volume, color: "#4dd0e1",
      title: "Volume combo → Mute",
      sub: "Vol Up + Vol Down held together → Mute",
      add: () => [mk(["0x000c00e9", "0x000c00ea"], "0x000c00e2", { tint: "volume" })],
    },
    {
      icon: ICON.home, color: "#ffb74d",
      title: "Hold Back for Home",
      sub: "Hold AC Back → AC Home",
      add: () => [mk("0x000c0224", "0x000c0223", { tint: "system", hold: true })],
    },
    {
      icon: ICON.keyboard, color: "#5b8cff",
      title: "D-pad → arrow keys",
      sub: "Up / Down / Left / Right → keyboard arrows",
      add: () => [
        mk("0x00070052", "0x00070052", { tint: "nav" }),
        mk("0x00070051", "0x00070051", { tint: "nav" }),
        mk("0x00070050", "0x00070050", { tint: "nav" }),
        mk("0x0007004f", "0x0007004f", { tint: "nav" }),
      ],
    },
    {
      icon: ICON.macro, color: "#81c784",
      title: "Play/pause on tap",
      sub: "Play/Pause fires only on a quick tap",
      add: () => [mk("0x000c00cd", "0x000c00cd", { tint: "media", tap: true })],
    },
  ];

  window.renderQuickActions = function (container) {
    const presetCards = PRESETS.map((p, i) => `
      <button class="preset-card" data-preset="${i}">
        <div class="preset-icon" style="color:${p.color}">${p.icon}</div>
        <div><div class="pc-title">${p.title}</div><div class="pc-sub">${p.sub}</div></div>
      </button>`).join("");

    container.innerHTML = `
    <div class="panel"><div class="panel-body">
      <div class="qa-section" style="margin-bottom:0">
        <div class="qa-section-head">
          <h3>Preset fixes</h3>
          <p>One click appends a real, working mapping to your config. Nothing is written to the
             device until you press <b>Save to device</b>.</p>
        </div>
        <div class="preset-grid">${presetCards}</div>
      </div>
    </div></div>`;

    $$('[data-preset]', container).forEach((b) => b.addEventListener("click", () => {
      const p = PRESETS[+b.dataset.preset];
      const rows = p.add();
      APP.mappings.push(...rows);
      toast(`Added: ${p.title} (${rows.length} mapping${rows.length === 1 ? "" : "s"})`);
    }));
  };
})();
