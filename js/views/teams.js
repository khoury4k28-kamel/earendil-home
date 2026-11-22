// Teams: the corporate structure as a top-down chart, then a list of each
// person, then each team's lead, members, strategy, goals, milestones and
// tasks. Pressing a person opens their panel, so there is no People page.

import { h, avatar, kv, panel, refresh, inlineEdit, quickAdd } from "../ui.js";
import { personPlace } from "../places.js";
import { showTeamOnMap } from "./map.js";
import { state, sortByName, byId, update, create, teamName, dealsForPerson, tasksForPerson } from "../store.js";
import { editRecord, addBtn, personChip, openPerson, taskList, pickPerson } from "../detail.js";
import { goalsList, milestoneRows } from "./home.js";

let editingLines = false;

// One box in the chart: who they are and their title. Pressing it opens their panel.
function node(p) {
  return h("button", { class: "onode", type: "button", onclick: () => openPerson(p.id) },
    avatar(p.name), h("b", null, p.name), p.title && h("span", { class: "onode__title" }, p.title));
}
function branch(p, seen) {
  if (seen.has(p.id)) return null;
  seen.add(p.id);
  const kids = sortByName(state.people.filter((x) => x.reports_to === p.id));
  return h("li", null, node(p), kids.length > 0 && h("ul", null, kids.map((k) => branch(k, seen))));
}
const hasLines = () => state.people.some((p) => p.reports_to && byId("people", p.reports_to));

function reportingLines() {
  const people = sortByName(state.people);
  if (editingLines || !hasLines()) {
    return h("ul", { class: "rows" }, people.map((p) => h("li", { class: "row row--line" },
      h("span", { class: "row__main" }, personChip(p.id)),
      h("span", { class: "muted small" }, "reports to"),
      pickPerson({ value: p.reports_to, blank: "Nobody", exclude: p.id, label: `${p.name} reports to`,
        onChange: (v) => { editingLines = true; update("people", p.id, { reports_to: v }); } }))));
  }
  const seen = new Set();
  const roots = people.filter((p) => !p.reports_to || !byId("people", p.reports_to));
  // If the lines loop back on themselves nobody is at the top, so start from everyone.
  // Top down: each person sits above the people who report to them.
  return h("div", { class: "org-wrap" }, h("ul", { class: "org" }, (roots.length ? roots : people).map((r) => branch(r, seen))));
}

// Everyone, one row each, always with the same four columns after the name:
// working on, where they are, open tasks, deals. An empty one shows a dash.
const PEOPLE_COLS = ["Working on", "Location", "Open tasks", "Deals"];
function personRow(p) {
  const place = personPlace(p);
  const open = tasksForPerson(p.id).filter((t) => t.status !== "done").length;
  const deals = dealsForPerson(p.id).length;
  const cell = (label, value, cls) => h("span", { class: "prow__cell" + (cls ? " " + cls : "") + (value ? "" : " prow__cell--none"), "data-label": label }, value || "–");
  return h("li", null, h("button", { class: "prow", type: "button", onclick: () => openPerson(p.id) },
    avatar(p.name),
    h("span", { class: "prow__who" }, h("b", null, p.name), h("span", { class: "small sub" }, [p.title, teamName(p.team_id)].filter(Boolean).join(" · "))),
    cell(PEOPLE_COLS[0], p.focus),
    cell(PEOPLE_COLS[1], place.text && h("span", { class: "prow__where" },
      h("span", { class: "pin" + (place.live ? " pin--live" : ""), title: place.live ? "From the time zone of their last sign-in" : "Typed in by hand" }), place.text)),
    cell(PEOPLE_COLS[2], String(open), "num"),
    cell(PEOPLE_COLS[3], String(deals), "num")));
}
const peopleHead = () => h("div", { class: "prow prow--head", "aria-hidden": "true" },
  h("span", null), h("span", null, "Name"), PEOPLE_COLS.map((c, i) => h("span", { class: i > 1 ? "num" : null }, c)));

function teamPanel(t) {
  const members = sortByName(state.people.filter((p) => p.team_id === t.id));
  const others = sortByName(state.people.filter((p) => p.team_id !== t.id));
  const goals = state.goals.filter((g) => g.team_id === t.id);
  const milestones = state.milestones.filter((m) => m.team_id === t.id).sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9")));
  const tasks = state.tasks.filter((x) => x.team_id === t.id);
  const addMember = h("select", { class: "pick pick--empty", "aria-label": `Add a member to ${t.name}` },
    h("option", { value: "" }, "Add member"), others.map((p) => h("option", { value: p.id }, p.name)));
  addMember.addEventListener("change", () => addMember.value && update("people", addMember.value, { team_id: t.id }));
  const p = panel(t.name, h("button", { class: "btn btn--small", type: "button", onclick: () => editRecord("teams", t) }, "Edit"),
    kv([
      ["Lead", pickPerson({ value: t.lead_id, blank: "No lead yet", label: `Lead of ${t.name}`, onChange: (v) => update("teams", t.id, { lead_id: v }) })],
      ["Members", h("div", { class: "chips" }, members.map((m) => personChip(m.id)), others.length > 0 && addMember)],
      ["Strategy", inlineEdit({ id: `strategy-${t.id}`, value: t.strategy, placeholder: "Add the strategy", label: `Strategy of ${t.name}`, multiline: true,
        onSave: (v) => update("teams", t.id, { strategy: v }) })],
    ]),
    goals.length > 0 && h("div", { class: "block" }, h("div", { class: "caps" }, "Goals"), goalsList(goals)),
    milestones.length > 0 && h("div", { class: "block" }, h("div", { class: "caps" }, "Milestones"), milestoneRows(milestones)),
    h("div", { class: "block" },
      tasks.length > 0 && h("div", { class: "caps" }, `Tasks · ${tasks.filter((x) => x.status !== "done").length} open`),
      taskList(tasks),
      quickAdd(`task-team-${t.id}`, "Add a task", (title) => create("tasks", { title, status: "todo", team_id: t.id }))),
    h("div", { class: "actions" },
      addBtn("Add goal", "goals", { team_id: t.id }),
      addBtn("Add milestone", "milestones", { team_id: t.id, status: "upcoming", kind: "company" })));
  p.classList.add("span-6");
  return p;
}

export function render() {
  const teams = sortByName(state.teams);
  const unassigned = sortByName(state.people.filter((p) => !p.team_id || !byId("teams", p.team_id)));
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("h1", { class: "h1" }, "Teams"),
      h("div", { class: "actions" },
        state.people.some((p) => personPlace(p).located) && h("a", { class: "btn", href: "#crm/map", onclick: () => showTeamOnMap() }, "See on the map"),
        h("button", { class: "btn", type: "button", onclick: () => editRecord("people", null) }, "Add person"),
        h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("teams", null) }, "Add team"))),
    state.people.length === 0 && h("div", { class: "sec" }, quickAdd("new-person", "Name the first team member", (name) => create("people", { name }))),
    state.people.length > 0 && panel("Corporate structure",
      hasLines() && h("button", { class: "btn btn--small", type: "button", onclick: () => { editingLines = !editingLines; refresh(); } }, editingLines ? "Done" : "Edit"),
      reportingLines()),
    state.people.length > 0 && panel(`People · ${state.people.length}`, null,
      peopleHead(), h("ul", { class: "prows" }, sortByName(state.people).map(personRow))),
    teams.length
      ? h("div", { class: "grid" }, teams.map(teamPanel))
      : h("div", { class: "sec" }, quickAdd("new-team", "Name the first team", (name) => create("teams", { name }))),
    teams.length > 0 && unassigned.length > 0 && panel(`Not in a team yet · ${unassigned.length}`, null,
      h("div", { class: "chips" }, unassigned.map((p) => personChip(p.id)))));
}
