// Home: one column, in the order you act on it. The next three dated events
// (the radar), then one task list where every row has a tick, one action and
// a snooze. Below: recent changes, targets, the pipeline in brief, the team
// and a setup checklist. Company reference (mission, values, products) is one
// click away.

import {
  h, avatar, fmtDate, fmtRange, parseDate, todayISO, daysSince, ago, plural, refresh, toast, quickAdd,
  openDrawer, drawerFrame, block, kv,
} from "../ui.js";
import { state, saveSetting, isOpenDeal, create, byId, personName } from "../store.js";
import { openForm } from "../form.js";
import {
  editRecord, openDeal, openPerson, openContact, dealIssues, stalledDays,
  logContact, takeDeal, finishTask, clearToConfirm,
} from "../detail.js";
import { STAGES, stageLabel } from "../schema.js";

let showAll = false;
let radarAll = false;
const TASK_LIMIT = 5;
const RADAR_LIMIT = 3;
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

// ---------- sections ----------
function section(title, action, ...body) {
  return h("section", { class: "sec" }, h("div", { class: "sec__head" }, h("h2", { class: "sec__title" }, title), action), body);
}
const smallBtn = (label, onclick) => h("button", { class: "btn btn--small", type: "button", onclick }, label);
const moreBtn = (hidden, open, toggle) => (hidden > 0 || open) &&
  h("button", { class: "more", type: "button", onclick: toggle }, open ? "Show fewer" : `+ ${hidden} more`);
// "a · b · c", where a part may be text or an element.
const dots = (parts) => parts.filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]));

// Opens a deal with the field that needs filling already under the cursor.
function openAt(id, field) {
  openDeal(id);
  const el = document.getElementById(`${field}-${id}`);
  if (el?.classList.contains("inline")) el.click(); else el?.focus();
}

// ---------- radar: the next dated events ----------
function radar() {
  const all = state.milestones.filter((m) => !m.team_id);
  const key = (m) => (parseDate(m.date) ? m.date : "9999");
  const ahead = all.filter((m) => m.status !== "done").sort((a, b) => key(a).localeCompare(key(b)));
  const done = all.filter((m) => m.status === "done").sort((a, b) => key(b).localeCompare(key(a)));
  const shown = radarAll ? ahead : ahead.slice(0, RADAR_LIMIT);
  const when = (m) => {
    const d = parseDate(m.date) ? -daysSince(m.date) : null;
    return d == null || d < 0 ? "" : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
  };
  return section(ahead.length > RADAR_LIMIT && !radarAll ? `Radar · Next ${RADAR_LIMIT}` : "Radar",
    smallBtn("Add", () => editRecord("milestones", null, { status: "upcoming", kind: "company" })),
    ahead.length
      ? h("ol", null, shown.map((m, i) => h("li", { class: "rrow" },
          h("span", { class: "rrow__n num", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
          h("button", { class: "arow__main", type: "button", onclick: () => editRecord("milestones", m) },
            h("div", { class: "rrow__title" }, m.title),
            h("div", { class: "arow__text" }, dots([m.date_label || fmtDate(m.date) || "No date", when(m)]))))))
      : h("div", { class: "muted rrow" }, "Nothing scheduled."),
    moreBtn(ahead.length - shown.length, radarAll, () => { radarAll = !radarAll; refresh(); }),
    radarAll && done.length > 0 && h("details", { class: "past" }, h("summary", null, `${done.length} done`), milestoneRows(done)));
}

// ---------- tasks: to-dos and deal follow-ups in one list ----------
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

const DEAL_TASK = {
  stalled: (d) => ({ title: `Follow up on ${d.name}`, action: ["Log contact", () => logContact("deals", d)] }),
  owner: (d) => ({ title: `Assign an owner to ${d.name}`,
    action: state.me.id ? ["Take it", () => takeDeal(d)] : ["Assign", () => openAt(d.id, "owner")] }),
  next: (d) => ({ title: `Set the next step for ${d.name}`, action: ["Add next step", () => openAt(d.id, "next")] }),
  touch: (d) => ({ title: `Log the last contact on ${d.name}`, action: ["Add date", () => openAt(d.id, "touch")] }),
  confirm: (d) => ({ title: `Confirm the details of ${d.name}`, action: ["Review", () => openDeal(d.id)], tick: () => clearToConfirm(d) }),
};

function taskItems() {
  const today = todayISO();
  const items = [];
  for (const t of state.tasks) {
    if (t.status === "done") continue;
    const overdue = Boolean(t.due && t.due < today);
    const soon = Boolean(t.due && !overdue && -daysSince(t.due) <= 7);
    if (!(t.company_wide || (state.me.id && t.owner_id === state.me.id) || overdue || soon)) continue;
    const edit = () => editRecord("tasks", t);
    items.push({
      key: "task:" + t.id, rank: overdue ? 0 : 2, sort: t.due || "9", title: t.title, open: edit, tick: () => finishTask(t),
      action: !personName(t.owner_id) && ["Assign", edit],
      meta: [personName(t.owner_id), overdue ? h("span", { class: "red" }, `Overdue since ${fmtDate(t.due)}`) : t.due && `Due ${fmtDate(t.due)}`,
        t.status === "doing" && "In progress", byId("deals", t.deal_id)?.name],
    });
  }
  for (const d of state.deals) {
    const issues = dealIssues(d);
    if (!issues.length) continue;
    const top = issues[0];
    const task = DEAL_TASK[top.key](d);
    items.push({
      key: `deal:${d.id}:${top.key}`, rank: top.key === "stalled" ? 1 : 3 + top.rank, sort: d.name, title: task.title,
      open: () => openDeal(d.id), tick: task.tick || task.action[1], action: task.action,
      meta: [d.organisation !== d.name && d.organisation, stageLabel(d.stage),
        top.key === "stalled" && h("span", { class: "red" }, top.text), ...issues.slice(1, 2).map((i) => i.text)],
    });
  }
  return items.sort((a, b) => a.rank - b.rank || a.sort.localeCompare(b.sort));
}

function tasks() {
  const hidden = snoozed();
  const all = taskItems();
  const items = all.filter((it) => !hidden[it.key]);
  const shown = showAll ? items : items.slice(0, TASK_LIMIT);
  const asleep = all.length - items.length;
  return section(`Tasks · ${items.length}`,
    asleep > 0 && h("button", { class: "more more--head", type: "button", onclick: () => setSnoozed({}) }, `${asleep} snoozed · Show`),
    h("ul", null, shown.map((it) => h("li", { class: "arow trow" },
      h("button", { class: "check", type: "button", role: "checkbox", "aria-checked": "false", "aria-label": "Done: " + it.title, onclick: it.tick }),
      h("button", { class: "arow__main", type: "button", onclick: it.open },
        h("div", { class: "arow__title" }, it.title), h("div", { class: "arow__text" }, dots(it.meta))),
      it.action && h("button", { class: "btn", type: "button", onclick: it.action[1] }, it.action[0]),
      h("button", { class: "quiet", type: "button", "aria-label": "Snooze: " + it.title, onclick: () => snooze(it.key) }, "Snooze")))),
    moreBtn(items.length - shown.length, showAll, () => { showAll = !showAll; refresh(); }),
    quickAdd("quick-todo", "Add a to-do", (title) => create("tasks", { title, status: "todo", company_wide: true, owner_id: state.me.id || null })));
}

function targets() {
  const goals = state.goals.filter((g) => !g.team_id);
  if (!goals.length) return null;
  return section("Targets", smallBtn("Add", () => editRecord("goals", null, {})), goalsList(goals));
}

function activity() {
  const tables = { deal: ["deals", openDeal], person: ["people", openPerson], contact: ["contacts", openContact] };
  const recent = [...state.activity]
    .filter((a) => tables[a.entity_type] && byId(tables[a.entity_type][0], a.entity_id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 6);
  if (!recent.length) return null;
  return section("Recent", null, h("ul", null, recent.map((a) => {
    const [table, open] = tables[a.entity_type];
    const rec = byId(table, a.entity_id);
    return h("li", { class: "arow" },
      h("button", { class: "arow__main", type: "button", onclick: () => open(rec.id) },
        h("div", { class: "arow__title" }, rec.name), h("div", { class: "arow__text" }, a.body)),
      h("span", { class: "days" }, [a.author, ago(a.created_at)].filter(Boolean).join(" · ")));
  })));
}

// The pipeline in three lines: deals by stage, what's stalled, and the estimate
// with how many deals it rests on. The full view is the Deal Tracker.
function pipeline() {
  if (!state.deals.length) return null;
  const open = state.deals.filter(isOpenDeal);
  const sized = open.filter((d) => d.size_low != null || d.size_high != null);
  const lo = sized.reduce((t, d) => t + (d.size_low ?? d.size_high), 0);
  const hi = sized.reduce((t, d) => t + (d.size_high ?? d.size_low), 0);
  const stalled = open.filter((d) => stalledDays(d) != null).length;
  return section("Pipeline", h("a", { class: "link small", href: "#deals" }, "Open"),
    h("ul", null, STAGES.map((s) => {
      const n = state.deals.filter((d) => (d.stage || "lead") === s.value).length;
      return n > 0 && h("li", { class: "arow arow--tight" }, h("span", { class: "dot c-" + s.value }), h("span", { class: "arow__main" }, s.label), h("span", { class: "num" }, n));
    })),
    (stalled > 0 || sized.length > 0) && h("div", { class: "small muted pipe__foot" },
      stalled > 0 && h("span", { class: "stalled" }, `${stalled} stalled`),
      sized.length > 0 && h("span", null, `${fmtRange(lo, hi)} estimated, on ${sized.length} of ${plural(open.length, "open deal")}`)));
}

function team() {
  if (!state.people.length) return null;
  return section("Team", h("a", { class: "link small", href: "#people" }, "All"),
    h("ul", null, [...state.people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => h("li", { class: "arow" },
      avatar(p.name, "s"),
      h("button", { class: "arow__main", type: "button", onclick: () => openPerson(p.id) },
        h("div", { class: "arow__title" }, p.name),
        h("div", { class: "arow__text" }, p.focus || "No update yet"))))));
}

// A short checklist that disappears once the hub is filled in.
function setup() {
  const steps = [
    [state.goals.some((g) => !g.team_id), "Set company targets", () => editRecord("goals", null, {})],
    [(state.settings.values || []).length > 0, "Write the values", editCompany],
    [state.teams.length > 0, "Set up teams", () => editRecord("teams", null)],
    [state.people.length > 0 && state.people.every((p) => p.focus), "Add what each person is working on", () => { location.hash = "people"; }],
    [state.people.length > 0 && state.people.every((p) => p.email), "Add everyone's email", () => { location.hash = "people"; }],
  ];
  const left = steps.filter((s) => !s[0]);
  if (!left.length) return null;
  return section(`Set up · ${steps.length - left.length} of ${steps.length}`, null,
    h("ul", null, steps.map(([done, label, go]) => h("li", { class: "arow" + (done ? " done" : "") },
      h("span", { class: "check", "aria-hidden": "true", "aria-checked": String(Boolean(done)) }),
      done ? h("span", { class: "arow__main row__title" }, label)
        : h("button", { class: "arow__main", type: "button", onclick: go }, h("div", { class: "arow__title" }, label))))));
}

function greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (state.me.name || "").split(" ")[0];
  return (first ? `${part}, ${first}` : part) + ".";
}

export function render() {
  const mission = state.settings.mission;
  return h("main", { class: "page page--home" },
    h("div", { class: "page-head__text" },
      h("h1", { class: "h1" }, greeting()),
      h("button", { class: "missionline", type: "button", onclick: openAbout, title: "Mission, values and what we sell" }, mission || "Write the mission")),
    radar(), tasks(), activity(), targets(), pipeline(), team(), setup());
}
