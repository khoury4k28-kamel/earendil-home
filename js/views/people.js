// People: one card per team member, with what they are working on now.

import { h, avatar, plural, quickAdd, ago } from "../ui.js";
import { state, create, sortByName, teamName, dealsForPerson, tasksForPerson } from "../store.js";
import { editRecord, openPerson } from "../detail.js";
import { personPlace } from "../places.js";
import { showTeamOnMap } from "./map.js";

function card(p) {
  const place = personPlace(p);
  const open = tasksForPerson(p.id).filter((t) => t.status !== "done").length;
  const deals = dealsForPerson(p.id).length;
  const foot = [teamName(p.team_id), open && plural(open, "open task"), deals && plural(deals, "deal")].filter(Boolean);
  return h("button", { class: "card", type: "button", onclick: () => openPerson(p.id) },
    h("div", { class: "card__top" }, avatar(p.name),
      h("div", { style: "min-width:0" }, h("div", { class: "h3" }, p.name), h("div", { class: "small sub" }, p.title))),
    h("div", { class: "card__body" },
      place.text && h("div", { class: "where" }, h("span", { class: "pin" + (place.live ? " pin--live" : ""), title: place.live ? "From the time zone of their last sign-in" : "Typed in by hand" }),
        h("span", null, place.text, place.live && p.seen_at && h("span", { class: "muted" }, " · seen " + ago(p.seen_at)))),
      p.focus ? h("div", null, p.focus) : h("div", { class: "muted" }, "No update yet")),
    foot.length > 0 && h("div", { class: "card__foot" }, foot.map((f) => h("span", null, f))));
}

export function render() {
  const people = sortByName(state.people);
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("h1", { class: "h1" }, "People"),
      h("div", { class: "actions" },
        people.some((p) => personPlace(p).located) && h("a", { class: "btn", href: "#crm/map", onclick: () => showTeamOnMap() }, "See on the map"),
        h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("people", null) }, "Add person"))),
    people.length
      ? h("div", { class: "cards" }, people.map(card))
      : h("div", { class: "sec" }, quickAdd("new-person", "Name the first team member", (name) => create("people", { name }))),
    h("div", { class: "small muted" }, h("span", { class: "sq sq--open" }), "Location comes from each person's time zone when they sign in. Slack, email and Granola aren't connected yet."));
}
