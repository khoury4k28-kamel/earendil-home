// People: one card per team member. What they do, what they're working on,
// and whether their Slack, email and Granola are feeding the profile.

import { h, avatar, emptyState, plural, panel } from "../ui.js";
import { state, sortByName, teamName, dealsForPerson, tasksForPerson } from "../store.js";
import { SOURCES } from "../schema.js";
import { editRecord, openPerson } from "../detail.js";

function card(p) {
  const open = tasksForPerson(p.id).filter((t) => t.status !== "done").length;
  const deals = dealsForPerson(p.id).length;
  return h("button", { class: "card", type: "button", onclick: () => openPerson(p.id) },
    h("div", { class: "card__top" }, avatar(p.name),
      h("div", { style: "min-width:0" }, h("div", { class: "h3" }, p.name), h("div", { class: "small sub" }, p.title || "Role not set"))),
    h("div", { class: "card__body" },
      h("div", { class: "eyebrow" }, "Working on now"),
      p.focus ? h("div", null, p.focus) : h("div", { class: "muted" }, "Not filled in yet."),
      p.responsibilities && h("div", { class: "small sub" }, p.responsibilities)),
    h("div", { class: "card__foot" },
      h("span", null, teamName(p.team_id) || "No team yet"),
      h("span", null, plural(open, "open task")),
      h("span", null, plural(deals, "deal"))));
}

export function render() {
  const people = sortByName(state.people);
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "page-head__text" }, h("h1", { class: "h1" }, "People"),
        h("div", { class: "sub" }, `${plural(people.length, "team member")}. Who does what, and what each person is working on.`)),
      h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("people", null) }, "Add person")),
    people.length
      ? h("div", { class: "cards" }, people.map(card))
      : emptyState("Nobody here yet.", "Add the first team member.", null),
    panel("Where profiles get their information", null,
      h("div", { class: "sources" }, SOURCES.map((s) => h("div", { class: "source" },
        h("div", { class: "caps" }, s), h("div", { class: "small muted" }, h("span", { class: "sq sq--open" }), "Not connected")))),
      h("div", { class: "small sub" }, "The plan is for each person's Slack, email and Granola notes to keep their profile current. Those feeds aren't live in this version, so profiles are filled in by hand for now.")));
}
