// The Log: say or type what you did, and the hub does the bookkeeping.
//
// An entry is kept word for word and only its author can read it. A reader
// then suggests what it means: the core ideas (written fresh, for teammates)
// and the updates it implies (a contact made, a task done, a stage moved).
// Nothing changes until the author has looked at the suggestions and pressed
// Apply; what they apply is saved through the same calls every other screen
// uses, so teammates see it at once.
//
// Used by the hub (a dialog from any page, and the Log tab) and by the phone
// page, which is this and nothing else.

import { h, toast, refresh, openDialog, emptyState, fmtDate, todayISO } from "./ui.js";
import {
  state, subscribe, create, update, remove, setLocal, canReadLogs, readLog, dealsForContact, isOpenDeal,
} from "./store.js";
import { describe, perform, stillOpen, rec, nameOf } from "./actions.js";
import { canDictate, startDictation } from "./dictate.js";

const MAX = 8000;
export const logReady = () => state.logsReady;

// ---------- the draft: kept in this browser until it is saved ----------
const draftKey = () => "log-draft:" + (state.me.id || "shared");
let draftFor = null;
let draft = "";
let spoken = false;
function loadDraft() {
  if (draftFor === draftKey()) return;
  draftFor = draftKey();
  try { draft = localStorage.getItem(draftFor) || ""; } catch { draft = ""; }
}
function setDraft(text) {
  draft = text;
  try { text ? localStorage.setItem(draftKey(), text) : localStorage.removeItem(draftKey()); } catch { /* storage may be blocked */ }
}

// ---------- redrawing ----------
// The hub page redraws itself. The dialog sits outside the page, so it is
// redrawn here, keeping the cursor where it was.
let mount = null;
let closeMount = null;
function paintMount() {
  if (!mount) return;
  if (!mount.isConnected) { mount = null; closeMount = null; return; }
  const a = document.activeElement;
  const keep = a && a.id && mount.contains(a) ? { id: a.id, start: a.selectionStart, end: a.selectionEnd } : null;
  mount.replaceChildren(...logPanel({ device: "hub", history: 0 }));
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ } }
  }
}
subscribe(paintMount);
const changed = () => { refresh(); paintMount(); };

// ---------- speaking ----------
let stopListening = null;
let interim = "";
let micProblem = "";
const textBox = () => document.getElementById("log-text");
function toggleMic() {
  if (stopListening) { stopListening(); return; }
  micProblem = "";
  stopListening = startDictation({
    onText: (said) => {
      if (!said) return;
      spoken = true;
      setDraft(draft && !/\s$/.test(draft) ? draft + " " + said : draft + said);
      const el = textBox();
      if (el) { el.value = draft; el.scrollTop = el.scrollHeight; }
    },
    onInterim: (text) => {
      interim = text;
      const el = document.getElementById("log-interim");
      if (el) el.textContent = text;
    },
    onEnd: (problem) => { stopListening = null; interim = ""; micProblem = problem || ""; changed(); },
  });
  changed();
}

function micIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const svg = el("svg", { viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "aria-hidden": "true" });
  svg.append(el("rect", { x: "9", y: "3", width: "6", height: "11", rx: "3" }), el("path", { d: "M5 11a7 7 0 0 0 14 0M12 18v3" }));
  return svg;
}

// ---------- my entries ----------
const mine = () => state.logs.filter((l) => l.person_id === state.me.id)
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const clock = (iso) => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
function dayLabel(day) {
  const today = todayISO();
  if (day === today) return "Today";
  const y = new Date(); y.setDate(y.getDate() - 1);
  return day === localDay(y.toISOString()) ? "Yesterday" : fmtDate(day);
}

// ---------- saving and reading ----------
const busy = new Set();
const WHY_NOT = {
  not_set_up: "The reader isn't switched on yet.",
  too_long: "This entry is too long to read in one go.",
  declined: "The reader wouldn't take this entry.",
  busy: "The reader is busy. Try again in a minute.",
  unreachable: "The reader couldn't be reached.",
};
async function save(device) {
  const body = draft.trim();
  if (!body) { textBox()?.focus(); return; }
  if (body.length > MAX) { toast("That's too long to read in one go. Save it in two parts."); return; }
  if (stopListening) stopListening();
  const row = await create("logs", {
    person_id: state.me.id, author_email: state.me.email || null, body, source: spoken ? "voice" : "typed", device,
    status: "new", proposal: null, applied: null, created_at: new Date().toISOString(),
  });
  if (!row) return;   // not saved: the words are still in the box
  setDraft("");
  spoken = false;
  const el = textBox();
  if (el) el.value = "";
  read(row);
}
async function read(log) {
  if (busy.has(log.id)) return;
  busy.add(log.id);
  changed();
  try {
    let proposal;
    if (canReadLogs()) proposal = await readLog(log.id, todayISO());
    else { proposal = standIn(log.body); await update("logs", log.id, { proposal, status: "read" }); }
    setLocal("logs", log.id, { proposal, status: "read", why: null });
  } catch (err) {
    console.warn(err);
    setLocal("logs", log.id, { status: "failed", why: err.code || "unreachable" });
  }
  busy.delete(log.id);
  changed();
}

// Preview has no reader. So the screens can be tried, names found in the entry
// stand in for it; the card says so.
function standIn(body) {
  const text = body.toLowerCase();
  const said = (name) => { const n = String(name || "").toLowerCase().trim(); return n.length >= 4 && text.includes(n); };
  const today = todayISO();
  const ideas = state.deals.filter((d) => said(d.organisation) || said(d.name))
    .map((d) => ({ text: "Made progress here today.", about_type: "deal", about_id: d.id }));
  const actions = [
    ...state.contacts.filter((c) => said(c.name)).map((c) => ({ type: "log_contact", target_type: "contact", target_id: c.id, date: today, why: "Named in the entry" })),
    ...state.tasks.filter((t) => t.status !== "done" && said(t.title)).map((t) => ({ type: "complete_task", target_type: "task", target_id: t.id, why: "Named in the entry" })),
  ];
  if (!ideas.length) ideas.push({ text: "Logged an update.", about_type: "none", about_id: null });
  return { ideas, actions, unmatched: [], standIn: true };
}

// ---------- what the author has ticked ----------
const picks = new Map();
function picksFor(log) {
  if (picks.has(log.id)) return picks.get(log.id);
  const p = log.proposal || { ideas: [], actions: [] };
  const ideas = (p.ideas || []).map((i) => ({ ...i, on: true }));
  // Anything already true, or about a record that has since gone, is left out.
  const actions = (p.actions || []).filter(stillOpen).map((a) => ({ ...a, on: true }));
  // Being in touch with a contact is being in touch on their open deals.
  for (const a of [...actions]) {
    if (a.type !== "log_contact" || a.target_type !== "contact") continue;
    for (const d of dealsForContact(a.target_id).filter(isOpenDeal)) {
      if (actions.some((x) => x.type === "log_contact" && x.target_type === "deal" && x.target_id === d.id)) continue;
      actions.push({ type: "log_contact", target_type: "deal", target_id: d.id, date: a.date, why: `${nameOf("contact", a.target_id)} is a contact on this project`, on: true });
    }
  }
  const pick = { ideas, actions };
  picks.set(log.id, pick);
  return pick;
}
// ---------- applying ----------
// Each change goes through the usual save calls and remembers how to take
// itself back, so one Undo covers the lot.
async function apply(log) {
  const pick = picksFor(log);
  const me = state.me;
  const undo = [];
  const lines = [];
  const stamp = () => ({ author: me.label || "Team", created_at: new Date().toISOString() });

  for (const i of pick.ideas) {
    const text = i.text.trim();
    if (!i.on || !text) continue;
    const general = i.about_type === "none" || !rec(i.about_type, i.about_id);
    const row = await create("activity", {
      entity_type: general ? "person" : i.about_type, entity_id: general ? me.id : i.about_id,
      body: text, source: "log", log_id: log.id, ...stamp(),
    });
    if (!row) continue;
    undo.push(() => remove("activity", row.id));
    lines.push(general ? "Note on your profile" : `Note on ${nameOf(i.about_type, i.about_id)}`);
  }

  for (const a of pick.actions) {
    if (!a.on) continue;
    const back = await perform(a);
    if (!back) continue;
    undo.push(back);
    lines.push(describe(a, true));
  }

  const proposal = log.proposal;
  await update("logs", log.id, { status: "applied", applied: lines, proposal: null });
  picks.delete(log.id);
  if (!lines.length) { toast("Entry kept. Nothing else changed."); return; }
  toast(`${lines.length} ${lines.length === 1 ? "update" : "updates"} applied.`, ["Undo", async () => {
    for (const back of undo.reverse()) await back();
    update("logs", log.id, { status: "read", applied: null, proposal });
  }]);
}
function skip(log) {
  picks.delete(log.id);
  update("logs", log.id, { status: "applied", applied: [], proposal: null });
}

// ---------- screens ----------
function sendIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M12 19V5M6 11l6-6 6 6");
  svg.append(path);
  return svg;
}
// The box grows with what is written in it, up to a point, then scrolls.
function fit(text) {
  if (!text.isConnected) return;
  text.style.height = "auto";
  text.style.height = Math.min(text.scrollHeight, Math.round(window.innerHeight * 0.42)) + "px";
}
// One rounded box, as in a chat: the words, then the mic and Send inside it.
// In the hub Return sends and Shift+Return starts a new line; on the phone
// Return is a new line, as its keyboard expects.
function composer(device, hint) {
  loadDraft();
  const text = h("textarea", {
    class: "logbox__text", id: "log-text", rows: "1", placeholder: hint || "What did you do today? Say it however it comes.",
    "aria-label": "Log entry", maxlength: String(MAX * 2),
  });
  text.value = draft;
  const send = h("button", { class: "sendbtn", type: "button", "aria-label": "Send", title: "Send", onclick: () => save(device) }, sendIcon());
  const mark = () => send.classList.toggle("is-ready", Boolean(text.value.trim()));
  mark();
  text.addEventListener("input", () => { setDraft(text.value); fit(text); mark(); });
  text.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const go = device === "phone" ? e.metaKey || e.ctrlKey : !e.shiftKey;
    if (go) { e.preventDefault(); save(device); }
  });
  requestAnimationFrame(() => fit(text));
  const on = Boolean(stopListening);
  return h("div", { class: "logcomposer" },
    h("div", { class: "logbox" },
      text,
      h("div", { class: "logbox__interim", id: "log-interim", "aria-live": "polite" }, interim),
      micProblem && h("div", { class: "form-error" }, micProblem),
      h("div", { class: "logbox__bar" },
        canDictate()
          ? h("button", { class: "micbtn" + (on ? " is-on" : ""), type: "button", "aria-pressed": String(on), onclick: toggleMic }, micIcon(), on ? "Stop" : "Speak")
          : h("span", { class: "muted small" }, "To speak, use the mic on your keyboard."),
        send)),
    h("div", { class: "logbox__note muted small" }, "Only you can read this. Teammates see the ideas you approve."));
}

function tick(id, on, label, toggle) {
  return h("button", { class: "check", type: "button", id, role: "checkbox", "aria-checked": String(on), "aria-label": label, onclick: toggle });
}
function review(log) {
  const pick = picksFor(log);
  const count = pick.ideas.filter((i) => i.on && i.text.trim()).length + pick.actions.filter((a) => a.on).length;
  const empty = !pick.ideas.length && !pick.actions.length;
  const lost = log.proposal?.unmatched || [];
  return h("section", { class: "logcard" },
    h("div", { class: "logcard__head" },
      h("h3", { class: "h3" }, empty ? "Nothing to update from this one" : "Check before it goes in"),
      h("span", { class: "muted small" }, `${dayLabel(localDay(log.created_at))}, ${clock(log.created_at)}`)),
    log.proposal?.standIn && h("div", { class: "muted small" }, "Preview: names found in the entry stand in for the reader."),
    pick.ideas.length > 0 && h("div", { class: "logcard__part" },
      h("div", { class: "eyebrow" }, "Teammates will see"),
      pick.ideas.map((i, n) => {
        const box = h("textarea", { class: "textarea logcard__idea", id: `log-idea-${log.id}-${n}`, rows: "2", "aria-label": "Idea " + (n + 1), disabled: !i.on });
        box.value = i.text;
        box.addEventListener("input", () => { i.text = box.value; });
        return h("div", { class: "logcard__row" },
          tick(`log-idea-on-${log.id}-${n}`, i.on, "Include idea " + (n + 1), () => { i.on = !i.on; changed(); }),
          h("div", { class: "logcard__main" }, box,
            h("div", { class: "muted small" }, i.about_type === "none" || !rec(i.about_type, i.about_id) ? "On your profile" : "On " + nameOf(i.about_type, i.about_id))));
      })),
    pick.actions.length > 0 && h("div", { class: "logcard__part" },
      h("div", { class: "eyebrow" }, "Updates"),
      pick.actions.map((a, n) => h("div", { class: "logcard__row" },
        tick(`log-act-on-${log.id}-${n}`, a.on, describe(a), () => { a.on = !a.on; changed(); }),
        h("div", { class: "logcard__main" + (a.on ? "" : " is-off") },
          h("div", null, describe(a)),
          a.why && h("div", { class: "muted small" }, a.why))))),
    lost.length > 0 && h("div", { class: "muted small" }, "Couldn't place: " + lost.join(", ") + "."),
    h("div", { class: "logcard__foot" },
      empty ? h("span") : h("button", { class: "btn btn--quiet", type: "button", onclick: () => skip(log) }, "Skip all"),
      empty
        ? h("button", { class: "btn btn--primary", type: "button", onclick: () => skip(log) }, "Done")
        : h("button", { class: "btn btn--primary", type: "button", disabled: !count, onclick: () => apply(log) }, `Apply ${count}`)));
}

// An entry still on its way: being read, not read yet, or one the reader couldn't take.
function pending(log) {
  if (busy.has(log.id)) return h("div", { class: "logwait" }, h("span", { class: "logwait__dot", "aria-hidden": "true" }), "Reading your entry…");
  const failed = log.status === "failed";
  return h("div", { class: "logwait" },
    h("span", null, failed ? `${WHY_NOT[log.why] || "The entry couldn't be read."} Your words are saved.` : "Saved, not read yet."),
    h("button", { class: "btn btn--small", type: "button", onclick: () => read(log) }, failed ? "Try again" : "Read it"));
}

let armed = null;
// The first press asks, the second deletes.
function delButton(log) {
  const del = () => {
    if (armed !== log.id) { armed = log.id; changed(); return; }
    armed = null;
    picks.delete(log.id);
    remove("logs", log.id);
  };
  return h("button", { class: "quiet logentry__del", type: "button", onclick: del }, armed === log.id ? "Click again to delete" : "Delete");
}
function entry(log) {
  const lines = Array.isArray(log.applied) ? log.applied : [];
  return h("li", { class: "logentry" },
    h("div", { class: "logentry__meta" },
      h("span", { class: "num" }, clock(log.created_at)),
      log.source === "voice" && h("span", null, "Spoken"),
      log.device === "phone" && h("span", null, "Phone"),
      delButton(log)),
    h("div", { class: "prose" }, log.body),
    lines.length > 0 && h("ul", { class: "logentry__did" }, lines.map((l) => h("li", null, l))));
}
function history(logs, limit) {
  const shown = limit ? logs.slice(0, limit) : logs;
  if (!shown.length) return null;
  const days = new Map();
  for (const l of shown) { const d = localDay(l.created_at); days.set(d, [...(days.get(d) || []), l]); }
  return h("div", { class: "logdays" }, [...days].map(([day, list]) => h("section", { class: "logday" },
    h("h2", { class: "sec__title" }, dayLabel(day)),
    h("ul", null, list.map(entry)))));
}

// The whole Log, as a list of blocks. `history`: how many past entries to
// show (0 for none, null for all).
export function logPanel({ device = "hub", history: limit = null } = {}) {
  if (!state.me.id) {
    return [emptyState("The Log needs to know who you are.", "Pick your name on Home, then come back.",
      h("a", { class: "btn", href: device === "phone" ? "./#home" : "#home", onclick: () => closeMount?.() }, "Go to Home"))];
  }
  const logs = mine();
  const waiting = logs.filter((l) => l.status !== "applied");
  const cards = waiting.map((l) => (l.status === "read" && l.proposal && !busy.has(l.id) ? review(l) : pending(l)));
  // On the phone the check comes first: under the big text box it would sit off screen.
  return [
    ...(device === "phone" ? [cards, composer(device)] : [composer(device), cards]),
    limit === 0 ? null : history(logs.filter((l) => l.status === "applied"), limit),
  ].flat().filter(Boolean);
}

// ---------- the Log tab: a conversation ----------
// Laid out like a chat, in a column down the middle of the page. What you
// wrote sits on the right; what the hub made of it answers on the left: still
// reading, a check card, or the updates that went in. The box stays at the
// foot. A day with nothing in it yet opens on the box alone, mid-screen.
let showEarlier = false;
let lastThread = null;
window.addEventListener("hashchange", () => { showEarlier = false; lastThread = null; });

function answer(log) {
  if (log.status !== "applied") return log.status === "read" && log.proposal && !busy.has(log.id) ? review(log) : pending(log);
  const lines = Array.isArray(log.applied) ? log.applied : [];
  return lines.length
    ? h("ul", { class: "logentry__did" }, lines.map((l) => h("li", null, l)))
    : h("div", { class: "muted" }, "Kept. Nothing else changed.");
}
function turn(log) {
  return [
    h("div", { class: "msg msg--me" },
      h("div", { class: "msg__bubble prose" }, log.body),
      h("div", { class: "msg__meta" },
        h("span", { class: "num" }, clock(log.created_at)),
        log.source === "voice" && h("span", null, "Spoken"),
        log.device === "phone" && h("span", null, "Phone"),
        delButton(log))),
    h("div", { class: "msg msg--hub" }, answer(log)),
  ];
}
export function logChat() {
  if (!state.me.id) return h("div", { class: "chat chat--hero" }, h("div", { class: "chat__hero" }, logPanel({ device: "hub" })));
  const logs = mine().reverse();   // oldest first, as a conversation reads
  const today = todayISO();
  const open = logs.some((l) => l.status !== "applied" || localDay(l.created_at) === today);
  if (!open && !showEarlier) {
    const first = String(state.me.name || "").trim().split(/\s+/)[0];
    return h("div", { class: "chat chat--hero" },
      h("div", { class: "chat__hero" },
        h("h1", { class: "chat__hello" }, first ? `What did you do today, ${first}?` : "What did you do today?"),
        composer("hub", "Say it however it comes."),
        logs.length > 0 && h("button", { class: "quiet chat__earlier", type: "button", onclick: () => { showEarlier = true; changed(); } }, "Earlier entries")));
  }
  const days = new Map();
  for (const l of logs) { const d = localDay(l.created_at); days.set(d, [...(days.get(d) || []), l]); }
  // Stay at the latest turn: on arriving, and whenever the conversation moves on.
  const key = logs.map((l) => l.id + l.status + (busy.has(l.id) ? "~" : "")).join("|");
  if (key !== lastThread) {
    lastThread = key;
    requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  }
  return h("div", { class: "chat" },
    h("div", { class: "chat__thread" },
      [...days].map(([day, list]) => [h("div", { class: "chat__day" }, dayLabel(day)), list.map(turn)])),
    h("div", { class: "chat__dock" }, composer("hub", "What else happened?")));
}

// ---------- the hub's ways in ----------
export function openLog() {
  if (location.hash.startsWith("#log")) { textBox()?.focus(); return; }
  if (mount?.isConnected) return;
  mount = h("div", { class: "logdialog" });
  mount.replaceChildren(...logPanel({ device: "hub", history: 0 }));
  const close = openDialog({
    title: "Log",
    body: mount,
    foot: [h("a", { class: "link small", href: "#log", onclick: () => close() }, "Past entries"), h("span")],
  });
  closeMount = close;
}
