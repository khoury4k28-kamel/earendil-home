// Teams: who reports to whom, then each team's lead, members, strategy,
// goals, milestones and tasks. Lines, leads and members are set in place.

import { h, avatar, kv, panel, refresh, inlineEdit, quickAdd } from "../ui.js";
import { state, sortByName, byId, update, create } from "../store.js";
import { editRecord, addBtn, personChip, openPerson, taskList, pickPerson } from "../detail.js";
import { goalsList, milestoneRows } from "./home.js";

let editingLines = false;

function node(p) {
  return h("button", { class: "node", type: "button", onclick: () => openPerson(p.id) },
    avatar(p.name, "s"), h("span", null, h("b", null, p.name), p.title ? " · " + p.title : ""));
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
  return h("ul", { class: "tree" }, (roots.length ? roots : people).map((r) => branch(r, seen)));
}

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
      h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("teams", null) }, "Add team")),
    state.people.length > 0 && panel("Who reports to whom",
      hasLines() && h("button", { class: "btn btn--small", type: "button", onclick: () => { editingLines = !editingLines; refresh(); } }, editingLines ? "Done" : "Edit"),
      reportingLines()),
    teams.length
      ? h("div", { class: "grid" }, teams.map(teamPanel))
      : h("div", { class: "sec" }, quickAdd("new-team", "Name the first team", (name) => create("teams", { name }))),
    teams.length > 0 && unassigned.length > 0 && panel(`Not in a team yet · ${unassigned.length}`, null,
      h("div", { class: "chips" }, unassigned.map((p) => personChip(p.id)))));
}
