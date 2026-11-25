// The phone page: the Log and nothing else. Add it to the home screen and it
// opens like an app. Same sign-in and same data as the hub.

import { h, setRerender } from "./ui.js";
import { state, subscribe, recordPresence } from "./store.js";
import { deviceZone } from "./places.js";
import { signIn, signOut } from "./auth.js";
import { logPanel, logReady } from "./log.js";

const app = document.getElementById("app");
let ready = false;
let asked = false;

function render() {
  if (!ready) return;
  const a = document.activeElement;
  const keep = a && a.id && app.contains(a) ? { id: a.id, start: a.selectionStart, end: a.selectionEnd } : null;
  app.replaceChildren(h("main", { class: "phone" },
    h("header", { class: "phone__head" },
      h("img", { src: "img/logo.svg", alt: "", width: "19", height: "26" }),
      h("h1", { class: "phone__title" }, "Log"),
      h("button", { class: "quiet phone__who", type: "button", onclick: account }, asked ? "Sign out?" : state.me.name || state.me.email || "Account")),
    logReady()
      ? logPanel({ device: "phone", history: 6 })
      : h("div", { class: "empty" }, h("div", null, h("b", null, "The Log isn't switched on yet."), " It needs its table in the database.")),
    h("a", { class: "link small phone__hub", href: "./" }, "Open Earendil Home")));
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ } }
  }
}

// The first press asks, the second signs out.
function account() {
  if (!asked) { asked = true; render(); setTimeout(() => { asked = false; render(); }, 4000); return; }
  signOut();
}

subscribe(render);
setRerender(render);
signIn({
  app, title: "Earendil Log", loading: "Loading…",
  onReady: ({ live }) => {
    ready = true;
    render();
    if (live) recordPresence(deviceZone());
  },
});
