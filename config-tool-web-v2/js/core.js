/* ============================================================
   HID Remapper VX — Core DOM helpers (loaded before view modules)
   ============================================================ */
function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

let _toastWrap;
function toast(msg) {
  if (!_toastWrap) { _toastWrap = h('<div class="toast-wrap"></div>'); document.body.appendChild(_toastWrap); }
  const t = h(`<div class="toast">${ICON.check}<span>${msg}</span></div>`);
  _toastWrap.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .3s, transform .3s";
    t.style.opacity = "0";
    t.style.transform = "translateY(8px)";
    setTimeout(() => t.remove(), 320);
  }, 1900);
}

window.HRX = { h, $, $$, toast };
