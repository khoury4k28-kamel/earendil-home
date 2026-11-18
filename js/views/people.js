// People: one card per team member, with what they are working on now.

import { h, avatar, emptyState, plural } from "../ui.js";
import { state, sortByName, teamName, dealsForPerson, tasksForPerson } from "../store.js";
import { editRecord, openPerson } from "../detail.js";

function card(p) {
  const open = tasksForPerson(p.id).filter((t) => t.status !== "done").length;
  const deals = dealsForPerson(p.id).length;
  const foot = [teamName(p.team_id), open && plural(open, "open task"), deals && plural(deals, "deal")].filter(Boolean);
  return h("button", { class: "card", type: "button", onclick: () => openPerson(p.id) },
    h("div", { class: "card__top" }, avatar(p.name),
      h("div", { style: "min-width:0" }, h("div", { class: "h3" }, p.name), h("div", { class: "small sub" }, p.title))),
    h("div", { class: "card__body" }, p.focus ? h("div", null, p.focus) : h("div", { class: "muted" }, "No update yet")),
    foot.length > 0 && h("div", { class: "card__foot" }, foot.map((f) => h("span", null, f))));
}

export function render() {
  const people = sortByName(state.people);
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("h1", { class: "h1" }, "People"),
      h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("people", null) }, "Add person")),
    people.length
      ? h("div", { class: "cards" }, people.map(card))
      : emptyState("Nobody here yet.", "", null),
    h("div", { class: "small muted" }, h("span", { class: "sq sq--open" }), "Slack, email and Granola aren't connected yet. Updates are typed in by hand."));
}
