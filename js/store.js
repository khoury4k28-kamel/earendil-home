// The hub's data, held in memory, with one set of read and write calls that
// every screen uses. A "backend" (local preview or Supabase) does the saving.

import { toast } from "./ui.js";

export const TABLES = ["people", "teams", "goals", "milestones", "tasks", "deals", "contacts", "activity"];

export const state = {
  mode: null,          // "preview" | "live"
  me: { id: null, email: null, name: null, label: "" },
  settings: {},
  people: [], teams: [], goals: [], milestones: [], tasks: [], deals: [], contacts: [], activity: [],
};

let backend = null;
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn(); }

export async function init(b) {
  backend = b;
  const data = await b.loadAll();
  state.mode = b.mode;
  state.settings = data.settings || {};
  for (const t of TABLES) state[t] = data[t] || [];
  const email = (b.me.email || "").toLowerCase();
  const person = email && state.people.find((p) => (p.email || "").toLowerCase() === email);
  state.me = { id: person ? person.id : null, email: b.me.email, name: person ? person.name : null, label: person ? person.name : b.me.email || b.me.label };
  b.onChange(applyRemote);
  emit();
}

function applyRemote({ table, eventType, new: row, old }) {
  if (table === "settings") {
    if (eventType === "DELETE") delete state.settings[old.key];
    else state.settings = { ...state.settings, [row.key]: row.value };
  } else if (TABLES.includes(table)) {
    if (eventType === "DELETE") state[table] = state[table].filter((r) => r.id !== old.id);
    else if (state[table].some((r) => r.id === row.id)) state[table] = state[table].map((r) => (r.id === row.id ? row : r));
    else state[table] = [...state[table], row];
  } else return;
  emit();
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

function failed(err, before, table) {
  console.error(err);
  state[table] = before;
  emit();
  toast("That change couldn't be saved. Check your connection and try again.");
}

export async function create(table, values) {
  const row = { id: newId(), ...values };
  const before = state[table];
  state[table] = [...before, row];
  emit();
  try { await backend.insert(table, row); } catch (err) { failed(err, before, table); return null; }
  return row;
}
export async function update(table, id, patch, { quiet = false } = {}) {
  const before = state[table];
  state[table] = before.map((r) => (r.id === id ? { ...r, ...patch } : r));
  emit();
  try { await backend.update(table, id, patch); } catch (err) {
    if (quiet) { console.warn(err); state[table] = before; emit(); } else failed(err, before, table);
    return false;
  }
  return true;
}

// Notes where the signed-in person is opening the hub from: their device's
// time zone and the time. No GPS and no outside service. Written at most
// every half hour, and never shown as an error if it can't be saved.
export function recordPresence(tz) {
  const me = byId("people", state.me.id);
  if (!me || !tz) return;
  const fresh = me.seen_at && Date.now() - new Date(me.seen_at).getTime() < 30 * 60 * 1000;
  if (me.tz === tz && fresh) return;
  update("people", me.id, { tz, seen_at: new Date().toISOString() }, { quiet: true });
}
export async function remove(table, id) {
  const before = state[table];
  state[table] = before.filter((r) => r.id !== id);
  emit();
  try { await backend.remove(table, id); } catch (err) { failed(err, before, table); return false; }
  return true;
}
export async function saveSetting(key, value) {
  const before = state.settings;
  state.settings = { ...before, [key]: value };
  emit();
  try { await backend.setSetting(key, value); } catch (err) {
    console.error(err);
    state.settings = before;
    emit();
    toast("That change couldn't be saved. Check your connection and try again.");
  }
}
export function addNote(entityType, entityId, body) {
  // author and created_at are sent so the note shows at once; the database
  // replaces both with the signed-in person and its own clock.
  return create("activity", {
    entity_type: entityType, entity_id: entityId, body,
    author: state.me.label || "Team", source: "manual", created_at: new Date().toISOString(),
  });
}

// ---------- lookups ----------
export const byId = (table, id) => (id ? state[table].find((r) => r.id === id) : null) || null;
export const personName = (id) => byId("people", id)?.name || "";
export const teamName = (id) => byId("teams", id)?.name || "";
export const isOpenDeal = (d) => d.stage !== "signed" && d.stage !== "closed";
export const dealsForPerson = (id) => state.deals.filter((d) => d.owner_id === id || (d.people_ids || []).includes(id));
export const dealsForContact = (id) => state.deals.filter((d) => (d.contact_ids || []).includes(id));
export const tasksForPerson = (id) => state.tasks.filter((t) => t.owner_id === id);
export const notesFor = (type, id) => state.activity
  .filter((a) => a.entity_type === type && a.entity_id === id)
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
export const sortByName = (rows) => [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
