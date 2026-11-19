// CRM: every client and contact. It opens on two cards (the map and the
// list). In the list, tick rows to copy their addresses or open one email to
// all of them.

import { h, fmtDate, plural, refresh, toast, inlineEdit } from "../ui.js";
import { state, update, dealsForContact, dealsForPerson, sortByName } from "../store.js";
import { CATEGORIES, categoryLabel } from "../schema.js";
import { editRecord, openContact, openPerson, pickPerson } from "../detail.js";
import { findCountry } from "../places.js";
import * as map from "./map.js";

let filter = "all";
let query = "";
const selected = new Set();

// Team members come from People, so nobody is typed in twice.
function rows() {
  const team = state.people.map((p) => ({
    key: "p:" + p.id, id: p.id, isTeam: true, name: p.name, title: p.title, organisation: "Earendil Robotics",
    category: "team", status: "", email: p.email, owner_id: null, last_touch: null, deals: dealsForPerson(p.id).length,
    hay: [p.name, p.title, p.location].join(" "),
  }));
  const contacts = state.contacts.map((c) => ({
    key: "c:" + c.id, id: c.id, isTeam: false, name: c.name, title: c.title, organisation: c.organisation,
    category: c.category, status: c.status, email: c.email, owner_id: c.owner_id, last_touch: c.last_touch,
    deals: dealsForContact(c.id).length, hay: [c.name, c.title, c.organisation, c.country, c.notes].join(" "),
  }));
  return [...contacts, ...team].sort((a, b) => a.name.localeCompare(b.name));
}

function emails(all) {
  return [...new Set(all.filter((r) => selected.has(r.key) && r.email).map((r) => r.email.trim()))];
}

async function copyEmails(list) {
  try {
    await navigator.clipboard.writeText(list.join(", "));
    toast(`Copied ${plural(list.length, "address", "addresses")}.`);
  } catch {
    toast("Couldn't copy. Use “Open in mail app” instead.");
  }
}

function selectionBar(all) {
  const count = all.filter((r) => selected.has(r.key)).length;
  if (!count) return null;
  const list = emails(all);
  const missing = count - all.filter((r) => selected.has(r.key) && r.email).length;
  return h("div", { class: "selbar" },
    h("div", null, h("b", null, `${count} selected`), ` · ${plural(list.length, "email address", "email addresses")}`,
      missing > 0 && ` · ${missing} without an email`),
    h("div", { class: "actions" },
      h("button", { class: "btn btn--small", type: "button", disabled: !list.length, onclick: () => copyEmails(list) }, "Copy emails"),
      h("a", { class: "btn btn--small", href: list.length ? "mailto:?bcc=" + encodeURIComponent(list.join(",")) : null, "aria-disabled": String(!list.length) }, "Open in mail app"),
      h("button", { class: "btn btn--small", type: "button", onclick: () => { selected.clear(); refresh(); } }, "Clear")));
}

function check(checked, label, onchange) {
  const box = h("input", { type: "checkbox", "aria-label": label, checked, style: "width:17px;height:17px;accent-color:#0B0E10" });
  box.addEventListener("click", (e) => e.stopPropagation());
  box.addEventListener("change", () => onchange(box.checked));
  return box;
}

const addContact = () => editRecord("contacts", null, { kind: "person", category: filter !== "all" && filter !== "team" ? filter : "partner", status: "In contact" });

// ---------- landing: one line of counts, then a card for each way in ----------
function tile(href, preview, title, text, go) {
  return h("a", { class: "tile", href },
    h("div", { class: "tile__preview" }, preview),
    h("div", { class: "tile__body" }, h("h2", { class: "tile__title" }, title), h("p", { class: "sub" }, text), h("span", { class: "tile__go" }, go + " →")));
}
function landing() {
  const contacts = state.contacts;
  const countries = new Set(contacts.map((c) => findCountry(c.country)?.code).filter(Boolean));
  const count = (value) => contacts.filter((c) => c.category === value).length;
  const linked = contacts.filter((c) => dealsForContact(c.id).length).length;
  const line = [
    plural(contacts.length, "contact"), plural(countries.size, "country", "countries"),
    count("client") > 0 && plural(count("client"), "client"), count("investor") > 0 && plural(count("investor"), "investor"),
    linked > 0 && `${linked} linked to a deal`,
  ].filter(Boolean).join(" · ");
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "title-line" }, h("h1", { class: "h1" }, "CRM"), h("span", { class: "muted" }, line)),
      h("button", { class: "btn btn--primary", type: "button", onclick: addContact }, "Add contact")),
    h("div", { class: "tiles" },
      tile("#crm/map", map.miniMap(), "Map", "Where clients, contacts and deals are, by country. Click a country to see who is there.", "Open the map"),
      tile("#crm/list",
        h("div", { class: "minilist" }, sortByName(contacts).slice(0, 5).map((c) => h("div", { class: "minirow" },
          h("b", null, c.name), h("span", { class: "muted" }, [categoryLabel(c.category), findCountry(c.country)?.code].filter(Boolean).join(" · "))))),
        "List", "Every contact in one table. Search, filter by category, and email a group at once.", "Open the list")));
}

export function render(sub) {
  if (sub === "map") return map.render();
  if (sub !== "list") return landing();
  const all = rows();
  const counts = { all: all.length, team: all.filter((r) => r.isTeam).length };
  for (const c of CATEGORIES) counts[c.value] = all.filter((r) => r.category === c.value).length;
  const q = query.trim().toLowerCase();
  const shown = all.filter((r) => (filter === "all" || r.category === filter) && (!q || r.hay.toLowerCase().includes(q)));
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.key));

  const tabs = [{ value: "all", many: "All" }, ...CATEGORIES.slice(0, 3), { value: "team", many: "Team" }, ...CATEGORIES.slice(3)];
  const search = h("input", { class: "input search", id: "crm-search", type: "search", placeholder: "Search name, organization, country", value: query, "aria-label": "Search contacts" });
  search.addEventListener("input", () => { query = search.value; refresh(); });

  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "crumbs crumbs--page" }, h("a", { href: "#crm" }, "CRM"), h("span", { class: "muted" }, " / "), h("b", null, "List")),
      h("button", { class: "btn btn--primary", type: "button", onclick: addContact }, "Add contact")),
    h("div", { class: "filters" },
      tabs.map((t) => h("button", { class: "filter", type: "button", "aria-pressed": String(filter === t.value), onclick: () => { filter = t.value; refresh(); } },
        t.many, h("span", { class: "num" }, counts[t.value]))),
      search),
    shown.length === 0
      ? h("div", { class: "empty" }, h("div", null, h("b", null, q ? "No match." : "Nobody in this group yet."),
          q ? " Try a shorter search." : filter === "team" ? " Add team members on the People tab." : " Add the first contact."))
      : h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null,
            h("th", { class: "tight" }, check(allShownSelected, "Select all shown", (on) => { shown.forEach((r) => (on ? selected.add(r.key) : selected.delete(r.key))); refresh(); })),
            ["Name", "Organization", "Category", "Email", "Who knows them", "Last contact", "Deals"].map((c) => h("th", null, c)))),
          h("tbody", null, shown.map((r) => h("tr", { class: "clickable", onclick: () => (r.isTeam ? openPerson(r.id) : openContact(r.id)) },
            h("td", { class: "tight" }, check(selected.has(r.key), "Select " + r.name, (on) => { on ? selected.add(r.key) : selected.delete(r.key); refresh(); })),
            h("td", null, h("div", { class: "name" }, r.name), r.title && h("div", { class: "row__meta" }, r.title)),
            h("td", null, r.organisation !== r.name ? r.organisation : ""),
            h("td", { class: "tight" }, r.isTeam ? "Team" : categoryLabel(r.category),
              r.status && r.status !== "In contact" && h("div", { class: "row__meta" }, r.status)),
            h("td", { class: "cell-edit" }, inlineEdit({ id: "email-" + r.key, value: r.email, placeholder: "Add email", label: `Email for ${r.name}`, type: "email",
              onSave: (v) => update(r.isTeam ? "people" : "contacts", r.id, { email: v }) })),
            h("td", { class: "tight" }, !r.isTeam && pickPerson({ value: r.owner_id, blank: "Nobody set", label: `Who knows ${r.name}`,
              onChange: (v) => update("contacts", r.id, { owner_id: v }) })),
            h("td", { class: "tight" }, r.last_touch ? fmtDate(r.last_touch) : ""),
            h("td", { class: "tight num" }, r.deals || "")))))),
    selectionBar(all));
}
