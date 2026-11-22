// Home is personal: each person sees their own. It answers, in order, what
// people open a home page to find out:
//   1. What matters today?          -> Today: the three things that most need a person
//   2. What should I do next?       -> Tasks: to-dos and deal follow-ups, mine first
//   3. What changed while I was out -> Since your last visit
//   4. What is coming?              -> Coming up
//   5. Who is on what, and where?   -> Team
// Down the right side runs the Radar: the week's outside news that bears on
// the business, with the viewer's own markets first.
// "Mine" means: a to-do I own, a deal I own or am on. Things that belong to a
// teammate are on their Home, not mine. Things nobody owns are "Up for grabs".
// Missing details (no contact date, no country, nothing set up) are not tasks.
// They sit at the foot under "Tidy up" and are fixed in place.

import {
  h, avatar, fmtDate, parseDate, todayISO, todayLabel, daysSince, ago, plural, refresh, toast, quickAdd, inlineEdit,
  openDrawer, drawerFrame, block, kv,
} from "../ui.js";
import { state, saveSetting, isOpenDeal, create, update, byId, personName, setViewAs } from "../store.js";
import { openForm } from "../form.js";
import {
  editRecord, openDeal, openPerson, openContact, dealIssues, stalledDays, pickPerson,
  logContact, takeDeal, finishTask, clearToConfirm, openProject, progressBar, workTag, workMark, openWork,
} from "../detail.js";
import { workOf, nextStep, allWork, isLive, isActive, isOn } from "../work.js";
import { stageLabel } from "../schema.js";
import { findCountry, findCountries, personPlace } from "../places.js";

let showAll = false;
let moreDates = false;
let scope = null;        // "mine" | "all"; null = decide from who is signed in
let openTidy = null;     // which "Tidy up" row is open
let tidyAll = false;
let grabsAll = false;
let workAll = false;
let workDone = false;    // also list finished projects
const WORK_LIMIT = 6;
let radarAll = false;
const RADAR_LIMIT = 6;
const TASK_LIMIT = 5;
const SNOOZE_DAYS = 7;

// ---------- company reference, in a side panel ----------
function editCompany() {
  const s = state.settings;
  openForm({
    title: "Edit mission and values",
    record: { mission: s.mission, tagline: s.tagline, about: s.about, values: s.values || [] },
    fields: [
      { key: "mission", label: "Mission", type: "textarea", required: true },
      { key: "tagline", label: "Line", wide: true },
      { key: "about", label: "Who we are", type: "textarea" },
      { key: "values", label: "Values", type: "lines", placeholder: "One per line" },
    ],
    onSave: async (v) => {
      for (const key of ["mission", "tagline", "about", "values"]) {
        if (JSON.stringify(v[key]) !== JSON.stringify(s[key] ?? null)) await saveSetting(key, v[key]);
      }
    },
  });
}

export function openAbout() {
  openDrawer(() => {
    const s = state.settings;
    const products = s.products || [];
    const groups = ["Train", "Detect", "Intercept"].filter((g) => products.some((p) => p.group === g));
    return drawerFrame(
      { eyebrow: "Earendil", title: s.mission || "Mission not written yet", sub: s.tagline,
        actions: h("button", { class: "btn btn--small", type: "button", onclick: editCompany }, "Edit") },
      s.about && block("Who we are", h("div", { class: "prose" }, s.about), kv((s.facts || []).map((f) => [f.label, f.value]))),
      block("Values", (s.values || []).length
        ? h("ul", { class: "rows" }, s.values.map((v) => h("li", { class: "row" }, h("span", { class: "row__title" }, v))))
        : h("button", { class: "link", type: "button", onclick: editCompany }, "Write the values")),
      groups.length > 0 && block("What we sell", groups.map((g) => h("div", { class: "block" },
        h("div", { class: "caps" }, g),
        h("ul", { class: "rows" }, products.filter((p) => p.group === g).map((p) => h("li", { class: "row" },
          h("div", { class: "row__main" }, h("div", { class: "row__title" }, p.name), h("div", { class: "row__meta" }, p.note)))))))),
      (s.regions || []).length > 0 && block("Where", h("ul", { class: "rows" }, s.regions.map((r) => h("li", { class: "row" },
        h("div", { class: "row__main" }, h("div", { class: "row__title" }, r.name), h("div", { class: "row__meta" }, r.note)))))));
  });
}

// ---------- pieces shared with Teams ----------
function goalRow(g) {
  const hasNumbers = g.target != null && g.target !== 0;
  const pct = hasNumbers ? Math.max(0, Math.min(100, ((g.current || 0) / g.target) * 100)) : 0;
  return h("button", { class: "goal rowbtn", type: "button", onclick: () => editRecord("goals", g) },
    h("div", { class: "goal__top" },
      h("span", { class: "row__title" }, g.title),
      h("span", { class: "num small" }, hasNumbers ? `${g.current ?? 0} of ${g.target}${g.unit ? " " + g.unit : ""}` : "")),
    hasNumbers && h("div", { class: "progress" }, h("div", { class: "progress__fill", style: `width:${pct}%` })),
    (g.due || g.note) && h("div", { class: "row__meta" }, [g.due && "Due " + fmtDate(g.due), g.note].filter(Boolean).join(" · ")));
}
export function goalsList(goals, emptyText) {
  return goals.length ? h("div", null, goals.map(goalRow)) : h("div", { class: "muted small" }, emptyText);
}
function daysLeft(m) {
  if (!parseDate(m.date) || m.status === "done") return "";
  const d = -daysSince(m.date);
  return d < 0 ? "" : d === 0 ? "today" : `${d}d`;
}
export function milestoneRows(list) {
  return h("ul", { class: "rows" }, list.map((m) => h("li", { class: "row" },
    h("span", { class: "row__date" }, m.date_label || fmtDate(m.date) || "No date"),
    h("button", { class: "row__main rowbtn", type: "button", onclick: () => editRecord("milestones", m) },
      h("div", { class: "row__title" },
        h("span", { class: "sq" + (m.kind === "external" ? " sq--ring" : m.status === "done" ? "" : " sq--open"), title: m.kind === "external" ? "An outside event we track" : null }),
        m.title)),
    daysLeft(m) && h("span", { class: "days" }, daysLeft(m)))));
}

// ---------- small pieces ----------
function section(title, action, ...body) {
  return h("section", { class: "sec" }, h("div", { class: "sec__head" }, h("h2", { class: "sec__title" }, title), action), body);
}
const smallBtn = (label, onclick) => h("button", { class: "btn btn--small", type: "button", onclick }, label);
const moreBtn = (hidden, open, toggle) => (hidden > 0 || open) &&
  h("button", { class: "more", type: "button", onclick: toggle }, open ? "Show fewer" : `+ ${hidden} more`);
// "a · b · c", where a part may be text or an element.
const dots = (parts) => parts.filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]));
const red = (text) => h("span", { class: "red" }, text);
const inDays = (d) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);

// Opens a deal with the field that needs filling already under the cursor.
function openAt(id, field) {
  openDeal(id);
  const el = document.getElementById(`${field}-${id}`);
  if (el?.classList.contains("inline")) el.click(); else el?.focus();
}

// Snoozing hides a row for a week, for this person on this device only.
function snoozed() {
  try {
    const all = JSON.parse(localStorage.getItem("home-snoozed") || "{}");
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, until]) => until > now));
  } catch { return {}; }
}
function setSnoozed(map) {
  try { localStorage.setItem("home-snoozed", JSON.stringify(map)); } catch { /* storage may be blocked */ }
  refresh();
}
function snooze(key) {
  const before = snoozed();
  setSnoozed({ ...before, [key]: Date.now() + SNOOZE_DAYS * 864e5 });
  toast(`Hidden for ${SNOOZE_DAYS} days on this device.`, ["Undo", () => setSnoozed(before)]);
}

// ---------- whose page this is ----------
const meId = () => state.me.id;
const onDeal = (d) => Boolean(meId() && (d.owner_id === meId() || (d.people_ids || []).includes(meId())));
// "mine", "theirs" (a teammate's) or "open" (nobody's yet)
const dealBelongs = (d) => (onDeal(d) ? "mine" : personName(d.owner_id) ? "theirs" : "open");
// A task with no owner follows its deal or project.
function taskBelongs(t) {
  if (meId() && t.owner_id === meId()) return "mine";
  if (personName(t.owner_id)) return "theirs";
  const w = workOf(t);
  if (w && isOn(w.rec, meId())) return "mine";
  if (w && personName(w.rec.owner_id)) return "theirs";
  return "open";
}

// ---------- everything that could need a person, each with a score ----------
// Higher scores are more pressing. What is mine counts for more; a teammate's
// work is theirs to see first.
// Home only gathers. Pressing a task or a deal goes to its page on Deals &
// Tasks, which is where things are added and changed.
const toWork = (kind, id) => { location.hash = `#work/${kind}:${id}`; };
function workItems() {
  const today = todayISO();
  const items = [];
  for (const t of state.tasks) {
    if (t.status === "done") continue;
    const overdue = Boolean(t.due && t.due < today);
    const left = t.due && !overdue ? -daysSince(t.due) : null;
    const soon = left != null && left <= 7;
    const belongs = taskBelongs(t);
    const edit = () => editRecord("tasks", t);
    // Every task carries its deal or project. Work that is on hold, finished,
    // signed or closed keeps its tasks to itself.
    const w = workOf(t);
    if (w && !isActive(w.kind, w.rec)) continue;
    items.push({
      key: "task:" + t.id, type: "task", belongs, title: t.title, open: w ? () => toWork(w.kind, w.id) : edit, tick: () => finishTask(t),
      quick: !w, tag: workTag(t), workName: w?.name,
      score: overdue ? 100 + Math.min(30, daysSince(t.due)) : soon ? 70 - left : 55,
      action: belongs === "open" ? (meId() ? ["Take it", () => takeTask(t)] : ["Assign", edit]) : ["Done", () => finishTask(t)],
      meta: [belongs !== "mine" && personName(t.owner_id), overdue ? red(`Overdue since ${fmtDate(t.due)}`) : t.due && `Due ${fmtDate(t.due)}`,
        t.status === "doing" && "In progress"],
    });
  }
  for (const d of state.deals) {
    if (!isOpenDeal(d)) continue;
    const quiet = stalledDays(d);
    if (!quiet && nextStep(d)) continue;
    const belongs = dealBelongs(d);
    const base = { type: "deal", belongs, open: () => toWork("deal", d.id) };
    const about = [d.organisation !== d.name && d.organisation, stageLabel(d.stage), belongs !== "mine" && personName(d.owner_id)];
    if (quiet) {
      items.push({ ...base, key: `deal:${d.id}:stalled`, score: 90 + Math.min(9, quiet / 10), title: `Follow up on ${d.name}`,
        tick: () => logContact("deals", d), action: ["Log contact", () => logContact("deals", d)], meta: [red(`No contact in ${quiet} days`), ...about] });
    } else {
      items.push({ ...base, key: `deal:${d.id}:next`, score: 45, title: `Set the next step for ${d.name}`,
        tick: () => openAt(d.id, "task-deal"), action: ["Add next step", () => openAt(d.id, "task-deal")], meta: about });
    }
  }
  for (const m of state.milestones) {
    if (m.team_id || m.status === "done" || !parseDate(m.date)) continue;
    const left = -daysSince(m.date);
    if (left < 0 || left > 60) continue;
    items.push({ key: "date:" + m.id, type: "date", belongs: "all", id: m.id, title: m.title, open: () => editRecord("milestones", m),
      score: left <= 1 ? 98 : left <= 14 ? 85 - left : 40 - left / 10,
      meta: [m.date_label || fmtDate(m.date), left <= 14 ? red(inDays(left)) : inDays(left)] });
  }
  const hidden = snoozed();
  for (const it of items) if (meId() && it.belongs === "mine") it.score += 25;
  return items.filter((it) => !hidden[it.key]).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
function takeTask(t) {
  const before = t.owner_id || null;
  update("tasks", t.id, { owner_id: meId() });
  toast("It's yours.", ["Undo", () => update("tasks", t.id, { owner_id: before })]);
}
// The three most pressing for this person, with no more than two of one kind.
// A teammate's work is left for their own page.
function topThree(items) {
  const picked = [];
  for (const it of items) {
    if (picked.length === 3) break;
    if (meId() && it.belongs === "theirs") continue;
    if (picked.filter((p) => p.type === it.type).length < 2) picked.push(it);
  }
  return picked;
}

// ---------- who are you? ----------
// Until the hub knows who is looking, Home can't be personal. Signed in: pick
// your name once and your profile gets your sign-in email. Preview: pick anyone.
function claim() {
  if (meId() || !state.people.length) return null;
  const live = state.mode === "live";
  if (!state.me.email) return null;
  const pick = (p) => {
    if (!live) { setViewAs(p.id); return; }
    const before = p.email || null;
    update("people", p.id, { email: state.me.email });
    toast(`This is now ${p.name}'s Home.`, ["Undo", () => update("people", p.id, { email: before })]);
  };
  return h("div", { class: "claim" },
    h("div", null, h("b", null, "Home is personal."), " Which of these is you?"),
    h("div", { class: "chips" }, [...state.people].sort((a, b) => a.name.localeCompare(b.name)).map((p) =>
      h("button", { class: "person-chip", type: "button", onclick: () => pick(p) }, avatar(p.name, "s"), p.name))));
}

// The middle of a task row. Clicking it opens the task; its tag (the deal or
// project it belongs to) opens that instead.
function cell(it, titleClass) {
  return h("div", { class: "arow__main arow__main--row", onclick: it.open },
    h("button", { class: "arow__go " + titleClass, type: "button" }, it.title),
    (it.tag || it.meta.some(Boolean)) && h("div", { class: "arow__sub" }, it.tag, h("span", null, dots(it.meta))));
}

// ---------- 1. today ----------
function today(top) {
  if (!top.length) return null;
  return section(top.length === 3 ? "Today · Top 3" : "Today", null,
    h("ol", null, top.map((it, i) => h("li", { class: "rrow" },
      h("span", { class: "rrow__n num", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
      cell(it, "rrow__title"),
      it.action && h("button", { class: "btn", type: "button", onclick: it.action[1] }, it.action[0])))));
}

// ---------- 2. tasks ----------
function taskRows(items) {
  return h("ul", null, items.map((it) => h("li", { class: "arow trow" },
    h("button", { class: "check", type: "button", role: "checkbox", "aria-checked": "false", "aria-label": "Done: " + it.title, onclick: it.tick }),
    cell(it, "arow__title"),
    it.action && it.action[0] !== "Done" && h("button", { class: "btn", type: "button", onclick: it.action[1] }, it.action[0]),
    h("button", { class: "quiet", type: "button", "aria-label": "Snooze: " + it.title, onclick: () => snooze(it.key) }, "Snooze"))));
}
// One switch: whose tasks (Mine / Everyone). Tasks are added on Deals & Tasks,
// inside their deal or project.
function seg(label, options, current, set) {
  return h("div", { class: "seg seg--small", role: "group", "aria-label": label }, options.map(([value, text]) =>
    h("button", { type: "button", "aria-pressed": String(current === value), onclick: () => { set(value); refresh(); } }, text)));
}
function tasks(rest, snoozedCount) {
  const mine = rest.filter((it) => it.belongs === "mine");
  const whose = meId() ? scope || "mine" : "all";
  const pool = whose === "mine" ? mine : rest;
  const items = pool;
  const shown = showAll ? items : items.slice(0, TASK_LIMIT);
  return section(`${whose === "mine" ? "Your tasks" : "Tasks"} · ${items.length}`,
    h("div", { class: "actions" },
      snoozedCount > 0 && h("button", { class: "more more--head", type: "button", onclick: () => setSnoozed({}) }, `${snoozedCount} snoozed · Show`),
      h("a", { class: "link small", href: "#work" }, "All"),
      meId() && seg("Whose tasks", [["mine", `Mine ${mine.length}`], ["all", `Everyone ${rest.length}`]], whose, (v) => { scope = v; })),
    shown.length > 0 && taskRows(shown),
    moreBtn(items.length - shown.length, showAll, () => { showAll = !showAll; refresh(); }));
}

// ---------- deals and projects: one list ----------
// A deal is a project with a pipeline, so they sit together: each row has its
// progress and the task to do next.
function work() {
  const mineOnly = Boolean(meId()) && (scope || "mine") === "mine";
  const pool = allWork().filter((w) => !mineOnly || isOn(w.rec, meId()));
  const live = pool.filter((w) => isLive(w.kind, w.rec));
  const finished = pool.filter((w) => w.kind === "project" && w.rec.status === "done");
  const rank = (w) => (w.kind === "project" && w.rec.status === "done" ? 2 : w.kind === "project" && w.rec.status === "paused" ? 1 : 0);
  const list = [...live, ...(workDone ? finished : [])].sort((a, b) => rank(a) - rank(b) ||
    String(a.next?.due || "9").localeCompare(String(b.next?.due || "9")) || a.name.localeCompare(b.name));
  const shown = workAll ? list : list.slice(0, WORK_LIMIT);
  const kinds = new Set(list.map((w) => w.kind));
  const name = kinds.size === 1 ? (kinds.has("deal") ? "deals" : "projects") : "deals and projects";
  const today = todayISO();
  return section(`${mineOnly ? "Your " + name : name[0].toUpperCase() + name.slice(1)} · ${list.length}`,
    h("div", { class: "actions" },
      finished.length > 0 && h("button", { class: "more more--head", type: "button", onclick: () => { workDone = !workDone; refresh(); } },
        workDone ? "Hide finished" : `${finished.length} finished · Show`),
      h("a", { class: "link small", href: "#work" }, "All")),
    shown.length > 0 && h("ul", null, shown.map((w) => {
      const r = w.rec;
      const done = rank(w) === 2;
      const quiet = w.kind === "deal" ? stalledDays(r) : null;
      const late = w.kind === "project" && r.status === "active" && r.due && r.due < today;
      return h("li", { class: "arow wrow" + (done ? " done" : "") },
        workMark(w),
        h("button", { class: "arow__main", type: "button", onclick: () => toWork(w.kind, w.id) },
          h("div", { class: "arow__title" }, w.name),
          h("div", { class: "arow__text" }, dots([
            rank(w) === 1 && "On hold", done && "Finished",
            !isOn(r, meId()) && personName(r.owner_id),
            !done && (w.next ? `Next: ${w.next.title}` : w.kind === "deal" ? (r.next_step ? `Next: ${r.next_step}` : "No next step") : w.total ? "All tasks done" : "No tasks yet"),
            late ? red(`Due ${fmtDate(r.due)}`) : w.kind === "project" && r.due && !done && `Due ${fmtDate(r.due)}`]))),
        quiet && h("span", { class: "stalled", title: `No contact in ${quiet} days` }, `${quiet}d`),
        w.total > 0 && h("span", { class: "prow__n num" }, `${w.done}/${w.total}`),
        progressBar(w.done, w.total));
    })),
    moreBtn(list.length - shown.length, workAll, () => { workAll = !workAll; refresh(); }));
}

function takeProject(p) {
  const before = p.owner_id || null;
  update("projects", p.id, { owner_id: meId() });
  toast(`${p.name} is yours.`, ["Undo", () => update("projects", p.id, { owner_id: before })]);
}
// ---------- up for grabs: work nobody owns yet ----------
function upForGrabs(rest) {
  if (!meId()) return null;
  const rows = [
    // A task under a deal or project nobody owns isn't listed on its own: taking the deal or project covers it.
    ...rest.filter((it) => it.type === "task" && it.belongs === "open" && it.quick).map((it) => ({ title: it.title, text: "To-do", open: it.open, take: it.action[1] })),
    ...state.projects.filter((p) => (p.status || "active") === "active" && !personName(p.owner_id) && !isOn(p, meId())).sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ title: p.name, text: "Project", open: () => openProject(p.id), take: () => takeProject(p) })),
    ...state.deals.filter((d) => isOpenDeal(d) && !personName(d.owner_id) && !onDeal(d)).sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ title: d.name, text: ["Deal", stageLabel(d.stage), d.organisation !== d.name && d.organisation].filter(Boolean).join(" · "), open: () => openDeal(d.id), take: () => takeDeal(d) })),
  ];
  if (!rows.length) return null;
  const shown = grabsAll ? rows : rows.slice(0, 4);
  return section(`Up for grabs · ${rows.length}`, null,
    h("ul", null, shown.map((r) => h("li", { class: "arow" },
      h("button", { class: "arow__main", type: "button", onclick: r.open }, h("div", { class: "arow__title" }, r.title), h("div", { class: "arow__text" }, r.text)),
      smallBtn("Take it", r.take)))),
    moreBtn(rows.length - shown.length, grabsAll, () => { grabsAll = !grabsAll; refresh(); }));
}

// ---------- 3. since your last visit ----------
// When this person last opened the hub on this device, read once per session.
let since = null;
function lastVisit() {
  if (since !== null) return since;
  try {
    since = localStorage.getItem("home-last-visit") || "";
    localStorage.setItem("home-last-visit", new Date().toISOString());
  } catch { since = ""; }
  return since;
}
function changes() {
  const from = lastVisit();
  if (!from) return null;
  const myEmail = (state.me.email || "").toLowerCase();
  const who = (email) => state.people.find((p) => (p.email || "").toLowerCase() === String(email || "").toLowerCase())?.name || String(email || "").split("@")[0];
  const kinds = { deal: ["deals", openDeal], person: ["people", openPerson], contact: ["contacts", openContact], project: ["projects", openProject] };
  const isMine = (type, rec) => (type === "deal" ? onDeal(rec) : type === "project" ? isOn(rec, meId()) : type === "task" ? rec.owner_id === meId() : type === "contact" ? rec.owner_id === meId() : false) && Boolean(meId());
  const rows = [];
  const seen = new Set();
  for (const a of state.activity) {
    const kind = kinds[a.entity_type];
    const rec = kind && byId(kind[0], a.entity_id);
    if (!rec || String(a.created_at) <= from) continue;
    if ((a.author_email || "").toLowerCase() === myEmail && myEmail) continue;
    if (!a.author_email && a.author === state.me.label) continue;
    seen.add(a.entity_type + ":" + a.entity_id);
    rows.push({ at: a.created_at, mine: isMine(a.entity_type, rec), title: rec.name, text: a.body, by: a.author, open: () => kind[1](rec.id) });
  }
  const tables = [["deals", "deal", (r) => openDeal(r.id), "Deal"], ["projects", "project", (r) => openProject(r.id), "Project"], ["contacts", "contact", (r) => openContact(r.id), "Contact"],
    ["tasks", "task", (r) => editRecord("tasks", r), "Task"], ["milestones", "date", (r) => editRecord("milestones", r), "Date"]];
  for (const [table, type, open, noun] of tables) for (const r of state[table]) {
    if (!r.updated_at || String(r.updated_at) <= from || seen.has(type + ":" + r.id)) continue;
    if (myEmail && (r.updated_by || "").toLowerCase() === myEmail) continue;
    const added = r.created_at && Math.abs(new Date(r.updated_at) - new Date(r.created_at)) < 5000;
    rows.push({ at: r.updated_at, mine: isMine(type, r), title: r.name || r.title, text: `${noun} ${added ? "added" : "updated"}`, by: who(r.updated_by), open: () => open(r) });
  }
  if (!rows.length) return null;
  // Changes to what is yours come first, then the newest.
  rows.sort((a, b) => Number(b.mine) - Number(a.mine) || String(b.at).localeCompare(String(a.at)));
  return section(`Since your last visit · ${rows.length}`, h("span", { class: "days" }, ago(from)),
    h("ul", null, rows.slice(0, 8).map((r) => h("li", { class: "arow" },
      h("button", { class: "arow__main", type: "button", onclick: r.open },
        h("div", { class: "arow__title" }, r.title), h("div", { class: "arow__text" }, dots([r.mine && "Yours", r.text]))),
      h("span", { class: "days" }, [r.by, ago(r.at)].filter(Boolean).join(" · "))))));
}

// ---------- 4. coming up ----------
function comingUp(skip) {
  const all = state.milestones.filter((m) => !m.team_id);
  const key = (m) => (parseDate(m.date) ? m.date : "9999");
  const ahead = all.filter((m) => m.status !== "done" && !skip.has(m.id)).sort((a, b) => key(a).localeCompare(key(b)));
  const done = all.filter((m) => m.status === "done").sort((a, b) => key(b).localeCompare(key(a)));
  const shown = moreDates ? ahead : ahead.slice(0, 4);
  return section("Coming up", smallBtn("Add", () => editRecord("milestones", null, { status: "upcoming", kind: "company" })),
    shown.length > 0 && milestoneRows(shown),
    moreBtn(ahead.length - shown.length, moreDates, () => { moreDates = !moreDates; refresh(); }),
    moreDates && done.length > 0 && h("details", { class: "past" }, h("summary", null, `${done.length} done`), milestoneRows(done)));
}

// ---------- 5. team: everyone else ----------
function team() {
  const others = state.people.filter((p) => p.id !== meId()).sort((a, b) => a.name.localeCompare(b.name));
  if (!others.length) return null;
  return section("Team", h("a", { class: "link small", href: "#teams" }, "All"),
    h("ul", null, others.map((p) => {
      const place = personPlace(p);
      return h("li", { class: "arow" },
        avatar(p.name, "s"),
        h("button", { class: "arow__main", type: "button", onclick: () => openPerson(p.id) },
          h("div", { class: "arow__title" }, p.name),
          h("div", { class: "arow__text" }, p.focus || "No update yet")),
        place.text && h("span", { class: "days" }, place.text));
    })));
}

// ---------- tidy up: missing details, fixed in place ----------
// Signed in, this is about your own records and the ones nobody owns. A
// teammate's gaps are on their page.
function tidy() {
  const me = meId();
  const mineOrOpen = (owner) => !me || owner === me || !personName(owner);
  const open = state.deals.filter(isOpenDeal);
  const myDealsOrAll = open.filter((d) => (me ? onDeal(d) : true));
  const line = (rec, onName, control) => h("li", { class: "arow" },
    h("button", { class: "arow__main", type: "button", onclick: onName }, h("div", { class: "arow__title" }, rec.name)), control);
  const noOwner = me ? [] : open.filter((d) => !personName(d.owner_id));       // signed in: these are "Up for grabs"
  const noTouch = myDealsOrAll.filter((d) => !d.last_touch);
  const toConfirm = myDealsOrAll.filter((d) => d.to_confirm);
  const noCountry = state.contacts.filter((c) => !findCountry(c.country) && mineOrOpen(c.owner_id));
  const noFocus = me ? [] : state.people.filter((p) => !p.focus);              // signed in: your own is the line under the greeting
  const noEmail = state.people.filter((p) => !p.email && (!me || p.id === me));
  const yours = me ? "of your " : "";
  const rows = [
    noOwner.length && { key: "owner", title: `${plural(noOwner.length, "deal has", "deals have")} no owner`,
      body: () => noOwner.map((d) => line(d, () => openDeal(d.id), pickPerson({ value: d.owner_id, blank: "Choose owner", label: `Owner of ${d.name}`, onChange: (v) => update("deals", d.id, { owner_id: v }) }))) },
    noTouch.length && { key: "touch", title: `${noTouch.length} ${yours}${noTouch.length === 1 ? "deal has" : "deals have"} no contact date`,
      body: () => noTouch.map((d) => line(d, () => openDeal(d.id), inlineEdit({ id: `tidy-touch-${d.id}`, value: "", placeholder: "Add date", label: `Last contact on ${d.name}`, type: "date", onSave: (v) => update("deals", d.id, { last_touch: v }) }))) },
    toConfirm.length && { key: "confirm", title: `${toConfirm.length} ${yours}${toConfirm.length === 1 ? "deal has" : "deals have"} details to confirm`,
      body: () => toConfirm.map((d) => h("li", { class: "arow" },
        h("button", { class: "arow__main", type: "button", onclick: () => openDeal(d.id) }, h("div", { class: "arow__title" }, d.name), h("div", { class: "arow__text" }, d.to_confirm)),
        smallBtn("Confirmed", () => clearToConfirm(d)))) },
    noCountry.length && { key: "country", title: `${plural(noCountry.length, "contact has", "contacts have")} no country, so ${noCountry.length === 1 ? "it is" : "they are"} not on the map`,
      body: () => noCountry.map((c) => line(c, () => openContact(c.id), inlineEdit({ id: `tidy-country-${c.id}`, value: c.country, placeholder: "Add country", label: `Country of ${c.name}`, onSave: (v) => update("contacts", c.id, { country: v }) }))) },
    noFocus.length && { key: "focus", title: `${plural(noFocus.length, "person has", "people have")} no update on what they're working on`,
      body: () => noFocus.map((p) => line(p, () => openPerson(p.id), inlineEdit({ id: `tidy-focus-${p.id}`, value: "", placeholder: "Add update", label: `What ${p.name} is working on`, onSave: (v) => update("people", p.id, { focus: v }) }))) },
    noEmail.length && { key: "email", title: me ? "Your profile has no email, so signing in won't open this page as you" : `${plural(noEmail.length, "person has", "people have")} no email, so the hub can't greet them by name`,
      body: () => noEmail.map((p) => line(p, () => openPerson(p.id), inlineEdit({ id: `tidy-email-${p.id}`, value: "", placeholder: "Add email", label: `Email of ${p.name}`, type: "email", onSave: (v) => update("people", p.id, { email: v }) }))) },
    !state.goals.some((g) => !g.team_id) && { key: "targets", title: "No company targets yet", go: ["Set targets", () => editRecord("goals", null, {})] },
    !(state.settings.values || []).length && { key: "values", title: "The values aren't written yet", go: ["Write them", editCompany] },
    !state.teams.length && { key: "teams", title: "No teams yet", go: ["Set up teams", () => { location.hash = "teams"; }] },
  ].filter(Boolean);
  if (!rows.length) return null;
  const shown = tidyAll ? rows : rows.slice(0, 4);
  return section(`Tidy up · ${rows.length}`, null,
    h("ul", null, shown.map((r) => {
      const isOpen = openTidy === r.key;
      return h("li", { class: "tidy" },
        h("div", { class: "arow" },
          r.body
            ? h("button", { class: "arow__main tidy__title", type: "button", "aria-expanded": String(isOpen), onclick: () => { openTidy = isOpen ? null : r.key; refresh(); } }, r.title)
            : h("span", { class: "arow__main tidy__title" }, r.title),
          r.body ? h("button", { class: "quiet", type: "button", "aria-hidden": "true", tabindex: "-1", onclick: () => { openTidy = isOpen ? null : r.key; refresh(); } }, isOpen ? "Close" : "Fix")
            : smallBtn(r.go[0], r.go[1])),
        isOpen && h("ul", { class: "tidy__body" }, r.body()));
    })),
    moreBtn(rows.length - shown.length, tidyAll, () => { tidyAll = !tidyAll; refresh(); }));
}

// ---------- the lines under the greeting ----------
// The state of things in a sentence: your own deals if you have any, else the company's.
function pulse() {
  const open = state.deals.filter(isOpenDeal);
  const mine = open.filter(onDeal);
  const set = mine.length ? mine : open;
  const quiet = set.filter((d) => stalledDays(d) != null).length;
  const next = state.milestones.filter((m) => !m.team_id && m.status !== "done" && parseDate(m.date) && -daysSince(m.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const left = next ? -daysSince(next.date) : null;
  return h("div", { class: "pulse" }, dots([
    todayLabel(),
    set.length > 0 && h("a", { href: "#deals" }, mine.length ? `${plural(mine.length, "open deal")} of yours` : plural(open.length, "open deal")),
    quiet > 0 && h("a", { href: "#deals", class: "red" }, `${quiet} gone quiet`),
    next && h("button", { type: "button", onclick: () => editRecord("milestones", next) }, left === 0 ? `${next.title} is today` : `${plural(left, "day")} to ${next.title}`),
  ]));
}
// What you are working on, in your own words. The team sees it in your panel on Teams and on their Home.
function yourUpdate() {
  const me = byId("people", meId());
  if (!me) return null;
  return h("div", { class: "youron" }, h("span", { class: "muted" }, "You're on"),
    inlineEdit({ id: "my-focus", value: me.focus, placeholder: "Say what you're working on", label: "What you're working on", onSave: (v) => update("people", me.id, { focus: v }) }));
}

// ---------- radar: outside news, down the right side ----------
// Headlines come from publishers' own feeds, gathered into the vault by its
// build-radar script. Only the headline, publisher and date are shown; the
// link goes to the publisher.
// RULE: every headline shown has a real picture (the article's own, as a small
// thumbnail). There is no placeholder. A headline with no picture is not shown,
// and one whose picture fails to load is taken off the list.
function newsPicture(it) {
  const img = h("img", { class: "nrow__thumb", src: state.radarBase + it.thumb, alt: "", width: "76", height: "76" });
  img.addEventListener("error", () => img.closest(".nrow")?.remove());
  return img;
}

function radar() {
  const feed = state.radar;
  if (!feed || !(feed.items || []).some((it) => it.thumb)) return null;
  // The countries of my deals: news about them comes first.
  const mine = new Set(state.deals.filter((d) => isOpenDeal(d) && onDeal(d)).flatMap((d) =>
    [...findCountries(d.region), ...(d.contact_ids || []).map((id) => findCountry(byId("contacts", id)?.country))].filter(Boolean).map((c) => c.code)));
  const hits = (it) => (it.regions || []).some((r) => mine.has(r));
  const items = feed.items.filter((it) => it.thumb).map((it, i) => ({ ...it, i })).sort((a, b) => Number(hits(b)) - Number(hits(a)) || a.i - b.i);
  if (!items.length) return null;
  const shown = radarAll ? items : items.slice(0, RADAR_LIMIT);
  const stale = Date.now() - new Date(feed.updated).getTime() > 36 * 3600e3;
  return h("aside", { class: "radar", "aria-label": "Radar" },
    h("div", { class: "sec__head" }, h("h2", { class: "sec__title" }, "Radar"),
      h("span", { class: "days" + (stale ? " red" : ""), title: "When the headlines were last gathered" }, "Updated " + ago(feed.updated))),
    h("ol", null, shown.map((it, n) => h("li", { class: "nrow" },
      h("a", { class: "nrow__link", href: it.url, target: "_blank", rel: "noopener noreferrer" },
        newsPicture(it),
        h("div", { class: "nrow__main" },
          h("div", { class: "nrow__topic" }, dots([h("span", { class: "num nrow__n" }), it.topic, hits(it) && "your market"])),   // the number is counted by the list itself, so it stays right if a row drops out
          h("div", { class: "nrow__title" }, it.title),
          h("div", { class: "arow__text" }, dots([it.source, ago(it.at)]))))))),
    moreBtn(items.length - shown.length, radarAll, () => { radarAll = !radarAll; refresh(); }));
}

function greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (state.me.name || "").split(" ")[0];
  return (first ? `${part}, ${first}` : part) + ".";
}

function goals() {
  const list = state.goals.filter((g) => !g.team_id);
  if (!list.length) return null;
  return section("Targets", smallBtn("Add", () => editRecord("goals", null, {})), goalsList(list));
}

export function render() {
  const all = workItems();
  const top = topThree(all);
  const picked = new Set(top.map((it) => it.key));
  const rest = all.filter((it) => !picked.has(it.key) && it.type !== "date");
  const hiddenCount = Object.keys(snoozed()).length;
  const mission = state.settings.mission;
  const news = radar();
  return h("main", { class: "page page--home" + (news ? " page--rail" : "") },
    h("div", { class: "home__head page-head__text" }, h("h1", { class: "h1" }, greeting()), pulse(), yourUpdate()),
    h("div", { class: "home__main" },
      claim(),
      today(top), tasks(rest, hiddenCount), work(), upForGrabs(rest), changes(), goals(),
      comingUp(new Set(top.filter((it) => it.type === "date").map((it) => it.id))), team(), tidy(),
      h("button", { class: "missionline", type: "button", onclick: openAbout, title: "Mission, values and what we sell" }, (mission || "Write the mission") + " →")),
    news);
}
