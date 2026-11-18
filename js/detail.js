// The side panels for a person, a deal and a contact, plus the pieces several
// screens share: task lists, notes, and the add/edit form for any record.

import {
  h, avatar, kv, block, drawerFrame, openDrawer, closeDrawer, emptyState,
  fmtDate, fmtDateTime, fmtRange, daysSince,
} from "./ui.js";
import {
  state, byId, create, update, remove, addNote, personName, teamName,
  dealsForPerson, dealsForContact, tasksForPerson, notesFor, isOpenDeal,
} from "./store.js";
import { openForm } from "./form.js";
import { fieldsFor, NOUN, STAGES, stageLabel, categoryLabel, SOURCES } from "./schema.js";

// ---------- add / edit any record ----------
export function editRecord(table, record, defaults = {}) {
  const noun = NOUN[table];
  const base = record || defaults;
  openForm({
    title: record ? `Edit ${noun}` : `Add ${noun}`,
    fields: fieldsFor(table, base),
    record: base,
    saveLabel: record ? "Save" : `Add ${noun}`,
    onSave: (values) => (record ? update(table, record.id, values) : create(table, { ...defaults, ...values })),
    onDelete: record ? async () => { await remove(table, record.id); if (["people", "deals", "contacts"].includes(table)) closeDrawer(); } : null,
  });
}
const editBtn = (table, record) => h("button", { class: "btn btn--small", type: "button", onclick: () => editRecord(table, record) }, "Edit");
export const addBtn = (label, table, defaults) =>
  h("button", { class: "btn btn--small", type: "button", onclick: () => editRecord(table, null, defaults) }, label);

// ---------- shared pieces ----------
export function personChip(id) {
  const p = byId("people", id);
  if (!p) return null;
  return h("button", { class: "person-chip", type: "button", onclick: () => openPerson(id) }, avatar(p.name, "s"), p.name);
}

export function stalledDays(deal) {
  if (!isOpenDeal(deal) || !deal.last_touch) return null;
  const d = daysSince(deal.last_touch);
  return d > 30 ? d : null;
}

export function taskList(tasks, { showOwner = true, empty = "No tasks yet." } = {}) {
  if (!tasks.length) return h("div", { class: "muted small" }, empty);
  const order = { doing: 0, todo: 1, done: 2 };
  const sorted = [...tasks].sort((a, b) => order[a.status] - order[b.status] || String(a.due || "9").localeCompare(String(b.due || "9")));
  return h("ul", { class: "rows" }, sorted.map((t) => {
    const meta = [
      showOwner && personName(t.owner_id),
      t.status === "doing" && "In progress",
      t.due && "Due " + fmtDate(t.due),
      t.deal_id && byId("deals", t.deal_id)?.name,
    ].filter(Boolean).join(" · ");
    return h("li", { class: "row" + (t.status === "done" ? " done" : "") },
      h("button", {
        class: "check", type: "button", role: "checkbox",
        "aria-checked": t.status === "done" ? "true" : t.status === "doing" ? "mixed" : "false",
        "aria-label": "Mark " + t.title + (t.status === "done" ? " not done" : " done"),
        onclick: () => update("tasks", t.id, { status: t.status === "done" ? "todo" : "done" }),
      }),
      h("button", { class: "row__main rowbtn", type: "button", onclick: () => editRecord("tasks", t) },
        h("div", { class: "row__title" }, t.title),
        meta && h("div", { class: "row__meta" }, meta)));
  }));
}

function notesBlock(type, id) {
  const notes = notesFor(type, id);
  const input = h("input", { class: "input", id: `note-${type}-${id}`, placeholder: "Add a note", autocomplete: "off" });
  const save = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    await addNote(type, id, body);
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  return block("Notes",
    h("div", { class: "inline-add" }, input, h("button", { class: "btn", type: "button", onclick: save }, "Add")),
    notes.length
      ? h("div", null, notes.map((n) => h("div", { class: "note" },
          h("div", { class: "prose" }, n.body),
          h("div", { class: "row__meta", title: n.author_email || null }, [n.author, fmtDateTime(n.created_at), n.source && n.source !== "manual" && "via " + n.source].filter(Boolean).join(" · ")))))
      : h("div", { class: "muted small" }, "No notes yet."));
}

function dealRows(deals) {
  return h("ul", { class: "rows" }, deals.map((d) => h("li", { class: "row" },
    h("button", { class: "row__main rowbtn", type: "button", onclick: () => openDeal(d.id) },
      h("div", { class: "row__title" }, d.name),
      h("div", { class: "row__meta" }, [stageLabel(d.stage), fmtRange(d.size_low, d.size_high)].filter(Boolean).join(" · "))))));
}

function sourcesRow() {
  return h("div", { class: "sources" }, SOURCES.map((s) => h("div", { class: "source" },
    h("div", { class: "caps" }, s),
    h("div", { class: "small muted" }, h("span", { class: "sq sq--open" }), "Not connected"))));
}

// ---------- person ----------
export function openPerson(id) {
  openDrawer(() => {
    const p = byId("people", id);
    if (!p) return null;
    const tasks = tasksForPerson(id);
    const deals = dealsForPerson(id);
    const reports = state.people.filter((x) => x.reports_to === id);
    return drawerFrame(
      { eyebrow: teamName(p.team_id) || "Team member", title: p.name, sub: p.title, actions: editBtn("people", p) },
      block("Working on now",
        p.focus ? h("div", { class: "prose" }, p.focus)
          : emptyState("Not filled in yet.", "A line on what they're focused on this week.", editBtn("people", p))),
      block("What they do",
        p.responsibilities ? h("div", { class: "prose" }, p.responsibilities) : h("div", { class: "muted small" }, "Responsibilities not filled in yet."),
        kv([
          ["Team", teamName(p.team_id)],
          ["Reports to", p.reports_to && personChip(p.reports_to)],
          ["Direct reports", reports.length && h("div", { class: "chips" }, reports.map((r) => personChip(r.id)))],
          ["Email", p.email],
          ["Based in", p.location],
          ["Note", p.note],
        ])),
      block(`Tasks · ${tasks.filter((t) => t.status !== "done").length} open`,
        taskList(tasks, { showOwner: false }),
        h("div", null, addBtn("Add task", "tasks", { owner_id: id, status: "todo" }))),
      block(`Deals · ${deals.length}`, deals.length ? dealRows(deals) : h("div", { class: "muted small" }, "Not on any deal yet.")),
      block("Sources", sourcesRow(),
        h("div", { class: "small muted" }, "Slack, email and Granola feeds aren't live yet. Until they are, this profile is filled in by hand.")),
      notesBlock("person", id));
  });
}

// ---------- deal ----------
export function openDeal(id) {
  openDrawer(() => {
    const d = byId("deals", id);
    if (!d) return null;
    const size = fmtRange(d.size_low, d.size_high);
    const stalled = stalledDays(d);
    const team = [...new Set([d.owner_id, ...(d.people_ids || [])].filter(Boolean))];
    const outside = (d.contact_ids || []).map((c) => byId("contacts", c)).filter(Boolean);
    const tasks = state.tasks.filter((t) => t.deal_id === id);
    return drawerFrame(
      { eyebrow: [d.kind, d.region].filter(Boolean).join(" · ") || "Deal", title: d.name, sub: d.organisation, actions: editBtn("deals", d) },
      block("Stage",
        h("div", { class: "stage-pick" }, STAGES.map((s) => h("button", {
          type: "button", "aria-pressed": String(d.stage === s.value),
          onclick: () => d.stage !== s.value && update("deals", id, { stage: s.value }),
        }, s.label)))),
      d.to_confirm && h("div", { class: "confirm" }, h("div", { class: "caps" }, "To confirm"), h("div", null, d.to_confirm)),
      block("Size",
        size ? h("div", { class: "stat__v" }, size) : h("div", { class: "muted" }, "No size yet."),
        d.size_note && h("div", { class: "small sub" }, d.size_note)),
      block("Who's involved",
        kv([
          ["Owner", d.owner_id ? personChip(d.owner_id) : h("span", { class: "muted" }, "Nobody yet")],
          ["Team", team.length > (d.owner_id ? 1 : 0) && h("div", { class: "chips" }, team.filter((p) => p !== d.owner_id).map(personChip))],
          ["Outside", outside.length && h("div", { class: "chips" }, outside.map((c) =>
            h("button", { class: "person-chip", type: "button", onclick: () => openContact(c.id) }, avatar(c.name, "s"), c.name)))],
        ])),
      block("Progress",
        kv([
          ["Next step", d.next_step || h("span", { class: "muted" }, "Not set")],
          ["Last contact", d.last_touch
            ? h("span", null, fmtDate(d.last_touch), stalled && h("span", { class: "stalled" }, ` · Stalled ${stalled} d`))
            : h("span", { class: "muted" }, "None logged")],
        ]),
        d.summary && h("div", { class: "prose" }, d.summary)),
      block(`Tasks · ${tasks.filter((t) => t.status !== "done").length} open`,
        taskList(tasks),
        h("div", null, addBtn("Add task", "tasks", { deal_id: id, owner_id: d.owner_id || null, status: "todo" }))),
      notesBlock("deal", id),
      d.source && h("div", { class: "small muted" }, "Source: " + d.source));
  });
}

// ---------- contact ----------
export function openContact(id) {
  openDrawer(() => {
    const c = byId("contacts", id);
    if (!c) return null;
    const deals = dealsForContact(id);
    return drawerFrame(
      { eyebrow: [categoryLabel(c.category), c.status].filter(Boolean).join(" · "), title: c.name, sub: [c.title, c.organisation !== c.name && c.organisation].filter(Boolean).join(", "), actions: editBtn("contacts", c) },
      block("Details",
        kv([
          ["Email", c.email || h("span", { class: "muted" }, "Not added yet")],
          ["Phone", c.phone],
          ["Country", c.country],
          ["Who knows them", c.owner_id && personChip(c.owner_id)],
          ["Last contact", c.last_touch && fmtDate(c.last_touch)],
        ]),
        c.notes && h("div", { class: "prose" }, c.notes)),
      block(`Deals · ${deals.length}`, deals.length ? dealRows(deals) : h("div", { class: "muted small" }, "Not linked to a deal yet. Add them from the deal's edit form.")),
      notesBlock("contact", id),
      c.source && h("div", { class: "small muted" }, "Source: " + c.source));
  });
}
