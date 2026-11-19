// Home: what needs doing today. A pipeline strip, the things that need
// attention with one-click actions, to-dos, what's coming up and what each
// person is on. Company reference (mission, values, products) is one click away.

import {
  h, avatar, fmtDate, parseDate, todayISO, todayLabel, daysSince, ago, refresh, quickAdd,
  openDrawer, drawerFrame, block, kv,
} from "../ui.js";
import { state, saveSetting, isOpenDeal, create, byId } from "../store.js";
import { openForm } from "../form.js";
import { editRecord, taskList, openDeal, openPerson, openContact, dealIssues, logContact, takeDeal, finishTask } from "../detail.js";
import { summary as pipeline } from "./deals.js";

let showAll = false;
const ATTENTION_LIMIT = 6;

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

// Opens a deal with the field that needs filling already under the cursor.
function openAt(id, field) {
  openDeal(id);
  const el = document.getElementById(`${field}-${id}`);
  if (field === "next") el?.click(); else el?.focus();
}

function attentionItems() {
  const today = todayISO();
  const items = [];
  for (const t of state.tasks) {
    if (t.status === "done" || !t.due) continue;
    const overdue = t.due < today;
    if (!overdue && -daysSince(t.due) > 7) continue;
    items.push({
      rank: overdue ? 0 : 4, red: overdue, title: t.title,
      text: overdue ? `Overdue since ${fmtDate(t.due)}` : `Due ${fmtDate(t.due)}`,
      open: () => editRecord("tasks", t),
      action: ["Done", () => finishTask(t)],
    });
  }
  for (const d of state.deals) {
    const issues = dealIssues(d);
    if (!issues.length) continue;
    const top = issues[0];
    const action =
      top.key === "stalled" || top.key === "touch" ? ["Log contact today", () => logContact("deals", d)]
      : top.key === "owner" ? (state.me.id ? ["Take it", () => takeDeal(d)] : ["Assign", () => openAt(d.id, "owner")])
      : top.key === "next" ? ["Add next step", () => openAt(d.id, "next")]
      : ["Review", () => openDeal(d.id)];
    items.push({ rank: 1 + top.rank, red: top.key === "stalled", title: d.name, text: issues.slice(0, 2).map((i) => i.text).join(" · "), open: () => openDeal(d.id), action });
  }
  return items.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

function attention() {
  const items = attentionItems();
  if (!items.length) return section("Needs attention", null, h("div", { class: "muted" }, "Nothing right now."));
  const shown = showAll ? items : items.slice(0, ATTENTION_LIMIT);
  return section(`Needs attention · ${items.length}`,
    items.length > ATTENTION_LIMIT && h("button", { class: "link small", type: "button", onclick: () => { showAll = !showAll; refresh(); } }, showAll ? "Show fewer" : "Show all"),
    h("ul", null, shown.map((it) => h("li", { class: "arow" },
      h("span", { class: "adot" + (it.red ? " adot--red" : "") }),
      h("button", { class: "arow__main", type: "button", onclick: it.open },
        h("div", { class: "arow__title" }, it.title), h("div", { class: "arow__text" }, it.text)),
      smallBtn(it.action[0], it.action[1])))));
}

function todos() {
  const tasks = state.tasks.filter((t) => t.company_wide || (state.me.id && t.owner_id === state.me.id));
  const open = tasks.filter((t) => t.status !== "done").length;
  return section(`To-dos · ${open}`, null,
    taskList(tasks),
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

function comingUp() {
  const all = state.milestones.filter((m) => !m.team_id);
  const key = (m) => (parseDate(m.date) ? m.date : "9999");
  const ahead = all.filter((m) => m.status !== "done").sort((a, b) => key(a).localeCompare(key(b)));
  const done = all.filter((m) => m.status === "done").sort((a, b) => key(b).localeCompare(key(a)));
  return section("Coming up", smallBtn("Add", () => editRecord("milestones", null, { status: "upcoming", kind: "company" })),
    ahead.length ? milestoneRows(ahead) : h("div", { class: "muted small" }, "Nothing scheduled."),
    done.length > 0 && h("details", { class: "past" }, h("summary", null, `${done.length} done`), milestoneRows(done)));
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
  return first ? `${part}, ${first}` : part;
}

export function render() {
  const mission = state.settings.mission;
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "page-head__text" },
        h("h1", { class: "h1" }, greeting()),
        h("button", { class: "missionline", type: "button", onclick: openAbout, title: "Mission, values and what we sell" }, mission || "Write the mission")),
      h("span", { class: "top__date" }, todayLabel())),
    state.deals.some(isOpenDeal) && h("a", { class: "striplink", href: "#deals", "aria-label": "Open the Deal Tracker" }, pipeline()),
    h("div", { class: "cols" },
      h("div", { class: "stack" }, attention(), todos(), targets(), activity()),
      h("div", { class: "stack" }, comingUp(), team(), setup())));
}
