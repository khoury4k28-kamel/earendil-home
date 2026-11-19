// Builds js/geo.js: country outlines, a list of countries with a point each,
// and where each time zone sits. Nothing in it is ours: the outlines are
// Natural Earth (public domain) as packaged by world-atlas 2.0.2 (ISC), and the
// time zone table is IANA's zone.tab (public domain).
//
// Run:  node tools/build-geo.mjs <countries-110m.json> <zone.tab> js/geo.js

import { readFileSync, writeFileSync } from "node:fs";

const [atlasPath, zonePath, outPath] = process.argv.slice(2);
if (!atlasPath || !zonePath || !outPath) { console.error("Usage: node tools/build-geo.mjs <countries-110m.json> <zone.tab> <out.js>"); process.exit(2); }

// ---------- projection (Miller: familiar shape, the far north not stretched as much as Mercator) ----------
const W = 1000, TOP = 84, BOTTOM = -57;
const miller = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * (lat * Math.PI / 180)));
const K = W / (2 * Math.PI);
const H = Math.round((miller(TOP) - miller(BOTTOM)) * K);
const project = (lon, lat) => [(lon + 180) / 360 * W, (miller(TOP) - miller(Math.max(BOTTOM, Math.min(TOP, lat)))) * K];
const r1 = (n) => Math.round(n * 10) / 10;

// ---------- read the outlines ----------
const topo = JSON.parse(readFileSync(atlasPath, "utf8"));
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; });
});
function ring(indexes) {
  const pts = [];
  for (const i of indexes) {
    const arc = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
    pts.push(...(pts.length ? arc.slice(1) : arc));
  }
  return pts;
}
// Some outlines cross the 180° line (Russia, Fiji). Drawn naively they streak
// across the whole map. Make the longitudes run on without a jump, then add a
// copy one world to the side, so both edges of the map get their piece.
function unwrapped(pts) {
  let shift = 0;
  const run = pts.map((p, i) => {
    if (i) { const d = p[0] - pts[i - 1][0]; if (d > 180) shift -= 360; else if (d < -180) shift += 360; }
    return [p[0] + shift, p[1]];
  });
  const lons = run.map((p) => p[0]);
  const copies = [run];
  if (Math.max(...lons) > 180) copies.push(run.map(([x, y]) => [x - 360, y]));
  if (Math.min(...lons) < -180) copies.push(run.map(([x, y]) => [x + 360, y]));
  return copies.map((c) => c.map(([lon, lat]) => project(lon, lat)));
}
const area = (pts) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; const f = p[0] * q[1] - q[0] * p[1]; a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; });
  return a ? [cx / (3 * a), cy / (3 * a)] : pts[0];
}
function pathOf(pts) {
  const out = [];
  let last = "";
  for (const [x, y] of pts) { const s = `${r1(x)},${r1(y)}`; if (s !== last) out.push(s); last = s; }
  return out.length > 2 ? "M" + out.join("L") + "Z" : "";
}

const shapes = [];
for (const g of topo.objects.countries.geometries) {
  if (g.properties.name === "Antarctica") continue;
  const polys = (g.type === "Polygon" ? [g.arcs] : g.arcs).map((poly) => poly.map((r) => unwrapped(ring(r))));
  const outer = polys.map((p) => p[0][0]).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
  const d = polys.flat(2).map(pathOf).join("");
  if (d) shapes.push({ name: g.properties.name, d, at: centroid(outer) });
}

// ---------- countries, by two-letter code ----------
const zoneRows = readFileSync(zonePath, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t"));
function coords(s) {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(s);
  const deg = (sign, d, mnt, sec) => (sign === "-" ? -1 : 1) * (+d + +mnt / 60 + (+sec || 0) / 3600);
  return [deg(m[5], m[6], m[7], m[8]), deg(m[1], m[2], m[3], m[4])]; // lon, lat
}
const display = new Intl.DisplayNames(["en"], { type: "region" });
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

// Natural Earth shortens some names; this says which country each one is.
const SHAPE_CODE = {
  "United States of America": "US", "Dem. Rep. Congo": "CD", "Congo": "CG", "Dominican Rep.": "DO", "Central African Rep.": "CF",
  "Eq. Guinea": "GQ", "W. Sahara": "EH", "S. Sudan": "SS", "Bosnia and Herz.": "BA", "Macedonia": "MK", "North Macedonia": "MK",
  "Solomon Is.": "SB", "Falkland Is.": "FK", "Fr. S. Antarctic Lands": "TF", "Côte d'Ivoire": "CI", "eSwatini": "SZ",
  "Myanmar": "MM", "Palestine": "PS", "Turkey": "TR", "Timor-Leste": "TL", "Trinidad and Tobago": "TT", "Czechia": "CZ",
};
// Other things people type for a country.
const ALIASES = {
  US: "usa|us|united states of america", GB: "uk|britain|great britain|england|scotland|wales", AE: "uae|emirates",
  CZ: "czech republic", TR: "turkey|turkiye", KR: "south korea|korea", KP: "north korea", RU: "russian federation", NL: "holland|the netherlands",
  CI: "ivory coast", MM: "burma|myanmar", PS: "palestine", BA: "bosnia", CD: "drc|dr congo", VN: "viet nam", SA: "ksa", MK: "macedonia",
  CV: "cabo verde", TL: "east timor", SZ: "swaziland", HK: "hong kong", MO: "macau",
};

const codes = [...new Set(zoneRows.map((r) => r[0]))];
const byName = new Map(codes.map((c) => [norm(display.of(c)), c]));
const shapeOf = new Map();
const unmatched = [];
shapes.forEach((s, i) => {
  const code = SHAPE_CODE[s.name] || byName.get(norm(s.name));
  if (code) shapeOf.set(code, i); else unmatched.push(s.name);
});
const places = codes.map((c) => {
  const i = shapeOf.has(c) ? shapeOf.get(c) : -1;
  const [x, y] = i >= 0 ? shapes[i].at : project(...coords(zoneRows.find((r) => r[0] === c)[1]));
  return [c, display.of(c), r1(x), r1(y), i, ALIASES[c] || ""];
}).sort((a, b) => a[1].localeCompare(b[1]));

// ---------- time zones ----------
const zones = {};
for (const [code, at, tz] of zoneRows) { const [x, y] = project(...coords(at)); zones[tz] = [code, r1(x), r1(y)]; }
// Older names that some devices still report.
const OLD = {
  "Europe/Kiev": "Europe/Kyiv", "Europe/Kyiv": "Europe/Kiev", "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu", "Asia/Rangoon": "Asia/Yangon", "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "US/Eastern": "America/New_York", "US/Central": "America/Chicago", "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles",
  "Europe/Belfast": "Europe/London", "America/Indianapolis": "America/Indiana/Indianapolis", "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk", "America/Nuuk": "America/Godthab", "Asia/Istanbul": "Europe/Istanbul",
};
for (const [old, now] of Object.entries(OLD)) if (!zones[old] && zones[now]) zones[old] = zones[now];

const out = `// Generated by tools/build-geo.mjs. Do not edit by hand.
// Country outlines: Natural Earth (public domain), via world-atlas 2.0.2 (ISC).
// Time zones: IANA zone.tab (public domain).

export const W = ${W};
export const H = ${H};
const TOP = ${TOP}, BOTTOM = ${BOTTOM};
const miller = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * (lat * Math.PI / 180)));
// Longitude and latitude to a point on the map.
export const project = (lon, lat) => [(lon + 180) / 360 * W, (miller(TOP) - miller(Math.max(BOTTOM, Math.min(TOP, lat)))) * W / (2 * Math.PI)];

// One outline per country.
export const SHAPES = ${JSON.stringify(shapes.map((s) => s.d))};

// [code, name, x, y, index of its outline or -1, other names people type]
export const PLACES = ${JSON.stringify(places)};

// Time zone name -> [country code, x, y]
export const ZONES = ${JSON.stringify(zones)};
`;
writeFileSync(outPath, out);
console.log(`${shapes.length} outlines, ${places.length} countries (${shapeOf.size} with an outline), ${Object.keys(zones).length} time zones, ${Math.round(out.length / 1024)} KB, map ${W}×${H}`);
if (unmatched.length) console.log("Outlines with no country code (drawn, but nothing is pinned to them):", unmatched.join(", "));
