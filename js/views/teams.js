// Teams: who reports to whom, then each team's strategy, goals, milestones
// and tasks.

import { h, avatar, emptyState, kv, plural, panel } from "../ui.js";
import { state, sortByName, byId } from "../store.js";
import { editRecord, addBtn, personChip, openPerson, taskList } from "../detail.js";
import { goalsList, milestoneRows } from "./home.js";

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
function reportingLines() {
  const people = state.people;
  if (!people.length) return h("div", { class: "muted small" }, "Add people first.");
  const anyLine = people.some((p) => p.reports_to && byId("people", p.reports_to));
  if (!anyLine) {
    return [
      h("div", { class: "chips" }, sortByName(people).map((p) => personChip(p.id))),
      h("div", { class: "small sub" }, "No reporting lines set yet. Open a person, choose Edit, and fill in “Reports to” to draw the chart."),
    ];
  }
  const seen = new Set();
  const roots = sortByName(people.filter((p) => !p.reports_to || !byId("people", p.reports_to)));
  return h("ul", { class: "tree" }, roots.map((r) => branch(r, seen)));
}

function teamPanel(t) {
  const members = sortByName(state.people.filter((p) => p.team_id === t.id));
  const goals = state.goals.filter((g) => g.team_id === t.id);
  const milestones = state.milestones.filter((m) => m.team_id === t.id).sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9")));
  const tasks = state.tasks.filter((x) => x.team_id === t.id);
  const p = panel(t.name, h("button", { class: "btn btn--small", type: "button", onclick: () => editRecord("teams", t) }, "Edit"),
    kv([
      ["Lead", t.lead_id ? personChip(t.lead_id) : h("span", { class: "muted" }, "No lead yet")],
      ["Members", members.length ? h("div", { class: "chips" }, members.map((m) => personChip(m.id))) : h("span", { class: "muted" }, "Nobody yet. Set a person's team from their profile.")],
    ]),
    h("div", { class: "block" }, h("div", { class: "caps" }, "Strategy"),
      t.strategy ? h("div", { class: "prose" }, t.strategy) : h("div", { class: "muted small" }, "Not written yet.")),
    h("div", { class: "block" }, h("div", { class: "page-head" }, h("div", { class: "caps" }, "Goals"), addBtn("Add goal", "goals", { team_id: t.id })),
      goalsList(goals, "No goals yet.")),
    h("div", { class: "block" }, h("div", { class: "page-head" }, h("div", { class: "caps" }, "Milestones"), addBtn("Add milestone", "milestones", { team_id: t.id, status: "upcoming", kind: "company" })),
      milestones.length ? milestoneRows(milestones) : h("div", { class: "muted small" }, "No milestones yet.")),
    h("div", { class: "block" }, h("div", { class: "page-head" }, h("div", { class: "caps" }, `Tasks · ${tasks.filter((x) => x.status !== "done").length} open`), addBtn("Add task", "tasks", { team_id: t.id, status: "todo" })),
      taskList(tasks)));
  p.classList.add("span-6");
  return p;
}

export function render() {
  const teams = sortByName(state.teams);
  const unassigned = sortByName(state.people.filter((p) => !p.team_id || !byId("teams", p.team_id)));
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "page-head__text" }, h("h1", { class: "h1" }, "Teams"),
        h("div", { class: "sub" }, `${plural(teams.length, "team")}. Each team sets its strategy and logs its goals, milestones and tasks here.`)),
      h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("teams", null) }, "Add team")),
    panel("Who reports to whom", null, reportingLines()),
    teams.length
      ? h("div", { class: "grid" }, teams.map(teamPanel))
      : emptyState("No teams yet.", "Add the first team, then put people in it from their profile.",
          h("button", { class: "btn", type: "button", onclick: () => editRecord("teams", null) }, "Add the first team")),
    teams.length > 0 && unassigned.length > 0 && panel(`Not in a team yet · ${unassigned.length}`, null,
      h("div", { class: "chips" }, unassigned.map((p) => personChip(p.id)))));
}
