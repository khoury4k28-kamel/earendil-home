// The CRM map: where contacts, deals and the team are, by country. Filters on
// the left, the map in the middle, the matching list on the right.

import { h, refresh, plural } from "../ui.js";
import { state, byId, dealsForContact, sortByName } from "../store.js";
import { CATEGORIES, categoryLabel, stageLabel } from "../schema.js";
import { openContact, openDeal, openPerson, dealIssues } from "../detail.js";
import { W, H, SHAPES, project } from "../geo.js";
import { findCountry, findCountries, personPlace } from "../places.js";

// ---------- what the map is showing (kept while you move around the hub) ----------
const layers = { contact: true, deal: true, person: false };
let cat = "all";
let onlyDeal = false;
let offMap = false;      // list the contacts that have no country yet
let sel = null;          // selected country code
let query = "";
let region = "fit";
let view = null;         // { cx, cy, k }: centre and zoom; null = fit the region
let observer = null;

export function showTeamOnMap() {
  layers.person = true;
  sel = null; offMap = false; region = "fit"; view = null;
}

// [west, south, east, north]
const REGIONS = [
  ["fit", "All pins", null],
  ["world", "World", [-180, -57, 180, 84]],
  ["europe", "Europe", [-12, 34, 42, 62]],
  ["namerica", "North America", [-128, 14, -62, 56]],
  ["latam", "Latin America", [-96, -42, -32, 26]],
  ["mideast", "Middle East", [24, 11, 62, 43]],
  ["asia", "Asia-Pacific", [62, -46, 178, 54]],
];

const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
  el.append(...kids.flat().filter(Boolean));
  return el;
}
const uniq = (places) => [...new Map(places.filter(Boolean).map((p) => [p.code, p])).values()];

// ---------- the things on the map ----------
function collect() {
  const out = [];
  if (layers.contact) {
    for (const c of state.contacts) {
      if (cat !== "all" && c.category !== cat) continue;
      if (onlyDeal && !dealsForContact(c.id).length) continue;
      out.push({ kind: "contact", id: c.id, name: c.name, places: uniq([findCountry(c.country)]),
        meta: [c.organisation !== c.name && c.organisation, categoryLabel(c.category)].filter(Boolean).join(" · "),
        hay: [c.name, c.organisation, c.title, c.country].join(" "), open: () => openContact(c.id) });
    }
  }
  if (layers.deal) {
    for (const d of state.deals) {
      const linked = (d.contact_ids || []).map((id) => findCountry(byId("contacts", id)?.country));
      out.push({ kind: "deal", id: d.id, name: d.name, places: uniq([...findCountries(d.region), ...linked]),
        meta: [stageLabel(d.stage), d.organisation].filter(Boolean).join(" · "), attention: dealIssues(d).length > 0,
        hay: [d.name, d.organisation, d.region].join(" "), open: () => openDeal(d.id) });
    }
  }
  if (layers.person) {
    for (const p of state.people) {
      const at = personPlace(p);
      out.push({ kind: "person", id: p.id, name: p.name, places: at.located && at.country ? [{ ...at.country, x: at.x, y: at.y }] : [],
        meta: [p.title, at.text].filter(Boolean).join(" · "), hay: [p.name, p.title, p.location].join(" "), open: () => openPerson(p.id) });
    }
  }
  return out;
}

// ---------- the map itself ----------
// The centre and zoom that show a box of the map ([x0, y0, x1, y1], map units).
function fit([x0, y0, x1, y1], aspect) {
  const vw = Math.max(x1 - x0, (y1 - y0) * aspect, 90) * 1.06;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k: W / vw };
}
function regionBox(pins) {
  const lonlat = REGIONS.find((x) => x[0] === region)[2];
  if (lonlat) { const [x0, y1] = project(lonlat[0], lonlat[1]); const [x1, y0] = project(lonlat[2], lonlat[3]); return [x0, y0, x1, y1]; }
  if (!pins.length) return [0, 0, W, H];
  const xs = pins.map((p) => p.x), ys = pins.map((p) => p.y);
  const pad = 34;
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}
const KIND_LABEL = { contact: ["contact", "contacts"], deal: ["deal", "deals"], person: ["team member", "team members"] };
const ORDER = ["contact", "deal", "person"];

function mapPane(items) {
  // One bubble per kind per country.
  const groups = new Map();
  for (const it of items) for (const p of it.places) {
    const key = it.kind + ":" + p.code;
    if (!groups.has(key)) groups.set(key, { kind: it.kind, code: p.code, name: p.name, x: p.x, y: p.y, shape: p.shape, n: 0 });
    groups.get(key).n += 1;
  }
  const perCountry = new Map();
  for (const g of groups.values()) perCountry.set(g.code, (perCountry.get(g.code) || 0) + g.n);
  const shade = new Map();
  for (const g of groups.values()) if (g.shape >= 0) shade.set(g.shape, g.code);

  const svg = s("svg", { role: "img", "aria-label": "World map" },
    s("clipPath", { id: "map-edge" }, s("rect", { x: 0, y: 0, width: W, height: H })),
    s("g", { "clip-path": "url(#map-edge)" }, SHAPES.map((d, i) => {
      const code = shade.get(i);
      const n = code ? perCountry.get(code) : 0;
      return s("path", { d, class: "land" + (code === sel && code ? " land--sel" : n >= 5 ? " land--3" : n >= 2 ? " land--2" : n === 1 ? " land--1" : "") });
    })));

  // In each country the bubbles sit side by side (contacts, deals, team), with the country code under them.
  const nodes = [];
  const sizeOf = (g) => (g.n === 1 ? 14 : Math.round(20 + 7 * Math.sqrt(g.n)));
  for (const code of perCountry.keys()) {
    const here = [...groups.values()].filter((g) => g.code === code).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    const gap = 3;
    const total = here.reduce((t, g) => t + sizeOf(g), 0) + gap * (here.length - 1);
    let left = -total / 2;
    for (const g of here) { g.dx = left + sizeOf(g) / 2; g.at = here[0]; left += sizeOf(g) + gap; }
    nodes.push([h("span", { class: "map__label", "aria-hidden": "true" }, code), here[0].x, here[0].y, 0, Math.max(...here.map(sizeOf)) / 2 + 3]);
  }
  for (const g of [...groups.values()].sort((a, b) => b.n - a.n)) {
    const size = sizeOf(g);
    const [dx, dy] = [g.dx, 0];
    const btn = h("button", {
      class: "bubble bubble--" + g.kind, type: "button", "aria-pressed": String(sel === g.code),
      title: `${g.name}: ${plural(g.n, ...KIND_LABEL[g.kind])}`, "aria-label": `${g.name}: ${plural(g.n, ...KIND_LABEL[g.kind])}`,
      style: `width:${size}px;height:${size}px`,
      onclick: () => { sel = sel === g.code ? null : g.code; offMap = false; refresh(); },
    }, g.n > 1 ? g.n : "");
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    nodes.push([btn, g.at.x, g.at.y, dx, dy]);
  }

  const zoomBtn = (label, name, run) => {
    const b = h("button", { type: "button", "aria-label": name, title: name, onclick: run }, label);
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    return b;
  };
  const el = h("div", { class: "map" }, svg, nodes.map((n) => n[0]),
    h("div", { class: "map__zoom" },
      zoomBtn("+", "Zoom in", () => zoom(1.6)), zoomBtn("−", "Zoom out", () => zoom(1 / 1.6)),
      zoomBtn("⟲", "Back to the whole region", () => { view = null; draw(); })));

  function draw() {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const aspect = r.width / r.height;
    if (!view) view = fit(regionBox([...groups.values()]), aspect);
    const vw = W / view.k, vh = vw / aspect;
    view.cx = Math.max(0, Math.min(W, view.cx));
    view.cy = Math.max(0, Math.min(H, view.cy));
    const x0 = view.cx - vw / 2, y0 = view.cy - vh / 2;
    svg.setAttribute("viewBox", `${x0} ${y0} ${vw} ${vh}`);
    for (const [node, x, y, dx, dy] of nodes) {
      node.style.left = ((x - x0) / vw) * r.width + dx + "px";
      node.style.top = ((y - y0) / vh) * r.height + dy + "px";
    }
  }
  function zoom(f) {
    if (!view) return;
    view.k = Math.max(0.8, Math.min(60, view.k * f));
    draw();
  }

  // Drag to move the map.
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    if (!view) return;
    drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = el.getBoundingClientRect();
    const vw = W / view.k;
    view.cx = drag.cx - ((e.clientX - drag.x) / r.width) * vw;
    view.cy = drag.cy - ((e.clientY - drag.y) / r.height) * (vw * r.height / r.width);
    draw();
  });
  for (const type of ["pointerup", "pointercancel"]) el.addEventListener(type, () => { drag = null; el.classList.remove("is-dragging"); });

  observer?.disconnect();
  observer = new ResizeObserver(draw);
  observer.observe(el);
  return el;
}

// ---------- filters on the left ----------
function pill(label, pressed, onclick, n) {
  return h("button", { class: "filter", type: "button", "aria-pressed": String(pressed), onclick }, label, n != null && h("span", { class: "num" }, n));
}
function group(label, ...pills) {
  return h("div", { class: "rail__group" }, h("div", { class: "rail__label" }, label), h("div", { class: "filters" }, pills));
}
function rail(missing) {
  const set = (fn) => () => { fn(); refresh(); };
  return h("aside", { class: "rail", "aria-label": "Filters" },
    missing > 0 && group("Attention",
      pill("Not on the map", offMap, set(() => { offMap = !offMap; sel = null; }), missing)),
    group("Go to", REGIONS.map(([id, label]) => pill(label, region === id, set(() => { region = id; view = null; })))),
    group("Category",
      pill("All", cat === "all", set(() => { cat = "all"; })),
      CATEGORIES.map((c) => pill(c.many, cat === c.value, set(() => { cat = c.value; layers.contact = true; })))),
    group("Relationship", pill("Only with a deal", onlyDeal, set(() => { onlyDeal = !onlyDeal; layers.contact = true; }))),
    group("Layers",
      pill("Contacts", layers.contact, set(() => { layers.contact = !layers.contact; }), state.contacts.length),
      pill("Deals", layers.deal, set(() => { layers.deal = !layers.deal; }), state.deals.length),
      pill("Team", layers.person, set(() => { layers.person = !layers.person; }), state.people.length)));
}

// ---------- the list on the right ----------
function listPane(items) {
  const q = query.trim().toLowerCase();
  const shown = items.filter((it) =>
    (!q || it.hay.toLowerCase().includes(q)) &&
    (offMap ? it.kind === "contact" && !it.places.length : !sel || it.places.some((p) => p.code === sel)));
  const selName = sel && items.flatMap((it) => it.places).find((p) => p.code === sel)?.name;
  const search = h("input", { class: "input", id: "map-search", type: "search", placeholder: "Search", value: query, "aria-label": "Search the list" });
  search.addEventListener("input", () => { query = search.value; refresh(); });
  const section = (kind, title) => {
    const rows = sortByName(shown.filter((it) => it.kind === kind));
    return rows.length > 0 && h("div", { class: "block" },
      h("div", { class: "rail__label" }, `${title} · ${rows.length}`),
      h("ul", null, rows.map((it) => h("li", { class: "arow" },
        h("button", { class: "arow__main", type: "button", onclick: it.open },
          h("div", { class: "arow__title" }, it.name), it.meta && h("div", { class: "arow__text" }, it.meta))))));
  };
  const parts = [section("deal", "Deals"), section("contact", "Contacts"), section("person", "Team")].filter(Boolean);
  return h("aside", { class: "maplist", "aria-label": "List" },
    (selName || offMap) && h("div", { class: "maplist__head" },
      h("h2", { class: "h3" }, offMap ? "Not on the map" : selName),
      h("button", { class: "quiet", type: "button", onclick: () => { sel = null; offMap = false; refresh(); } }, "Clear")),
    offMap && h("div", { class: "small muted" }, "Open a contact and add its country to place it."),
    search,
    parts.length ? parts : h("div", { class: "muted" }, "Nothing here."));
}

export function render() {
  const items = collect();
  if (sel && !items.some((it) => it.places.some((p) => p.code === sel))) sel = null;
  const missing = items.filter((it) => it.kind === "contact" && !it.places.length).length;
  if (!missing) offMap = false;
  return h("main", { class: "page page--map" },
    h("div", { class: "crumbs" }, h("a", { href: "#crm" }, "CRM"), h("span", { class: "muted" }, " / "), h("b", null, "Map")),
    h("div", { class: "mapgrid" }, rail(missing), mapPane(items), listPane(items)));
}

// A small still map for the CRM landing card.
export function miniMap() {
  const dots = uniq(state.contacts.map((c) => findCountry(c.country)));
  return s("svg", { viewBox: `0 0 ${W} ${H}`, class: "minimap", role: "img", "aria-label": "Where contacts are" },
    s("clipPath", { id: "mini-edge" }, s("rect", { x: 0, y: 0, width: W, height: H })),
    s("path", { d: SHAPES.join(""), class: "land", "clip-path": "url(#mini-edge)" }),
    dots.map((p) => s("circle", { cx: p.x, cy: p.y, r: 7, class: "minidot" })));
}
