// Starts the hub: decides between local preview and the live database, handles
// sign-in, draws the sidebar, and shows the section for the address.

import { config } from "./config.js";
import { h, setRerender, paintDrawer, closeDrawer, openDialog } from "./ui.js";
import { openPalette } from "./palette.js";
import { state, init, subscribe, isOpenDeal, recordPresence, setViewAs, viewingAs, sortByName, personForEmail } from "./store.js";
import { deviceZone } from "./places.js";
import { previewBackend, supabaseClient, supabaseBackend } from "./backends.js";
import * as home from "./views/home.js";
import * as people from "./views/people.js";
import * as teams from "./views/teams.js";
import * as deals from "./views/deals.js";
import * as crm from "./views/crm.js";
import * as docs from "./views/docs.js";

// Home comes first and is where the hub opens. Deal Tracker sits under CRM.
const TABS = [
  { id: "home", label: "Home", view: home },
  { id: "people", label: "People", view: people, count: () => state.people.length },
  { id: "teams", label: "Teams", view: teams, count: () => state.teams.length },
  { id: "crm", label: "CRM", view: crm, count: () => state.contacts.length + state.people.length },
  { id: "deals", label: "Deal Tracker", view: deals, count: () => state.deals.filter(isOpenDeal).length },
  { id: "docs", label: "Documents", view: docs, count: () => state.documents.filter((d) => !d.archive).length },
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
        state.mode === "preview" && h("div", { class: "side__preview" },
          viewAsPicker(),
          h("span", { class: "tag tag--solid", title: "Showing the local seed file. Changes aren't saved." }, "Preview · not saved")),
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
// One screen for both cases. Live: the database checks the email and password.
// Preview on this Mac: the email must be a team address and the password is
// checked against the team password's hash in a private local file.
const SESSION = "hub-session";
const teamEmail = (email) => email.toLowerCase().endsWith("@" + config.emailDomain);
function readSession() {
  try { const s = JSON.parse(localStorage.getItem(SESSION) || "null"); return s && s.email ? s : null; } catch { return null; }
}

function gate({ connected, message, signedInAs, signIn, note }) {
  const error = h("div", { class: "form-error", hidden: !message }, message || "");
  const email = h("input", { class: "input", id: "gate-email", type: "email", autocomplete: "username", required: true, placeholder: "initials@" + config.emailDomain });
  const password = h("input", { class: "input", id: "gate-password", type: "password", autocomplete: "current-password", required: true });
  const button = h("button", { class: "btn btn--primary", type: "submit" }, "Sign in");
  const form = h("form", { class: "block" },
    h("div", { class: "field" }, h("label", { class: "field__label", for: "gate-email" }, "Earendil email"), email),
    h("div", { class: "field" }, h("label", { class: "field__label", for: "gate-password" }, "Team password"), password),
    button,
    note && h("div", { class: "field__hint" }, note));
  const fail = (text) => { error.textContent = text; error.hidden = false; };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const address = email.value.trim();
    if (!teamEmail(address)) { fail(`Use your Earendil email (your initials@${config.emailDomain}).`); email.focus(); return; }
    button.disabled = true;
    const problem = await signIn(address, password.value);
    button.disabled = false;
    if (problem) { fail(problem); password.select(); }
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
  if (connected && !signedInAs) email.focus();
}

// Live: the database decides.
async function liveSignIn(address, password) {
  const { data, error: err } = await client.auth.signInWithPassword({ email: address, password });
  if (err || !data?.user) return "That email and password don't match. Check them, or ask a hub admin to set you up.";
  start(data.user);
  return null;
}

// Preview: compare with the team password's hash (PBKDF2), kept in the vault on this Mac.
async function teamPassword() {
  try {
    const res = await fetch(config.previewLogin, { cache: "no-store" });
    const spec = res.ok ? await res.json() : null;
    return spec && spec.hash && spec.salt && spec.iterations ? spec : null;
  } catch { return null; }
}
async function matches(password, spec) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(spec.salt.match(/../g).map((x) => parseInt(x, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: spec.iterations }, key, 256);
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, "0")).join("") === spec.hash;
}
async function previewGate() {
  const spec = await teamPassword();
  gate({
    connected: true,
    note: spec ? null : "No team password is set yet, so any password works on this Mac.",
    signIn: async (address, password) => {
      if (spec && !(await matches(password, spec))) return "That password isn't right.";
      try { localStorage.setItem(SESSION, JSON.stringify({ email: address, at: new Date().toISOString() })); } catch { /* storage may be blocked */ }
      await startPreview(address);
      return null;
    },
  });
}

async function signOut() {
  if (client) await client.auth.signOut();
  try { localStorage.removeItem(SESSION); } catch { /* ignore */ }
  setViewAs(null);
  location.reload();
}

function accountDialog() {
  openDialog({
    title: "Your account",
    body: h("div", { class: "block" },
      h("div", null, "Signed in as ", h("b", null, signedInName()), "."),
      personForEmail(state.me.email) ? h("div", { class: "muted" }, state.me.email)
        : h("div", { class: "muted small" }, "This address isn't matched to anyone on People yet. Home will ask which one is you.")),
    foot: [h("span"), h("button", { class: "btn", type: "button", onclick: signOut }, "Sign out")],
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

async function startPreview(email) {
  app.replaceChildren(h("p", { class: "boot" }, "Loading Earendil Home…"));
  const backend = await previewBackend(config.previewSeed, { documents: config.previewDocuments, radar: config.previewRadar });
  backend.me.email = email;
  notice = backend.seedMissing ? ["Preview", "The local seed file wasn't found, so every section is empty."] : null;
  await init(backend);
  ready = true;
  render();
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
    const session = readSession();
    if (session && teamEmail(session.email)) await startPreview(session.email);
    else await previewGate();
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
  else gate({ connected: true, signIn: liveSignIn });
}

boot();
