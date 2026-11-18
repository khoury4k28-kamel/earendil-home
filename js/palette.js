// Search and create, in one box (Cmd+K or Ctrl+K). Type to find any deal,
// contact or person, jump to a section, or start a new record.

import { h } from "./ui.js";
import { state } from "./store.js";
import { editRecord, openDeal, openContact, openPerson } from "./detail.js";
import { stageLabel, categoryLabel } from "./schema.js";

let open = false;

function items(extra) {
  const create = [
    ["New deal", () => editRecord("deals", null, { stage: "lead", kind: "customer", people_ids: [], contact_ids: [] })],
    ["New contact", () => editRecord("contacts", null, { kind: "person", category: "partner", status: "In contact" })],
    ["New task", () => editRecord("tasks", null, { status: "todo", owner_id: state.me.id || null })],
    ["New person", () => editRecord("people", null)],
    ["New team", () => editRecord("teams", null)],
    ["New milestone", () => editRecord("milestones", null, { status: "upcoming", kind: "company" })],
    ["New target", () => editRecord("goals", null, {})],
  ].map(([label, run]) => ({ group: "Create", label, sub: "", run }));
  const go = [["Home", "home"], ["People", "people"], ["Teams", "teams"], ["Deal Tracker", "deals"], ["CRM", "crm"]]
    .map(([label, id]) => ({ group: "Go to", label, sub: "", run: () => { location.hash = id; } }));
  const records = [
    ...state.deals.map((d) => ({ group: "Deals", label: d.name, sub: [stageLabel(d.stage), d.organisation].filter(Boolean).join(" · "), run: () => openDeal(d.id) })),
    ...state.contacts.map((c) => ({ group: "Contacts", label: c.name, sub: [categoryLabel(c.category), c.organisation !== c.name && c.organisation].filter(Boolean).join(" · "), run: () => openContact(c.id) })),
    ...state.people.map((p) => ({ group: "People", label: p.name, sub: p.title || "", run: () => openPerson(p.id) })),
  ];
  return { create: [...create, ...extra.map(([label, run]) => ({ group: "Go to", label, sub: "", run }))], go, records };
}

export function openPalette(extra = []) {
  if (open) return;
  open = true;
  const all = items(extra);
  let shown = [];
  let index = 0;

  const input = h("input", { class: "palette__input", id: "palette-input", placeholder: "Search, or type “new”", autocomplete: "off", "aria-label": "Search or create" });
  const list = h("div", { class: "palette__list", role: "listbox" });
  const box = h("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Search or create" }, input, list);
  const scrim = h("div", { class: "scrim scrim--center scrim--palette", onmousedown: (e) => { if (e.target === scrim) close(); } }, box);

  function close() {
    open = false;
    scrim.remove();
  }
  function run(item) {
    close();
    item.run();
  }
  function paint() {
    const q = input.value.trim().toLowerCase();
    const match = (it) => (it.label + " " + it.sub).toLowerCase().includes(q);
    shown = q ? [...all.records.filter(match), ...all.create.filter(match), ...all.go.filter(match)].slice(0, 9) : [...all.create, ...all.go];
    index = Math.min(index, Math.max(0, shown.length - 1));
    list.replaceChildren();
    if (!shown.length) { list.append(h("div", { class: "palette__none" }, "No match.")); return; }
    let group = null;
    shown.forEach((it, i) => {
      if (it.group !== group) { group = it.group; list.append(h("div", { class: "palette__group" }, group)); }
      const row = h("button", { class: "palette__item", type: "button", role: "option", "aria-selected": String(i === index), onclick: () => run(it) },
        h("span", null, it.label), it.sub && h("span", { class: "palette__sub" }, it.sub));
      row.addEventListener("mousemove", () => { if (index !== i) { index = i; paint(); } });
      list.append(row);
    });
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }
  input.addEventListener("input", () => { index = 0; paint(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); index = Math.min(index + 1, shown.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); index = Math.max(index - 1, 0); paint(); }
    else if (e.key === "Enter" && shown[index]) { e.preventDefault(); run(shown[index]); }
  });

  document.getElementById("layer").append(scrim);
  paint();
  input.focus();
}
