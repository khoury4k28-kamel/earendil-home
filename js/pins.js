// The pin: one button, used wherever a deal, a project or a task shows. Pins
// are personal, and a pin made on one screen shows on every other.

import { h, toast } from "./ui.js";
import { isPinned, togglePinned } from "./store.js";

const NS = "http://www.w3.org/2000/svg";
function pinIcon() {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "15"); svg.setAttribute("height", "15"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M9 3h6l-1 6 3 3v2h-4.2V21h-1.6v-7H7v-2l3-3-1-6z");
  svg.append(path);
  return svg;
}

// kind: "deal", "project" or "task". The click never reaches the card or row
// the button sits on.
export function pinButton(kind, id, title) {
  const on = isPinned(kind, id);
  return h("button", {
    class: "pinbtn", type: "button", "aria-pressed": String(on), "aria-label": (on ? "Unpin " : "Pin ") + title, title: on ? "Unpin" : "Pin for yourself",
    onclick: (e) => {
      e.stopPropagation();
      togglePinned(kind, id);
      toast(on ? "Unpinned." : "Pinned for you.", ["Undo", () => togglePinned(kind, id)]);
    },
  }, pinIcon());
}
export { isPinned };
