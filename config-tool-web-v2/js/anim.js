/* ============================================================
   HID Remapper VX — FLIP animation helper
   Smoothly animates layout changes: reorders, add/remove, resize.
   Usage: const snap = flipCapture(root); ...mutate+rerender...; flipPlay(newRoot, snap);
   ============================================================ */
(function () {
  const SEL = ".map-row[data-mid], .wg-branch[data-mid], .wire-group[data-groupkey]";
  const DUR = 280;
  const EASE = "cubic-bezier(.2,.75,.2,1)";

  function keyOf(el) {
    return el.dataset.mid != null && el.classList.contains("wg-branch") ? "b:" + el.dataset.mid
      : el.dataset.mid != null && el.classList.contains("map-row") ? "r:" + el.dataset.mid
      : el.dataset.groupkey != null ? "g:" + el.dataset.groupkey
      : null;
  }

  function flipCapture(root) {
    const map = new Map();
    if (!root) return map;
    root.querySelectorAll(SEL).forEach((el) => {
      const k = keyOf(el);
      if (k) map.set(k, el.getBoundingClientRect());
    });
    return map;
  }

  function flipPlay(root, prev) {
    if (!root || !prev) return;
    root.querySelectorAll(SEL).forEach((el) => {
      const k = keyOf(el);
      const now = el.getBoundingClientRect();
      const old = k && prev.get(k);
      if (old) {
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        const sw = old.width && now.width ? old.width / now.width : 1;
        const sh = old.height && now.height ? old.height / now.height : 1;
        const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1;
        const resized = Math.abs(sw - 1) > 0.02 || Math.abs(sh - 1) > 0.02;
        if (moved || resized) {
          el.animate(
            [
              { transformOrigin: "top left", transform: `translate(${dx}px,${dy}px) scale(${sw},${sh})` },
              { transformOrigin: "top left", transform: "translate(0,0) scale(1,1)" },
            ],
            { duration: DUR, easing: EASE }
          );
        }
      } else {
        // newly added element — pop in
        el.animate(
          [
            { opacity: 0, transform: "translateY(-6px) scale(.97)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 220, easing: "ease-out" }
        );
      }
    });
  }

  window.HRX_FLIP = { flipCapture, flipPlay };
})();
