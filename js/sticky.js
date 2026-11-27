// A sticky note at the bottom right of every page: write whatever you want.
// It folds down to a small tab and opens again, and can be dragged to any size by
// its top left corner (the bottom right stays put); Default puts it back. It sits
// outside the page so a redraw never interrupts typing. The text is each
// person's own and is kept in this browser only: it is not sent anywhere.

import { withSlash } from "./slash.js";
import { h } from "./ui.js";
import { state } from "./store.js";

const SIZES = ["closed", "open"];
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } };

const noteKey = () => "sticky:" + (state.me.id || "shared");
// "large" is a size older versions saved; it now opens at the default size.
let size = SIZES.includes(read("sticky-size")) ? read("sticky-size") : read("sticky-size") === "large" ? "open" : "closed";
let root = null;
let area = null;
let tab = null;
let grow = null;
let card = null;
let loaded = null;   // whose note the box is showing

// A size the person dragged to, or null for the default size.
const MIN_W = 220, MIN_H = 160;
let dims = null;
try { const d = JSON.parse(read("sticky-dims")); if (d && d.w > 0 && d.h > 0) dims = d; } catch { /* none saved */ }
const clamp = (w, h) => ({
  w: Math.round(Math.max(MIN_W, Math.min(w, window.innerWidth - 32))),
  h: Math.round(Math.max(MIN_H, Math.min(h, window.innerHeight - 120))),
});
function setDims(next, save) {
  dims = next;
  card.style.width = dims ? dims.w + "px" : "";
  card.style.height = dims ? dims.h + "px" : "";
  if (save) write("sticky-dims", dims ? JSON.stringify(dims) : "");
  if (grow) grow.disabled = !dims;
}
// The corner grows the note up and to the left, because the note is pinned bottom right.
function startDrag(e) {
  if (e.button) return;
  e.preventDefault();
  const grip = e.currentTarget;
  const box = card.getBoundingClientRect();
  const from = { x: e.clientX, y: e.clientY, w: box.width, h: box.height };
  grip.setPointerCapture(e.pointerId);
  root.classList.add("sticky--dragging");
  const move = (ev) => setDims(clamp(from.w + from.x - ev.clientX, from.h + from.y - ev.clientY), false);
  const stop = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", stop);
    grip.removeEventListener("pointercancel", stop);
    root.classList.remove("sticky--dragging");
    if (dims) setDims(dims, true);
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", stop);
  grip.addEventListener("pointercancel", stop);
}
// Arrow keys do the same for people not using a mouse.
function keyResize(e) {
  const step = { ArrowLeft: [20, 0], ArrowRight: [-20, 0], ArrowUp: [0, 20], ArrowDown: [0, -20] }[e.key];
  if (!step) return;
  e.preventDefault();
  const box = card.getBoundingClientRect();
  setDims(clamp(box.width + step[0], box.height + step[1]), true);
}

function setSize(next, focus) {
  size = next;
  write("sticky-size", size);
  paint();
  if (focus && size !== "closed") area.focus();
}
function paint() {
  root.className = "sticky sticky--" + size + (root.classList.contains("sticky--dragging") ? " sticky--dragging" : "");
  tab.hidden = size !== "closed";
  tab.classList.toggle("sticky__tab--has", Boolean(area.value.trim()));
  grow.disabled = !dims;
}
function build() {
  area = h("textarea", { class: "sticky__text", id: "sticky-text", placeholder: "Write anything", "aria-label": "Sticky note", spellcheck: "true" });
  withSlash(area);
  area.addEventListener("input", () => write(noteKey(), area.value));
  area.addEventListener("keydown", (e) => { if (e.key === "Escape") setSize("closed"); });
  tab = h("button", { class: "sticky__tab", type: "button", onclick: () => setSize("open", true) }, "Note");
  grow = h("button", { class: "sticky__btn", type: "button", title: "Back to the default size", onclick: () => { setDims(null, true); area.focus(); } }, "Default");
  const grip = h("button", { class: "sticky__grip", type: "button", "aria-label": "Resize note: drag, or use the arrow keys", title: "Drag to resize" });
  grip.addEventListener("pointerdown", startDrag);
  grip.addEventListener("keydown", keyResize);
  card = h("div", { class: "sticky__card" },
    grip,
    h("div", { class: "sticky__head" },
      h("span", { class: "sticky__title" }, "Sticky note"),
      grow,
      h("button", { class: "sticky__btn", type: "button", onclick: () => setSize("closed") }, "Close")),
    area,
    h("div", { class: "sticky__foot" }, "Only you see this. Kept in this browser."));
  if (dims) setDims(dims, false);
  root = h("aside", { class: "sticky", "aria-label": "Sticky note" },
    tab,
    card);
  document.body.append(root);
}

// Called on every redraw: shows the note (the sign-in screen hides it).
export function syncSticky(show) {
  if (!show) { if (root) root.hidden = true; return; }
  if (!root) build();
  root.hidden = false;
  // Load the viewer's own note, unless they are in the middle of typing it.
  if (loaded !== noteKey() && document.activeElement !== area) {
    loaded = noteKey();
    area.value = read(loaded) || "";
  }
  paint();
}
