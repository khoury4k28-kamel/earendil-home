// CRM: every contact in one table, split by category. Tick rows to copy their
// addresses or open one email to all of them.

import { h, fmtDate, plural, refresh, toast } from "../ui.js";
import { state, personName, dealsForContact, dealsForPerson } from "../store.js";
import { CATEGORIES, categoryLabel } from "../schema.js";
import { editRecord, openContact, openPerson } from "../detail.js";

let filter = "all";
let query = "";
const selected = new Set();

// Team members come from People, so nobody is typed in twice.
function rows() {
  const team = state.people.map((p) => ({
    key: "p:" + p.id, id: p.id, isTeam: true, name: p.name, title: p.title, organisation: "Earendil Robotics",
    category: "team", status: "", email: p.email, owner: "", last_touch: null, deals: dealsForPerson(p.id).length,
    hay: [p.name, p.title, p.location].join(" "),
  }));
  const contacts = state.contacts.map((c) => ({
    key: "c:" + c.id, id: c.id, isTeam: false, name: c.name, title: c.title, organisation: c.organisation,
    category: c.category, status: c.status, email: c.email, owner: personName(c.owner_id), last_touch: c.last_touch,
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

export function render() {
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
      h("h1", { class: "h1" }, "CRM"),
      h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("contacts", null, { kind: "person", category: filter !== "all" && filter !== "team" ? filter : "partner", status: "In contact" }) }, "Add contact")),
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
            h("td", null, r.email || h("span", { class: "muted" }, "Not added")),
            h("td", { class: "tight" }, r.owner || h("span", { class: "muted" }, r.isTeam ? "" : "Nobody set")),
            h("td", { class: "tight" }, r.last_touch ? fmtDate(r.last_touch) : ""),
            h("td", { class: "tight num" }, r.deals || "")))))),
    selectionBar(all));
}
