// Starts the hub: decides between local preview and the live database, handles
// sign-in, draws the sidebar, and shows the section for the address.

import { h, setRerender, paintDrawer, closeDrawer, openDialog, avatar } from "./ui.js";
import { openPerson } from "./detail.js";
import { openPalette } from "./palette.js";
import { syncSticky } from "./sticky.js";
import { state, subscribe, isOpenDeal, recordPresence, setViewAs, viewingAs, sortByName, personForEmail, onlineNow } from "./store.js";
import { deviceZone } from "./places.js";
import { signIn, signOut } from "./auth.js";
import { openLog, logReady } from "./log.js";
import { simulateSlack } from "./slack.js";
import * as home from "./views/home.js";
import * as teams from "./views/teams.js";
import * as worktab from "./views/worktab.js";
import * as deals from "./views/deals.js";
import * as crm from "./views/crm.js";
import * as docs from "./views/docs.js";
import * as log from "./views/log.js";

// Home comes first and is where the hub opens. Deals & Tasks, where the work
// is kept, is next. Deal Tracker sits under CRM.
const TABS = [
  { id: "home", label: "Home", view: home },
  { id: "work", label: "Projects & Tasks", view: worktab, count: () => state.tasks.filter((t) => t.status !== "done").length },
  { id: "teams", label: "Teams", view: teams, count: () => state.people.length },
  { id: "crm", label: "CRM", view: crm, count: () => state.contacts.length + state.people.length },
  { id: "deals", label: "Project Tracker", view: deals, count: () => state.deals.filter(isOpenDeal).length },
  { id: "docs", label: "Documents", view: docs, count: () => state.documents.filter((d) => !d.archive).length },
  { id: "log", label: "Log", view: log, show: logReady },
];

// The Log only shows once the database has its table.
const tabs = () => TABS.filter((t) => !t.show || t.show());

const app = document.getElementById("app");
let ready = false;
let notice = null;

// "#crm/map" is the CRM section, map page.
const route = () => {
  let [id, sub] = location.hash.replace("#", "").split("/");
  if (id === "people") id = "teams"; // People was folded into Teams; old links still land.
  return { tab: tabs().find((t) => t.id === id) || TABS.find((t) => t.id === "home"), sub: sub || "" };
};

// The sections run down a sidebar on the left. On a phone the sidebar folds
// into a strip across the top.
function shell(tab, sub) {
  return [h("div", { class: "shell" },
    h("aside", { class: "side" },
      h("a", { class: "brand", href: "#home" },
        h("img", { class: "brand__logo", src: "img/logo.svg", alt: "", width: "25", height: "34" }),
        h("span", { class: "brand__name" }, h("b", null, "Earendil"), " Home")),
      h("nav", { class: "tabs-wrap", "aria-label": "Sections" }, h("div", { class: "tabs" }, tabs().map((t) =>
        h("a", { class: "tab", href: "#" + t.id, "aria-current": t === tab ? "page" : null },
          h("span", null, t.label), t.count && h("span", { class: "tab__n num" }, t.count()))))),
      h("div", { class: "side__foot" },
        state.mode === "preview" && h("div", { class: "side__preview" },
          viewAsPicker(),
          h("span", { class: "tag tag--solid", title: "Showing the local seed file. Changes aren't saved." }, "Preview · not saved")),
        onlineStrip(),
        // Who is signed in. Press it to sign out.
        h("button", { class: "side__account", type: "button", id: "account", onclick: accountDialog, title: state.me.email || null },
          h("span", { class: "muted small" }, "Signed in as"),
          h("span", { class: "side__who" }, signedInName())))),
    h("div", { class: "main" },
      notice && h("div", { class: "notice" }, h("b", null, notice[0]), notice[1]),
      tab.view.render(sub)))];
}

// The name shown at the bottom left: the person behind the sign-in address
// (not whoever is being "viewed as"), or the address itself if nobody matches.
function signedInName() {
  if (!state.me.email) return "Nobody";
  return personForEmail(state.me.email)?.name || state.me.email;
}

// Who has the hub open right now: a row of faces above the account, each with
// a dot (green: looking at it; grey: open in a background tab). Pressing the
// row lists them, and pressing a name opens that person's panel.
let onlineOpen = false;
const face = (o, size) => h("span", { class: "on" + (o.active ? "" : " on--away") }, avatar(o.name, size));
function onlineStrip() {
  const list = onlineNow();
  const others = list.length - 1;
  const shown = list.slice(0, 4);
  return h("div", { class: "side__online" },
    onlineOpen && h("div", { class: "onpop", role: "dialog", "aria-label": "Online now" },
      h("div", { class: "onpop__title" }, "Online now"),
      list.map((o) => h("button", { class: "onpop__row", type: "button", disabled: !o.id,
        onclick: () => { onlineOpen = false; render(); openPerson(o.id); } },
        face(o, "s"),
        h("span", { class: "onpop__name" }, o.name),
        h("span", { class: "muted small" }, o.me ? "You" : o.active ? "" : "Away")))),
    h("button", { class: "onbtn", type: "button", id: "online", "aria-expanded": String(onlineOpen),
      onclick: () => { onlineOpen = !onlineOpen; render(); } },
      h("span", { class: "onbtn__faces" }, shown.map((o) => face(o, "s")),
        list.length > shown.length && h("span", { class: "onbtn__more num" }, "+" + (list.length - shown.length))),
      h("span", { class: "onbtn__label" }, others ? `${list.length} online` : "Only you online")));
}

// Local preview only: see the hub as one of the team would.
function viewAsPicker() {
  if (!state.people.length) return null;
  const current = viewingAs() || "";
  const sel = h("select", { class: "pick" + (current ? "" : " pick--empty"), id: "view-as", "aria-label": "View the hub as" },
    h("option", { value: "" }, "View as…"),
    sortByName(state.people).map((p) => h("option", { value: p.id, selected: p.id === current }, "As " + p.name)));
  sel.addEventListener("change", () => setViewAs(sel.value));
  return sel;
}

// Preview has no Slack, so a message can be typed in to try the feed.
const palette = () => ready && openPalette([["About Earendil", home.openAbout]],
  [...(logReady() ? [["Log my day", openLog]] : []), ...(state.mode === "preview" ? [["Try a Slack message (preview)", simulateSlack]] : [])]);

function render() {
  if (!ready) return;
  const a = document.activeElement;
  // A field being edited in place stays put; the screen catches up when it closes.
  if (a && a.dataset?.editing && app.contains(a)) return;
  // Keep the cursor where it was if the screen redraws while someone is typing.
  const keep = a && a.id && app.contains(a) ? { id: a.id, start: a.selectionStart, end: a.selectionEnd } : null;
  const { tab, sub } = route();
  document.title = tab.id === "home" ? "Earendil Home" : `${tab.label} · Earendil Home`;
  app.replaceChildren(...shell(tab, sub));
  syncSticky(true);   // on every page
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.focus();
      try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ }
    }
  }
}

function accountDialog() {
  openDialog({
    title: "Your account",
    body: h("div", { class: "block" },
      h("div", null, "Signed in as ", h("b", null, signedInName()), "."),
      personForEmail(state.me.email) ? h("div", { class: "muted" }, state.me.email)
        : h("div", { class: "muted small" }, "This address isn't matched to anyone on Teams yet. Home will ask which one is you.")),
    foot: [h("span"), h("button", { class: "btn", type: "button", onclick: signOut }, "Sign out")],
  });
}

async function boot() {
  subscribe(() => { render(); paintDrawer(); });
  setRerender(render);
  window.addEventListener("hashchange", () => { closeDrawer(); render(); window.scrollTo(0, 0); });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette(); }
    if (e.key === "Escape" && onlineOpen) { onlineOpen = false; render(); }
  });
  // The "online now" list closes when anything outside it is pressed.
  document.addEventListener("click", (e) => {
    if (onlineOpen && !e.target.closest?.(".side__online")) { onlineOpen = false; render(); }
  });

  await signIn({
    app, title: "Earendil Home", loading: "Loading Earendil Home…",
    onGate: () => { syncSticky(false); },
    onReady: ({ live, notice: n }) => {
      notice = n;
      ready = true;
      render();
      if (live) recordPresence(deviceZone());
    },
  });
}

boot();
