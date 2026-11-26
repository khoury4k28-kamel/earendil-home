// The side panels for a person, a deal, a project and a contact, plus the pieces several
// screens share: task lists, notes, and the add/edit form for any record.

import {
  h, avatar, kv, block, drawerFrame, openDrawer, openDialog, closeDrawer, toast, inlineEdit, quickAdd,
  fmtDate, fmtDateTime, fmtRange, daysSince, todayISO, ago,
} from "./ui.js";
import { zonePlace, timeIn, countryList } from "./places.js";
import {
  state, byId, create, update, remove, addNote, personName, teamName, sortByName,
  dealsForPerson, dealsForContact, tasksForPerson, projectsForDeal, notesFor, isOpenDeal,
} from "./store.js";
import { workOf, tasksOf, progress, nextStep, taskOrder, workFor, isLive, toDeal } from "./work.js";
import { openForm } from "./form.js";
import { slackLink } from "./slack.js";
import { fieldsFor, NOUN, STAGES, stageLabel, categoryLabel, PROJECT_STATUS, projectStatusLabel } from "./schema.js";

// ---------- add / edit any record ----------
export function editRecord(table, record, defaults = {}, added) {
  const noun = NOUN[table];
  let base = record || defaults;
  // A task belongs to one deal, one project, or nothing: one choice on the form.
  let clean = (values) => values;
  if (table === "tasks") {
    const w = workOf(base);
    base = { ...base, belongs: w ? `${w.kind}:${w.id}` : "" };
    clean = ({ belongs, ...values }) => {
      const [kind, id] = String(belongs || "").split(/:(.*)/s);
      return { ...values, deal_id: kind === "deal" ? id : null, project_id: kind === "project" ? id : null };
    };
  }
  openForm({
    title: record ? `Edit ${noun}` : `Add ${noun}`,
    fields: fieldsFor(table, base),
    record: base,
    saveLabel: record ? "Save" : `Add ${noun}`,
    onSave: async (raw) => {
      const values = clean(raw);
      if (record) return update(table, record.id, values);
      const row = await create(table, { ...defaults, ...values });
      if (row && added) added(row);
      return row;
    },
    onDelete: record ? async () => { await remove(table, record.id); if (["people", "deals", "contacts", "projects"].includes(table)) closeDrawer(); } : null,
  });
}
// One "Add project" for both kinds. With an outside party it has a stage and
// sits on the Project Tracker; our own work has a status and a due date.
// `added(kind, row)` runs once it is saved.
export function addProject(added, { owner = state.me.id || null, stage = "lead" } = {}) {
  let close = () => {};
  const pick = (title, text, run) => h("button", { class: "choice", type: "button", onclick: () => { close(); run(); } }, h("b", null, title), h("span", { class: "muted" }, text));
  close = openDialog({ title: "Add project", body: h("div", { class: "choices" },
    pick("With a client or partner", "A sale, a partnership or an investment. It has a stage and shows on the Project Tracker.",
      () => editRecord("deals", null, { stage, kind: "customer", owner_id: owner, people_ids: [], contact_ids: [] }, added && ((row) => added("deal", row)))),
    pick("Our own work", "An internal project, such as an engineering build. It has a status and a due date.",
      () => editRecord("projects", null, { status: "active", owner_id: owner, people_ids: [] }, added && ((row) => added("project", row))))) });
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
  if (!nextStep(deal)) out.push({ key: "next", rank: 2, text: "No next step" });
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

// Tasks in the order they should be done. `showWork` names the deal or project
// each belongs to; `markNext` labels the first open one.
export function taskList(tasks, { showOwner = true, showWork = true, markNext = false } = {}) {
  if (!tasks.length) return null;
  const sorted = [...tasks].sort(taskOrder);
  return h("ul", { class: "rows" }, sorted.map((t, i) => {
    const meta = [
      showOwner && personName(t.owner_id),
      t.status === "doing" && "In progress",
      t.due && "Due " + fmtDate(t.due),
      showWork && workOf(t)?.name,
    ].filter(Boolean).join(" · ");
    return h("li", { class: "row" + (t.status === "done" ? " done" : "") },
      h("button", {
        class: "check", type: "button", role: "checkbox",
        "aria-checked": t.status === "done" ? "true" : t.status === "doing" ? "mixed" : "false",
        "aria-label": "Mark " + t.title + (t.status === "done" ? " not done" : " done"),
        onclick: () => update("tasks", t.id, { status: t.status === "done" ? "todo" : "done" }),
      }),
      h("button", { class: "row__main rowbtn", type: "button", onclick: () => editRecord("tasks", t) },
        h("div", { class: "row__title" }, markNext && i === 0 && t.status !== "done" && h("span", { class: "next" }, "Next"), t.title),
        meta && h("div", { class: "row__meta" }, meta)));
  }));
}

// Under a note: who wrote it, when, and where it came from. A note taken from
// Slack links back to the message.
const VIA = { slack: "Slack", log: "the Log" };
export function noteMeta(n) {
  const via = n.source && !["manual", "system"].includes(n.source) ? "via " + (VIA[n.source] || n.source) : "";
  const link = n.source === "slack" && slackLink(n.link);
  const lead = [n.author, fmtDateTime(n.created_at)].filter(Boolean).join(" · ");
  return h("div", { class: "row__meta", title: n.source === "slack" ? null : n.author_email || null }, lead, via && " · ",
    link ? h("a", { class: "link", href: link, target: "_blank", rel: "noopener noreferrer" }, via) : via);
}

function notesBlock(type, id) {
  const notes = notesFor(type, id);
  return block("Notes",
    // Oldest first, so the newest note is last and the box to add one sits right under it.
    notes.length > 0 && h("div", { class: "notes-up" }, [...notes].reverse().map((n) => h("div", { class: "note" },
      h("div", { class: "prose" }, n.body),
      noteMeta(n)))),
    quickAdd(`note-${type}-${id}`, "Add a note", (body) => addNote(type, id, body)));
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

// ---------- deals and projects: the pieces both share ----------
export const openWork = (kind, id) => (kind === "deal" ? openDeal(id) : openProject(id));
export function progressBar(done, total) {
  if (!total) return null;
  return h("span", { class: "bar", role: "img", "aria-label": `${done} of ${total} tasks done` },
    h("span", { style: `width:${Math.round((done / total) * 100)}%` }));
}
// The small mark that tells a deal (its stage colour) from a project.
export const workMark = (w) => (w.kind === "deal"
  ? h("span", { class: "dot c-" + (w.rec.stage || "lead"), title: "Project · " + stageLabel(w.rec.stage) })
  : h("span", { class: "pmark", title: "Project · " + projectStatusLabel(w.rec.status) }));
// The label a task carries wherever it shows: its deal or project, one click away.
export function workTag(task) {
  const w = workOf(task);
  if (!w) return null;
  return h("button", { class: "wtag", type: "button", title: "Project: " + w.name,
    onclick: (e) => { e.stopPropagation(); location.hash = `#work/${w.kind}:${w.id}`; } }, workMark(w), h("span", null, w.name));
}
export function workRows(list) {
  return h("ul", { class: "rows" }, [...list].sort((a, b) => a.name.localeCompare(b.name)).map((w) => h("li", { class: "row" },
    h("button", { class: "row__main rowbtn", type: "button", onclick: () => openWork(w.kind, w.id) },
      h("div", { class: "row__title" }, workMark(w), w.name),
      h("div", { class: "row__meta" }, [
        w.kind === "deal" ? stageLabel(w.rec.stage) : projectStatusLabel(w.rec.status),
        w.total ? `${w.done} of ${w.total} tasks done` : "No tasks yet",
        w.next && `Next: ${w.next.title}`,
      ].filter(Boolean).join(" · "))))));
}
// The head both panels open with: how far along, then the tasks.
const doneLine = (pr) => (pr.total ? `${pr.done} of ${pr.total} tasks done` : null);
function workTasks(kind, rec) {
  const defaults = kind === "deal" ? { deal_id: rec.id, project_id: null } : { project_id: rec.id, deal_id: null };
  return tasksBlock(tasksOf(kind, rec.id), `task-${kind}-${rec.id}`, { ...defaults, owner_id: state.me.id || rec.owner_id || null }, { showWork: false, markNext: true });
}

// ---------- project ----------
export function openProject(id) {
  openDrawer(() => {
    const p = byId("projects", id);
    if (!p) return null;
    const pr = progress("project", id);
    const deal = byId("deals", p.deal_id);
    const team = (p.people_ids || []).filter((x) => x !== p.owner_id && byId("people", x));
    const save = (key) => (v) => update("projects", id, { [key]: v });
    // Two clicks, because it can't be taken back with Undo.
    const sell = h("button", { class: "more", type: "button" }, "Put on the Project Tracker");
    sell.addEventListener("click", async () => {
      if (!sell.dataset.armed) { sell.dataset.armed = "1"; sell.textContent = "Click again: it gets a stage, and its tasks and notes stay with it"; return; }
      const made = await toDeal(p);
      if (made) { openDeal(made.id); toast(`${made.name} is on the Project Tracker.`); }
    });
    return drawerFrame(
      { eyebrow: "Project", title: p.name, sub: doneLine(pr), actions: editBtn("projects", p) },
      progressBar(pr.done, pr.total),
      h("div", { class: "stage-pick stage-pick--3", role: "group", "aria-label": "Status" }, PROJECT_STATUS.map((st) => h("button", {
        type: "button", "aria-pressed": String((p.status || "active") === st.value), onclick: () => save("status")(st.value),
      }, st.label))),
      workTasks("project", p),
      inlineEdit({ id: `sum-${id}`, value: p.summary, placeholder: "Add what this project is for", label: "What it's for", multiline: true, onSave: save("summary") }),
      kv([
        ["Owner", pickPerson({ id: `powner-${id}`, value: p.owner_id, label: "Owner", onChange: save("owner_id") })],
        ["Due", inlineEdit({ id: `pdue-${id}`, value: p.due, display: fmtDate(p.due), placeholder: "Add date", label: "Due", type: "date", onSave: save("due") })],
        ["Team", team.length > 0 && h("div", { class: "chips" }, team.map(personChip))],
        ["Part of", deal && h("button", { class: "wtag", type: "button", onclick: () => openDeal(deal.id) }, workMark({ kind: "deal", rec: deal }), h("span", null, deal.name))],
      ]),
      notesBlock("project", id),
      !deal && sell,
      p.source && h("div", { class: "small muted" }, "Source: " + p.source));
  });
}

// ---------- person ----------
export function openPerson(id) {
  openDrawer(() => {
    const p = byId("people", id);
    if (!p) return null;
    const work = workFor(id);
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
      work.length > 0 && block(`Projects · ${work.length}`, workRows(work)),
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
    const pr = progress("deal", id);
    const under = projectsForDeal(id).map((p) => ({ kind: "project", id: p.id, rec: p, name: p.name, ...progress("project", p.id) }));
    return drawerFrame(
      { eyebrow: [d.kind && d.kind[0].toUpperCase() + d.kind.slice(1), d.region].filter(Boolean).join(" · ") || "Project", title: d.name,
        sub: [d.organisation, doneLine(pr)].filter(Boolean).join(" · "), actions: editBtn("deals", d) },
      progressBar(pr.done, pr.total),
      h("div", { class: "stage-pick", role: "group", "aria-label": "Stage" }, STAGES.map((s) => h("button", {
        type: "button", "aria-pressed": String(d.stage === s.value),
        onclick: () => setStage(id, s.value),
      }, s.label))),
      d.to_confirm && h("div", { class: "confirm" },
        h("div", { class: "confirm__text" }, h("div", { class: "caps" }, "To confirm"), h("div", null, d.to_confirm)),
        h("button", { class: "btn btn--small", type: "button", onclick: () => clearToConfirm(d) }, "Confirmed")),
      workTasks("deal", d),
      !pr.total && d.next_step && h("div", { class: "small muted" }, "Next step noted earlier: " + d.next_step),
      kv([
        ["Last contact", contactDate("deals", d)],
        ["Owner", pickPerson({ id: `owner-${id}`, value: d.owner_id, label: "Owner", onChange: save("owner_id") })],
        ["Size", size
          ? h("span", null, h("b", { class: "num" }, size), d.size_note && h("div", { class: "row__meta" }, d.size_note))
          : h("button", { class: "inline inline--empty", type: "button", onclick: () => editRecord("deals", d) }, "Add size")],
        ["Team", team.length > 0 && h("div", { class: "chips" }, team.map(personChip))],
        ["Outside", outside.length > 0 && h("div", { class: "chips" }, outside.map((c) =>
          h("button", { class: "person-chip", type: "button", onclick: () => openContact(c.id) }, avatar(c.name, "s"), c.name)))],
      ]),
      inlineEdit({ id: `sum-${id}`, value: d.summary, placeholder: "Add what this project is about", label: "Summary", multiline: true, onSave: save("summary") }),
      under.length > 0 && block(`Projects under this one · ${under.length}`, workRows(under)),
      h("button", { class: "more", type: "button", onclick: () => editRecord("projects", null,
        { status: "active", deal_id: id, owner_id: state.me.id || d.owner_id || null, people_ids: [] }, (row) => openProject(row.id)) }, "+ Add a project under this one"),
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
      deals.length > 0 && block(`Projects · ${deals.length}`, dealRows(deals)),
      notesBlock("contact", id),
      c.source && h("div", { class: "small muted" }, "Source: " + c.source));
  });
}
