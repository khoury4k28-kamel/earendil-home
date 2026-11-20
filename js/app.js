// Starts the hub: decides between local preview and the live database, handles
// sign-in, draws the sidebar, and shows the section for the address.

import { config } from "./config.js";
import { h, setRerender, paintDrawer, closeDrawer, openDialog, toast } from "./ui.js";
import { openPalette } from "./palette.js";
import { state, init, subscribe, isOpenDeal, recordPresence, setViewAs, viewingAs, sortByName } from "./store.js";
import { deviceZone } from "./places.js";
import { previewBackend, supabaseClient, supabaseBackend } from "./backends.js";
import * as home from "./views/home.js";
import * as people from "./views/people.js";
import * as teams from "./views/teams.js";
import * as deals from "./views/deals.js";
import * as crm from "./views/crm.js";

// Home comes first and is where the hub opens.
const TABS = [
  { id: "home", label: "Home", view: home },
  { id: "people", label: "People", view: people, count: () => state.people.length },
  { id: "teams", label: "Teams", view: teams, count: () => state.teams.length },
  { id: "deals", label: "Deal Tracker", view: deals, count: () => state.deals.filter(isOpenDeal).length },
  { id: "crm", label: "CRM", view: crm, count: () => state.contacts.length + state.people.length },
];

const app = document.getElementById("app");
let client = null;
let ready = false;
let notice = null;

// "#crm/map" is the CRM section, map page.
const route = () => {
  const [id, sub] = location.hash.replace("#", "").split("/");
  return { tab: TABS.find((t) => t.id === id) || TABS.find((t) => t.id === "home"), sub: sub || "" };
};

// The sections run down a sidebar on the left. On a phone the sidebar folds
// into a strip across the top.
function shell(tab, sub) {
  return [h("div", { class: "shell" },
    h("aside", { class: "side" },
      h("a", { class: "brand", href: "#home" },
        h("img", { class: "brand__logo", src: "img/logo.svg", alt: "", width: "25", height: "34" }),
        h("span", { class: "brand__name" }, h("b", null, "Earendil"), " Home")),
      h("nav", { class: "tabs-wrap", "aria-label": "Sections" }, h("div", { class: "tabs" }, TABS.map((t) =>
        h("a", { class: "tab", href: "#" + t.id, "aria-current": t === tab ? "page" : null },
          h("span", null, t.label), t.count && h("span", { class: "tab__n num" }, t.count()))))),
      h("div", { class: "side__foot" },
        state.mode === "live"
          ? h("button", { class: "side__account", type: "button", onclick: accountDialog },
              h("span", { class: "side__who" }, state.me.name || state.me.email || "Account"), h("span", { class: "muted small" }, "Account"))
          : h("div", { class: "side__preview" },
              viewAsPicker(),
              h("span", { class: "tag tag--solid", title: "Showing the local seed file. Changes aren't saved." }, "Preview · not saved")))),
    h("div", { class: "main" },
      notice && h("div", { class: "notice" }, h("b", null, notice[0]), notice[1]),
      tab.view.render(sub)))];
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

const palette = () => ready && openPalette([["About Earendil", home.openAbout]]);

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
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.focus();
      try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ }
    }
  }
}

// ---------- sign-in ----------
function gate({ connected, message, signedInAs }) {
  const error = h("div", { class: "form-error", hidden: !message }, message || "");
  const email = h("input", { class: "input", id: "gate-email", type: "email", autocomplete: "username", required: true });
  const password = h("input", { class: "input", id: "gate-password", type: "password", autocomplete: "current-password", required: true });
  const button = h("button", { class: "btn btn--primary", type: "submit" }, "Sign in");
  const form = h("form", { class: "block" },
    h("div", { class: "field" }, h("label", { class: "field__label", for: "gate-email" }, "Email"), email),
    h("div", { class: "field" }, h("label", { class: "field__label", for: "gate-password" }, "Password"), password),
    button);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    const { data, error: err } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    button.disabled = false;
    if (err || !data?.user) {
      error.textContent = "That email and password don't match an account. Check them, or ask a hub admin to set you up.";
      error.hidden = false;
      return;
    }
    start(data.user);
  });

  app.replaceChildren(h("div", { class: "gate" }, h("div", { class: "gate__box" },
    h("img", { class: "gate__logo", src: "img/logo.svg", alt: "", width: "32", height: "44" }),
    h("div", null, h("div", { class: "gate__title" }, "Earendil Home"), h("div", { class: "muted" }, "Internal. Team members only.")),
    h("div", { class: "gate__body" },
      error,
      !connected && h("div", { class: "empty" }, h("div", null, h("b", null, "Not connected yet."), " The hub's database hasn't been switched on. Sign-in opens once it is.")),
      connected && !signedInAs && form,
      signedInAs && h("div", { class: "block" },
        h("div", null, "Signed in as ", h("b", null, signedInAs), "."),
        h("button", { class: "btn", type: "button", onclick: signOut }, "Sign out"))))));
}

async function signOut() {
  await client.auth.signOut();
  location.reload();
}

function accountDialog() {
  const pw = h("input", { class: "input", id: "new-password", type: "password", autocomplete: "new-password", placeholder: "At least 10 characters" });
  const msg = h("div", { class: "field__hint" }, "Choose a new password if you were given a temporary one.");
  const save = h("button", { class: "btn", type: "button" }, "Change password");
  save.addEventListener("click", async () => {
    if (pw.value.length < 10) { msg.textContent = "Use at least 10 characters."; return; }
    save.disabled = true;
    const { error } = await client.auth.updateUser({ password: pw.value });
    save.disabled = false;
    if (error) { msg.textContent = "That didn't work: " + error.message; return; }
    close();
    toast("Password changed.");
  });
  const close = openDialog({
    title: "Your account",
    body: h("div", { class: "block" },
      h("div", null, "Signed in as ", h("b", null, state.me.email), "."),
      h("div", { class: "field" }, h("label", { class: "field__label", for: "new-password" }, "New password"), pw, msg)),
    foot: [h("button", { class: "btn btn--quiet", type: "button", onclick: signOut }, "Sign out"), save],
  });
}

// ---------- start ----------
async function start(user) {
  app.replaceChildren(h("p", { class: "boot" }, "Loading Earendil Home…"));
  // Only people on the team list can read anything. Everyone else sees an empty list here.
  const { data: member, error } = await client.from("members").select("email").limit(1);
  if (error || !member?.length) {
    gate({ connected: true, signedInAs: user.email, message: "This account isn't on the team list yet. Ask a hub admin to add it." });
    return;
  }
  try {
    await init(supabaseBackend(client, user));
  } catch (err) {
    console.error(err);
    gate({ connected: true, signedInAs: user.email, message: "The hub's data couldn't be loaded. Try again in a moment." });
    return;
  }
  ready = true;
  render();
  recordPresence(deviceZone());
}

async function boot() {
  subscribe(() => { render(); paintDrawer(); });
  setRerender(render);
  window.addEventListener("hashchange", () => { closeDrawer(); render(); window.scrollTo(0, 0); });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette(); }
  });

  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const configured = Boolean(config.supabaseUrl && config.supabaseKey);
  const wantsPreview = new URLSearchParams(location.search).has("preview");

  if (local && (!configured || wantsPreview)) {
    const backend = await previewBackend(config.previewSeed);
    notice = backend.seedMissing ? ["Preview", "The local seed file wasn't found, so every section is empty."] : null;
    await init(backend);
    ready = true;
    render();
    return;
  }
  if (!configured) { gate({ connected: false }); return; }

  try {
    client = await supabaseClient(config);
  } catch (err) {
    console.error(err);
    gate({ connected: false, message: "The sign-in service couldn't be reached. Check your connection and reload." });
    return;
  }
  const { data } = await client.auth.getSession();
  if (data?.session?.user) start(data.session.user);
  else gate({ connected: true });
}

boot();
