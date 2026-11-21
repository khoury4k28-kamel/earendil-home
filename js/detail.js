// The side panels for a person, a deal and a contact, plus the pieces several
// screens share: task lists, notes, and the add/edit form for any record.

import {
  h, avatar, kv, block, drawerFrame, openDrawer, closeDrawer, toast, inlineEdit, quickAdd,
  fmtDate, fmtDateTime, fmtRange, daysSince, todayISO, ago,
} from "./ui.js";
import { zonePlace, timeIn, countryList } from "./places.js";
import {
  state, byId, create, update, remove, addNote, personName, teamName, sortByName,
  dealsForPerson, dealsForContact, tasksForPerson, notesFor, isOpenDeal,
} from "./store.js";
import { openForm } from "./form.js";
import { fieldsFor, NOUN, STAGES, stageLabel, categoryLabel } from "./schema.js";

// ---------- add / edit any record ----------
export function editRecord(table, record, defaults = {}, added) {
  const noun = NOUN[table];
  const base = record || defaults;
  openForm({
    title: record ? `Edit ${noun}` : `Add ${noun}`,
    fields: fieldsFor(table, base),
    record: base,
    saveLabel: record ? "Save" : `Add ${noun}`,
    onSave: async (values) => {
      if (record) return update(table, record.id, values);
      const row = await create(table, { ...defaults, ...values });
      if (row && added) added(row);
      return row;
    },
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

// A person chosen in place, without opening the edit form.
export function pickPerson({ id, value, blank = "Nobody yet", label, exclude, onChange }) {
  const current = byId("people", value) ? value : "";
  const sel = h("select", { class: "pick" + (current ? "" : " pick--empty"), id, "aria-label": label, onclick: (e) => e.stopPropagation() },
    h("option", { value: "" }, blank),
    sortByName(state.people).filter((p) => p.id !== exclude).map((p) => h("option", { value: p.id, selected: p.id === current }, p.name)));
  sel.addEventListener("change", () => onChange(sel.value || null));
  return sel;
}

// One-click changes, each with a way back.
export function logContact(table, rec) {
  const before = rec.last_touch || null;
  update(table, rec.id, { last_touch: todayISO() });
  toast(`Contact with ${rec.name} logged for today.`, ["Undo", () => update(table, rec.id, { last_touch: before })]);
}
export function takeDeal(deal) {
  const before = deal.owner_id || null;
  update("deals", deal.id, { owner_id: state.me.id });
  toast(`${deal.name} is yours.`, ["Undo", () => update("deals", deal.id, { owner_id: before })]);
}
export function finishTask(task) {
  const before = task.status;
  update("tasks", task.id, { status: "done" });
  toast("Marked done.", ["Undo", () => update("tasks", task.id, { status: before })]);
}
export function clearToConfirm(deal) {
  const before = deal.to_confirm;
  update("deals", deal.id, { to_confirm: null });
  toast("Marked as confirmed.", ["Undo", () => update("deals", deal.id, { to_confirm: before })]);
}

export function stalledDays(deal) {
  if (!isOpenDeal(deal) || !deal.last_touch) return null;
  const d = daysSince(deal.last_touch);
  return d > 30 ? d : null;
}

// What is missing or going stale on an open deal, most urgent first.
export function dealIssues(deal) {
  if (!isOpenDeal(deal)) return [];
  const out = [];
  const stalled = stalledDays(deal);
  if (stalled) out.push({ key: "stalled", rank: 0, text: `No contact in ${stalled} days` });
  if (!deal.owner_id || !byId("people", deal.owner_id)) out.push({ key: "owner", rank: 1, text: "No owner" });
  if (!deal.next_step) out.push({ key: "next", rank: 2, text: "No next step" });
  if (!deal.last_touch) out.push({ key: "touch", rank: 3, text: "No contact logged" });
  if (deal.to_confirm) out.push({ key: "confirm", rank: 4, text: "Details to confirm" });
  return out;
}

// Moves a deal to another stage and leaves a line in its history. With
// `undo`, a slip (a card dropped in the wrong column) can be taken back.
export async function setStage(id, stage, { undo = false } = {}) {
  const deal = byId("deals", id);
  if (!deal || deal.stage === stage) return;
  const before = deal.stage;
  if (!(await update("deals", id, { stage }))) return;
  const note = create("activity", {
    entity_type: "deal", entity_id: id, body: `Moved from ${stageLabel(before)} to ${stageLabel(stage)}`,
    author: state.me.label || "Team", source: "system", created_at: new Date().toISOString(),
  });
  if (!undo) return;
  toast(`${deal.name} moved to ${stageLabel(stage)}.`, ["Undo", async () => {
    update("deals", id, { stage: before });
    const row = await note;
    if (row) remove("activity", row.id);
  }]);
}

export function taskList(tasks, { showOwner = true } = {}) {
  if (!tasks.length) return null;
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
  return block("Notes",
    quickAdd(`note-${type}-${id}`, "Add a note", (body) => addNote(type, id, body)),
    notes.length > 0 && h("div", null, notes.map((n) => h("div", { class: "note" },
      h("div", { class: "prose" }, n.body),
      h("div", { class: "row__meta", title: n.author_email || null }, [n.author, fmtDateTime(n.created_at), n.source && !["manual", "system"].includes(n.source) && "via " + n.source].filter(Boolean).join(" · "))))));
}

function tasksBlock(tasks, idKey, defaults, opts) {
  return block(`Tasks · ${tasks.filter((t) => t.status !== "done").length} open`,
    taskList(tasks, opts),
    quickAdd(idKey, "Add a task", (title) => create("tasks", { title, status: "todo", ...defaults })));
}

// The last-contact date, editable in place, with a one-click "Today".
function contactDate(table, rec) {
  const stalled = table === "deals" ? stalledDays(rec) : null;
  return h("span", { class: "deal__left" },
    inlineEdit({ id: `touch-${rec.id}`, value: rec.last_touch, display: fmtDate(rec.last_touch), placeholder: "Add date", label: "Last contact", type: "date",
      onSave: (v) => update(table, rec.id, { last_touch: v }) }),
    stalled && h("span", { class: "stalled" }, `Stalled ${stalled}d`),
    rec.last_touch !== todayISO() && h("button", { class: "btn btn--small", type: "button", onclick: () => logContact(table, rec) }, "Today"));
}

function dealRows(deals) {
  return h("ul", { class: "rows" }, deals.map((d) => h("li", { class: "row" },
    h("button", { class: "row__main rowbtn", type: "button", onclick: () => openDeal(d.id) },
      h("div", { class: "row__title" }, d.name),
      h("div", { class: "row__meta" }, [stageLabel(d.stage), fmtRange(d.size_low, d.size_high)].filter(Boolean).join(" · "))))));
}

// ---------- person ----------
export function openPerson(id) {
  openDrawer(() => {
    const p = byId("people", id);
    if (!p) return null;
    const deals = dealsForPerson(id);
    const reports = state.people.filter((x) => x.reports_to === id);
    const save = (key) => (v) => update("people", id, { [key]: v });
    return drawerFrame(
      { eyebrow: teamName(p.team_id) || "Team member", title: p.name, sub: p.title, actions: editBtn("people", p) },
      block("Working on now",
        inlineEdit({ id: `focus-${id}`, value: p.focus, placeholder: "Add what they're focused on this week", label: "Working on now", multiline: true, onSave: save("focus") })),
      block("What they do",
        inlineEdit({ id: `resp-${id}`, value: p.responsibilities, placeholder: "Add responsibilities", label: "What they do", multiline: true, onSave: save("responsibilities") }),
        kv([
          ["Team", teamName(p.team_id)],
          ["Reports to", pickPerson({ value: p.reports_to, blank: "Nobody set", exclude: id, label: "Reports to", onChange: save("reports_to") })],
          ["Direct reports", reports.length && h("div", { class: "chips" }, reports.map((r) => personChip(r.id)))],
          ["Email", inlineEdit({ id: `email-${id}`, value: p.email, placeholder: "Add email", label: "Email", type: "email", onSave: save("email") })],
          ["Based in", inlineEdit({ id: `loc-${id}`, value: p.location, placeholder: "Add city or country", label: "Based in", onSave: save("location") })],
          ["Now", zonePlace(p.tz) && `${zonePlace(p.tz).city} time, ${timeIn(p.tz)}` + (p.seen_at ? ` · seen ${ago(p.seen_at)}` : "")],
          ["Note", p.note],
        ])),
      tasksBlock(tasksForPerson(id), `task-person-${id}`, { owner_id: id }, { showOwner: false }),
      deals.length > 0 && block(`Deals · ${deals.length}`, dealRows(deals)),
      notesBlock("person", id));
  });
}

// ---------- deal ----------
export function openDeal(id) {
  openDrawer(() => {
    const d = byId("deals", id);
    if (!d) return null;
    const size = fmtRange(d.size_low, d.size_high);
    const team = (d.people_ids || []).filter((p) => p !== d.owner_id && byId("people", p));
    const outside = (d.contact_ids || []).map((c) => byId("contacts", c)).filter(Boolean);
    const save = (key) => (v) => update("deals", id, { [key]: v });
    return drawerFrame(
      { eyebrow: [d.kind && d.kind[0].toUpperCase() + d.kind.slice(1), d.region].filter(Boolean).join(" · ") || "Deal", title: d.name, sub: d.organisation, actions: editBtn("deals", d) },
      h("div", { class: "stage-pick", role: "group", "aria-label": "Stage" }, STAGES.map((s) => h("button", {
        type: "button", "aria-pressed": String(d.stage === s.value),
        onclick: () => setStage(id, s.value),
      }, s.label))),
      d.to_confirm && h("div", { class: "confirm" },
        h("div", { class: "confirm__text" }, h("div", { class: "caps" }, "To confirm"), h("div", null, d.to_confirm)),
        h("button", { class: "btn btn--small", type: "button", onclick: () => clearToConfirm(d) }, "Confirmed")),
      kv([
        ["Next step", inlineEdit({ id: `next-${id}`, value: d.next_step, placeholder: "Add next step", label: "Next step", onSave: save("next_step") })],
        ["Last contact", contactDate("deals", d)],
        ["Owner", pickPerson({ id: `owner-${id}`, value: d.owner_id, label: "Owner", onChange: save("owner_id") })],
        ["Size", size
          ? h("span", null, h("b", { class: "num" }, size), d.size_note && h("div", { class: "row__meta" }, d.size_note))
          : h("button", { class: "inline inline--empty", type: "button", onclick: () => editRecord("deals", d) }, "Add size")],
        ["Team", team.length > 0 && h("div", { class: "chips" }, team.map(personChip))],
        ["Outside", outside.length > 0 && h("div", { class: "chips" }, outside.map((c) =>
          h("button", { class: "person-chip", type: "button", onclick: () => openContact(c.id) }, avatar(c.name, "s"), c.name)))],
      ]),
      d.summary && h("div", { class: "prose sub" }, d.summary),
      tasksBlock(state.tasks.filter((t) => t.deal_id === id), `task-deal-${id}`, { deal_id: id, owner_id: d.owner_id || null }),
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
    const save = (key) => (v) => update("contacts", id, { [key]: v });
    return drawerFrame(
      { eyebrow: [categoryLabel(c.category), c.status].filter(Boolean).join(" · "), title: c.name, sub: [c.title, c.organisation !== c.name && c.organisation].filter(Boolean).join(", "), actions: editBtn("contacts", c) },
      kv([
        ["Email", inlineEdit({ id: `email-${id}`, value: c.email, placeholder: "Add email", label: "Email", type: "email", onSave: save("email") })],
        ["Phone", inlineEdit({ id: `phone-${id}`, value: c.phone, placeholder: "Add phone", label: "Phone", type: "tel", onSave: save("phone") })],
        ["Country", inlineEdit({ id: `country-${id}`, value: c.country, placeholder: "Add country", label: "Country", list: countryList(), onSave: save("country") })],
        ["Who knows them", pickPerson({ value: c.owner_id, blank: "Nobody set", label: "Who knows them", onChange: save("owner_id") })],
        ["Last contact", contactDate("contacts", c)],
      ]),
      c.notes && h("div", { class: "prose sub" }, c.notes),
      deals.length > 0 && block(`Deals · ${deals.length}`, dealRows(deals)),
      notesBlock("contact", id),
      c.source && h("div", { class: "small muted" }, "Source: " + c.source));
  });
}
