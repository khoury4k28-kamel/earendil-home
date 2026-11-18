// Home: the company-wide page. Mission and who we are, values, targets,
// milestones to 2027, company to-dos, and where the deals stand.

import { h, panel, emptyState, fmtDate, parseDate, plural, todayISO } from "../ui.js";
import { state, saveSetting, isOpenDeal } from "../store.js";
import { openForm } from "../form.js";
import { STAGES } from "../schema.js";
import { editRecord, addBtn, taskList, openDeal } from "../detail.js";

function editCompany() {
  const s = state.settings;
  openForm({
    title: "Edit mission and who we are",
    record: { mission: s.mission, tagline: s.tagline, about: s.about, values: s.values || [] },
    fields: [
      { key: "mission", label: "Mission statement", type: "textarea", required: true },
      { key: "tagline", label: "Line", wide: true },
      { key: "about", label: "Who we are", type: "textarea" },
      { key: "values", label: "Values", type: "lines", placeholder: "One value per line", hint: "One per line. A short phrase, then what it means in practice." },
    ],
    onSave: async (v) => {
      for (const key of ["mission", "tagline", "about", "values"]) {
        if (JSON.stringify(v[key]) !== JSON.stringify(s[key] ?? null)) await saveSetting(key, v[key]);
      }
    },
  });
}

function greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (state.me.name || "").split(" ")[0];
  return first ? `${part}, ${first}.` : `${part}.`;
}

function missionBlock() {
  const s = state.settings;
  return h("section", { class: "mission span-8" },
    h("div", { class: "page-head" }, h("div", { class: "eyebrow" }, "Our mission"),
      h("button", { class: "btn btn--small", type: "button", onclick: editCompany }, "Edit")),
    s.mission ? h("p", { class: "mission__line" }, s.mission) : emptyState("No mission statement yet.", "", null),
    s.tagline && h("p", { class: "mission__tag" }, s.tagline),
    s.about && h("p", { class: "mission__about" }, s.about),
    (s.facts || []).length > 0 && h("div", { class: "facts" }, s.facts.map((f) =>
      h("div", { class: "fact" }, h("div", { class: "eyebrow" }, f.label), h("div", { class: "fact__v" }, f.value)))));
}

function dealsBlock() {
  const done = state.deals.filter((d) => !isOpenDeal(d));
  const max = Math.max(1, ...STAGES.map((s) => state.deals.filter((d) => d.stage === s.value).length));
  return h("section", { class: "panel panel--grey span-4" },
    h("div", { class: "panel__head" }, h("h2", { class: "eyebrow" }, "Deals"),
      h("a", { class: "link small", href: "#deals" }, "Open Deal Tracker")),
    h("div", { class: "panel__body" },
      h("div", null,
        h("div", { class: "bignum" }, done.length),
        h("div", { class: "caps" }, "Signed or closed"),
        h("div", { class: "small sub" }, done.length
          ? ["With ", done.map((d, i) => [i > 0 && ", ", h("button", { class: "link", type: "button", onclick: () => openDeal(d.id) }, d.organisation || d.name)])]
          : "Nothing signed yet.")),
      h("div", { class: "stagebars" }, STAGES.map((s) => {
        const n = state.deals.filter((d) => d.stage === s.value).length;
        return h("div", { class: "stagebar" + (s.value === "signed" || s.value === "closed" ? " stagebar--done" : "") },
          h("span", null, s.label),
          h("span", { class: "stagebar__track" }, h("span", { class: "stagebar__fill", style: `display:block;width:${(n / max) * 100}%` })),
          h("span", { class: "num", style: "text-align:right" }, n));
      }))));
}

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

function targetsBlock() {
  const goals = state.goals.filter((g) => !g.team_id);
  const p = panel("Company targets", addBtn("Add target", "goals", {}),
    goals.length ? goalsList(goals) : emptyState("No targets set yet.", "Add the numbers the whole company is working toward: revenue, units, deals signed, sites trained.", null));
  p.classList.add("span-8");
  return p;
}

function todosBlock() {
  const tasks = state.tasks.filter((t) => t.company_wide);
  const open = tasks.filter((t) => t.status !== "done").length;
  const p = panel(`Company to-dos · ${open} open`, addBtn("Add", "tasks", { company_wide: true, status: "todo" }),
    taskList(tasks, { empty: "Nothing on the company list." }));
  p.classList.add("span-4");
  return p;
}

export function milestoneRows(list) {
  return h("ul", { class: "rows" }, list.map((m) => h("li", { class: "row" },
    h("span", { class: "row__date" }, m.date_label || fmtDate(m.date) || "No date"),
    h("button", { class: "row__main rowbtn", type: "button", onclick: () => editRecord("milestones", m) },
      h("div", { class: "row__title" }, h("span", { class: "sq" + (m.status === "done" ? "" : " sq--open") }), m.title)),
    m.kind === "external" && h("span", { class: "tag", title: "An outside event we track" }, "Outside"))));
}

function milestonesBlock() {
  const all = state.milestones.filter((m) => !m.team_id);
  const key = (m) => (parseDate(m.date) ? m.date : "9999");
  const upcoming = all.filter((m) => m.status !== "done").sort((a, b) => key(a).localeCompare(key(b)));
  const done = all.filter((m) => m.status === "done").sort((a, b) => key(b).localeCompare(key(a)));
  const p = panel("Milestones and roadmap", addBtn("Add milestone", "milestones", { status: "upcoming", kind: "company" }),
    h("div", { class: "two-col" },
      h("div", { class: "block" }, h("div", { class: "caps" }, `Ahead · ${upcoming.length}`),
        upcoming.length ? milestoneRows(upcoming) : h("div", { class: "muted small" }, "Nothing on the roadmap yet.")),
      h("div", { class: "block" }, h("div", { class: "caps" }, `Done · ${done.length}`),
        done.length ? milestoneRows(done) : h("div", { class: "muted small" }, "Nothing marked done yet."))));
  p.classList.add("span-8");
  return p;
}

function valuesBlock() {
  const values = state.settings.values || [];
  const p = panel("Our values", h("button", { class: "btn btn--small", type: "button", onclick: editCompany }, values.length ? "Edit" : "Add"),
    values.length
      ? h("ul", { class: "rows" }, values.map((v) => h("li", { class: "row" }, h("span", { class: "row__title" }, h("span", { class: "sq" }), v))))
      : emptyState("Not written yet.", "Add the handful of values the team works by.", null));
  p.classList.add("span-4");
  return p;
}

function productsBlock() {
  const products = state.settings.products || [];
  const regions = state.settings.regions || [];
  if (!products.length && !regions.length) return null;
  const groups = ["Train", "Detect", "Intercept"];
  const p = panel("What we sell, and where", null,
    h("div", { class: "prod-rows" },
      groups.map((g) => {
        const list = products.filter((x) => x.group === g);
        return list.length ? h("div", { class: "prod-row" }, h("div", { class: "caps" }, g),
          h("div", { class: "prod-list" }, list.map((x) => h("div", null,
            h("div", { class: "prod__name" }, x.name), h("div", { class: "small sub" }, x.note))))) : null;
      }),
      regions.length > 0 && h("div", { class: "prod-row" }, h("div", { class: "caps" }, "Regions"),
        h("div", { class: "prod-list" }, regions.map((r) => h("div", null,
          h("div", { class: "prod__name" }, r.name), h("div", { class: "small sub" }, r.note)))))));
  p.classList.add("span-12");
  return p;
}

export function render() {
  const openDeals = state.deals.filter(isOpenDeal).length;
  const openTodos = state.tasks.filter((t) => t.company_wide && t.status !== "done").length;
  const next = state.milestones
    .filter((m) => m.status !== "done" && m.date && m.date >= todayISO())
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return h("main", { class: "page" },
    h("div", { class: "page-head" }, h("div", { class: "page-head__text" },
      h("h1", { class: "h1" }, greeting()),
      h("div", { class: "sub" }, [
        plural(openDeals, "open deal"),
        plural(openTodos, "company to-do") + " open",
        next && `Next up: ${next.title} (${next.date_label || fmtDate(next.date)})`,
      ].filter(Boolean).join(" · ")))),
    h("div", { class: "grid" }, missionBlock(), dealsBlock(), targetsBlock(), todosBlock(), milestonesBlock(), valuesBlock(), productsBlock()));
}
