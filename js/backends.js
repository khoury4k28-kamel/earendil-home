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
  // PKCE: Microsoft hands back a one-time code in "?code=", not tokens in the
  // "#" part of the address, which the hub uses for its own sections.
  return window.supabase.createClient(config.supabaseUrl, config.supabaseKey, { auth: { flowType: "pkce" } });
}

async function ok(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Live: the Radar and the Documents tab are files in two private storage
// buckets. Each file is opened through a signed address that works for a day
// and is only handed to people on the team list. Both are extras: if either
// is missing the hub still opens, without that part.
const DAY = 24 * 60 * 60;
async function storedJson(client, bucket, path) {
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}
async function signed(client, bucket, paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await client.storage.from(bucket).createSignedUrls(list, DAY);
  if (error || !data) return {};
  return Object.fromEntries(data.filter((r) => r.signedUrl && !r.error).map((r) => [r.path, r.signedUrl]));
}
async function liveRadar(client) {
  const radar = await storedJson(client, "radar", "radar.json");
  if (!radar || !Array.isArray(radar.items)) return null;
  const urls = await signed(client, "radar", radar.items.map((it) => it.thumb));
  // A headline whose picture can't be opened is left out, as everywhere else.
  return { ...radar, items: radar.items.filter((it) => urls[it.thumb]).map((it) => ({ ...it, thumb: urls[it.thumb] })) };
}
async function liveDocuments(client) {
  const index = await storedJson(client, "documents", "index.json");
  if (!index || !Array.isArray(index.documents)) return null;
  const urls = await signed(client, "documents", index.documents.flatMap((d) => [d.file, d.thumb]));
  const documents = index.documents.filter((d) => urls[d.file] && urls[d.thumb])
    .map((d) => ({ ...d, file: urls[d.file], thumb: urls[d.thumb] }));
  return { documents, updated: index.updated || null };
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
      const [radar, docs] = await Promise.all([liveRadar(client).catch(() => null), liveDocuments(client).catch(() => null)]);
      if (radar) out.radar = radar;
      if (docs) { out.documents = docs.documents; out.documentsUpdated = docs.updated; }
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
