// One update to the hub, said in a line and carried out through the usual save
// calls. The Log and the Slack feed both suggest updates in this shape:
//   { type, target_type, target_id, date, title, stage, name, organisation }
// type is one of: log_contact, complete_task, add_task, move_stage, new_contact.

import { fmtDate, todayISO } from "./ui.js";
import { state, create, update, remove, byId } from "./store.js";
import { stageLabel } from "./schema.js";

export const TABLE = { deal: "deals", project: "projects", contact: "contacts", task: "tasks" };
export const rec = (type, id) => byId(TABLE[type], id);
export const nameOf = (type, id) => { const r = rec(type, id); return r ? r.name || r.title : ""; };
const when = (date) => (!date || date === todayISO() ? "today" : fmtDate(date));

// One line for an update: what it would do, or (`done`) what it did.
export function describe(a, done = false) {
  const name = nameOf(a.target_type, a.target_id);
  switch (a.type) {
    case "log_contact": return done ? `Logged contact with ${name} (${fmtDate(a.date || todayISO())})` : `Log contact with ${name}, ${when(a.date)}`;
    case "complete_task": return `${done ? "Marked" : "Mark"} done: ${name}`;
    case "add_task": return `${done ? "Added" : "Add"} task: ${a.title}${name ? ` (${name})` : ""}${a.date ? `, due ${fmtDate(a.date)}` : ""}`;
    case "move_stage": return `${done ? "Moved" : "Move"} ${name} to ${stageLabel(a.stage)}`;
    case "new_contact": return `${done ? "Added" : "Add"} contact: ${a.name}${a.organisation ? ` (${a.organisation})` : ""}`;
    default: return "";
  }
}

// Is there still something for this update to do? One that is already true, or
// about a record that has since gone, has nothing left.
export function stillOpen(a) {
  if (a.type === "add_task" || a.type === "new_contact") return true;
  const r = rec(a.target_type, a.target_id);
  if (!r) return false;
  if (a.type === "complete_task") return r.status !== "done";
  if (a.type === "move_stage") return r.stage !== a.stage;
  return true;
}

// Carries out one update. Returns how to take it back, or null if nothing
// changed. `owner` gets a new task or contact; `source` is noted on a new contact.
export async function perform(a, { owner = state.me.id, source = "Log" } = {}) {
  const table = TABLE[a.target_type];
  const r = table ? byId(table, a.target_id) : null;
  if (a.type === "log_contact" && r) {
    const before = r.last_touch || null;
    const date = a.date || todayISO();
    // A contact date only ever moves forward.
    if (before && before >= date) return null;
    if (!(await update(table, r.id, { last_touch: date }))) return null;
    return () => update(table, r.id, { last_touch: before });
  }
  if (a.type === "complete_task" && r) {
    const before = r.status;
    if (before === "done" || !(await update("tasks", r.id, { status: "done" }))) return null;
    return () => update("tasks", r.id, { status: before });
  }
  if (a.type === "add_task") {
    const row = await create("tasks", {
      title: a.title, status: "todo", owner_id: owner || null, due: a.date || null,
      deal_id: a.target_type === "deal" ? a.target_id : null, project_id: a.target_type === "project" ? a.target_id : null,
    });
    return row ? () => remove("tasks", row.id) : null;
  }
  if (a.type === "move_stage" && r) {
    const before = r.stage;
    if (before === a.stage || !(await update("deals", r.id, { stage: a.stage }))) return null;
    const note = await create("activity", {
      entity_type: "deal", entity_id: r.id, body: `Moved from ${stageLabel(before)} to ${stageLabel(a.stage)}`, source: "system",
      author: state.me.label || "Team", created_at: new Date().toISOString(),
    });
    return async () => { await update("deals", r.id, { stage: before }); if (note) await remove("activity", note.id); };
  }
  if (a.type === "new_contact") {
    const row = await create("contacts", {
      name: a.name, organisation: a.organisation || null, kind: "person", category: "prospect", status: "In contact",
      owner_id: owner || null, last_touch: todayISO(), source,
    });
    return row ? () => remove("contacts", row.id) : null;
  }
  return null;
}
