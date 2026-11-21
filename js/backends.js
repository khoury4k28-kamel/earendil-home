// Two ways to load and save the hub's data. Both expose the same calls, so the
// screens don't know which one is in use.

import { TABLES } from "./store.js";

const EMPTY = { settings: {}, people: [], teams: [], goals: [], milestones: [], tasks: [], projects: [], deals: [], contacts: [], activity: [] };

// Local preview: reads the private seed file. Nothing is saved.
async function optional(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export async function previewBackend(seedUrl, { documents, radar } = {}) {
  let seed = EMPTY;
  let seedMissing = false;
  try {
    const res = await fetch(seedUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Seed file not found");
    seed = { ...EMPTY, ...(await res.json()) };
  } catch (err) {
    console.warn(err);
    seedMissing = true;
  }
  // Documents and the radar are read-only extras; the hub works without them.
  const docs = documents ? await optional(documents) : null;
  if (docs) seed = { ...seed, documents: docs.documents || [], documentsUpdated: docs.updated || null, documentsBase: documents.replace(/[^/]*$/, "") };
  const news = radar ? await optional(radar) : null;
  if (news) seed = { ...seed, radar: news, radarBase: radar.replace(/[^/]*$/, "") };
  return {
    mode: "preview",
    seedMissing,
    me: { email: null, label: "Preview" },
    async loadAll() { return seed; },
    async insert() {}, async update() {}, async remove() {}, async setSetting() {},
    onChange() {},
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("The sign-in service couldn't be loaded."));
    document.head.append(s);
  });
}

export async function supabaseClient(config) {
  if (!window.supabase) await loadScript(config.supabaseLib);
  return window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
}

async function ok(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Live: the shared Supabase database. Reads and writes run as the signed-in
// teammate, and the database's own rules decide what is allowed.
export function supabaseBackend(client, user) {
  return {
    mode: "live",
    me: { email: user.email, label: user.email },
    async loadAll() {
      const out = {};
      await Promise.all(TABLES.map(async (t) => { out[t] = await ok(client.from(t).select("*")); }));
      const rows = await ok(client.from("settings").select("*"));
      out.settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      return out;
    },
    insert: (table, row) => ok(client.from(table).insert(row)),
    update: (table, id, patch) => ok(client.from(table).update(patch).eq("id", id)),
    remove: (table, id) => ok(client.from(table).delete().eq("id", id)),
    setSetting: (key, value) => ok(client.from("settings").upsert({ key, value })),
    onChange(cb) {
      client.channel("hub").on("postgres_changes", { event: "*", schema: "public" }, cb).subscribe();
    },
  };
}
