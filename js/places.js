// Where people and contacts are. A person's place comes from the time zone
// their device reported when they last opened the hub (no GPS, no outside
// service), or from what was typed in "Based in". A contact's comes from its
// country.

import { PLACES, ZONES } from "./geo.js";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

// name or alias -> place, longest names first so "South Sudan" wins over "Sudan"
const NAMES = PLACES.flatMap((p) => [p[1], ...(p[5] ? p[5].split("|") : [])].map((n) => [norm(n), p]))
  .sort((a, b) => b[0].length - a[0].length);
const asPlace = (p) => p && { code: p[0], name: p[1], x: p[2], y: p[3], shape: p[4] };
const BY_CODE = new Map(PLACES.map((p) => [p[0], p]));

// The country named in a piece of text ("Athens, Greece", "USA"), if any.
export function findCountry(text) {
  const t = " " + norm(text) + " ";
  if (t.trim() === "") return null;
  const hit = NAMES.find(([n]) => t.includes(" " + n + " "));
  return asPlace(hit && hit[1]);
}

// Every country named in a piece of text ("Europe: Greece + Cyprus").
export function findCountries(text) {
  let t = " " + norm(text) + " ";
  const out = [];
  for (const [n, p] of NAMES) {
    const at = t.indexOf(" " + n + " ");
    if (at < 0) continue;
    if (!out.some((x) => x.code === p[0])) out.push(asPlace(p));
    t = t.slice(0, at + 1) + "#".repeat(n.length) + t.slice(at + 1 + n.length);
  }
  return out;
}

// "Europe/Athens" -> { city: "Athens", country place, x, y }
export function zonePlace(tz) {
  const z = tz && ZONES[tz];
  if (!z) return null;
  return { city: tz.split("/").pop().replace(/_/g, " "), country: asPlace(BY_CODE.get(z[0])), x: z[1], y: z[2] };
}

// The clock time in a zone right now, e.g. "16:42".
export function timeIn(tz) {
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date()); } catch { return ""; }
}
export function deviceZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
}

// Where a team member is: live from their time zone if we have it, else from "Based in".
export function personPlace(p) {
  const zone = zonePlace(p.tz);
  const typed = findCountry(p.location);
  const at = zone ? { x: zone.x, y: zone.y, country: zone.country } : typed ? { x: typed.x, y: typed.y, country: typed } : null;
  const parts = [];
  if (p.location) parts.push(p.location);
  if (zone) parts.push(`${zone.city} time, ${timeIn(p.tz)}`);
  return { ...at, located: Boolean(at), live: Boolean(zone), text: parts.join(" · ") };
}
