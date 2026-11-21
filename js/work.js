// Deals and projects are the same kind of thing: a piece of work that has
// tasks. A deal is a project with a pipeline. Every screen goes through this
// file, so the two are treated alike, and a task always knows what it belongs
// to: one deal, one project, or nothing (a quick to-do).

import { state, byId, create, update, remove, isOpenDeal } from "./store.js";

const RANK = { doing: 0, todo: 1, done: 2 };
// In progress first, then the earliest due date, then the oldest.
export const taskOrder = (a, b) =>
  (RANK[a.status] ?? 1) - (RANK[b.status] ?? 1) ||
  String(a.due || "9").localeCompare(String(b.due || "9")) ||
  String(a.created_at || "").localeCompare(String(b.created_at || ""));

const table = (kind) => (kind === "deal" ? "deals" : "projects");

// What a task belongs to. A project wins if a task somehow names both.
export function workOf(task) {
  const p = byId("projects", task.project_id);
  if (p) return { kind: "project", id: p.id, rec: p, name: p.name };
  const d = byId("deals", task.deal_id);
  if (d) return { kind: "deal", id: d.id, rec: d, name: d.name };
  return null;
}
export const tasksOf = (kind, id) => state.tasks.filter((t) => { const w = workOf(t); return w && w.kind === kind && w.id === id; });

// How far along a deal or project is, and the task to do next.
export function progress(kind, id) {
  const tasks = tasksOf(kind, id);
  const open = tasks.filter((t) => t.status !== "done").sort(taskOrder);
  return { total: tasks.length, done: tasks.length - open.length, next: open[0] || null };
}

// Still being worked on: an open deal, or a project that isn't finished.
export const isLive = (kind, rec) => (kind === "deal" ? isOpenDeal(rec) : rec.status !== "done");
// Being worked on right now (a project on hold is live but not active).
export const isActive = (kind, rec) => (kind === "deal" ? isOpenDeal(rec) : (rec.status || "active") === "active");
export const isOn = (rec, personId) => Boolean(personId && (rec.owner_id === personId || (rec.people_ids || []).includes(personId)));

// A deal's next step is its next open task. A deal that has no tasks yet may
// still carry a next step typed before tasks drove this.
export const nextStep = (deal) => progress("deal", deal.id).next?.title || deal.next_step || "";
export async function setNextStep(deal, text) {
  const { next } = progress("deal", deal.id);
  if (!text) { if (!next && deal.next_step) await update("deals", deal.id, { next_step: null }); return null; }
  if (next) return update("tasks", next.id, { title: text });
  if (deal.next_step) await update("deals", deal.id, { next_step: null });
  return create("tasks", { title: text, status: "todo", deal_id: deal.id, project_id: null, owner_id: deal.owner_id || null });
}

// Deals and projects as one list, in the same shape.
export function allWork() {
  return [
    ...state.deals.map((d) => ({ kind: "deal", id: d.id, rec: d, name: d.name })),
    ...state.projects.map((p) => ({ kind: "project", id: p.id, rec: p, name: p.name })),
  ].map((w) => ({ ...w, ...progress(w.kind, w.id) }));
}
export const workFor = (personId) => allWork().filter((w) => isLive(w.kind, w.rec) && isOn(w.rec, personId));

// A project that becomes a sale: the deal takes over its tasks and notes.
export async function toDeal(project) {
  const deal = await create("deals", {
    name: project.name, organisation: null, region: null, kind: "customer", stage: "lead",
    owner_id: project.owner_id || null, people_ids: [...(project.people_ids || [])], contact_ids: [],
    summary: project.summary || null, source: project.source || null,
  });
  if (!deal) return null;
  for (const t of state.tasks.filter((t) => t.project_id === project.id)) await update("tasks", t.id, { deal_id: deal.id, project_id: null });
  for (const a of state.activity.filter((a) => a.entity_type === "project" && a.entity_id === project.id)) await update("activity", a.id, { entity_type: "deal", entity_id: deal.id }, { quiet: true });
  await remove("projects", project.id);
  return deal;
}

export { table as tableOf };
