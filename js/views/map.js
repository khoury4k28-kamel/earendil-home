// The CRM map: where contacts, deals and the team are, by country. Filters on
// the left, the map in the middle, the matching list on the right.
//
// The map moves like a map: scroll or pinch to zoom at the cursor, drag to
// pan (it glides on release), double-click to zoom in, click a country or a
// bubble to fly to it. Hovering a country, a bubble or a row in the list shows
// what is there.

import { h, refresh, plural } from "../ui.js";
import { state, byId, dealsForContact, sortByName } from "../store.js";
import { CATEGORIES, categoryLabel, stageLabel } from "../schema.js";
import { openContact, openDeal, openPerson, dealIssues } from "../detail.js";
import { W, H, SHAPES, PLACES, project } from "../geo.js";
import { findCountry, findCountries, personPlace } from "../places.js";

// ---------- what the map is showing (kept while you move around the hub) ----------
const layers = { contact: true, deal: true, person: false };
let cat = "all";
let onlyDeal = false;
let offMap = false;      // list the contacts that have no country yet
let sel = null;          // selected country code
let query = "";
let region = "fit";
let view = null;         // { cx, cy, k }: centre and zoom
let flyNext = null;      // "region" | "sel": fly there once the map is redrawn
let introDone = false;   // the first opening flies in from the whole world
let lastPins = "";       // which bubbles were on the map last time (new ones pop in)
let observer = null;
let frame = 0;           // the running animation, if any
let highlight = () => {};

export function showTeamOnMap() {
  layers.person = true;
  sel = null; offMap = false; region = "fit"; view = null; introDone = false;
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
const NAME_OF_SHAPE = new Map(PLACES.filter((p) => p[4] >= 0).map((p) => [p[4], p]));
const calm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
  el.append(...kids.flat().filter(Boolean));
  return el;
}
const uniq = (places) => [...new Map(places.filter(Boolean).map((p) => [p.code, p])).values()];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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

// ---------- where to look ----------
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
// The box around a country's main landmass (not its far-off islands).
const boxes = new Map();
function shapeBox(i) {
  if (!boxes.has(i)) {
    let best = null;
    for (const part of SHAPES[i].split("M").filter(Boolean)) {
      const nums = part.replace(/[LZ]/g, " ").trim().split(/[\s,]+/).map(Number);
      const xs = nums.filter((_, n) => n % 2 === 0), ys = nums.filter((_, n) => n % 2 === 1);
      const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      if (!best || (b[2] - b[0]) * (b[3] - b[1]) > (best[2] - best[0]) * (best[3] - best[1])) best = b;
    }
    const px = (best[2] - best[0]) * 0.35 + 8, py = (best[3] - best[1]) * 0.35 + 8;
    boxes.set(i, [best[0] - px, best[1] - py, best[2] + px, best[3] + py]);
  }
  return boxes.get(i);
}

const KIND_LABEL = { contact: ["contact", "contacts"], deal: ["deal", "deals"], person: ["team member", "team members"] };
const ORDER = ["contact", "deal", "person"];

function mapPane(items) {
  // One bubble per kind per country.
  const groups = new Map();
  for (const it of items) for (const p of it.places) {
    const key = it.kind + ":" + p.code;
    if (!groups.has(key)) groups.set(key, { key, kind: it.kind, code: p.code, name: p.name, x: p.x, y: p.y, shape: p.shape, n: 0, names: [] });
    const g = groups.get(key);
    g.n += 1;
    g.names.push(it.name);
  }
  const all = [...groups.values()];
  const perCountry = new Map();
  for (const g of all) perCountry.set(g.code, (perCountry.get(g.code) || 0) + g.n);
  const codeOfShape = new Map();
  for (const g of all) if (g.shape >= 0) codeOfShape.set(g.shape, g.code);
  const summary = (code) => all.filter((g) => g.code === code).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
    .map((g) => plural(g.n, ...KIND_LABEL[g.kind])).join(" · ");

  const svg = s("svg", { role: "img", "aria-label": "World map" },
    s("clipPath", { id: "map-edge" }, s("rect", { x: 0, y: 0, width: W, height: H })),
    s("g", { "clip-path": "url(#map-edge)" }, SHAPES.map((d, i) => {
      const code = codeOfShape.get(i);
      const n = code ? perCountry.get(code) : 0;
      return s("path", { d, "data-i": i, class: "land" + (code ? " land--has" : "") + (code === sel && code ? " land--sel" : n >= 5 ? " land--3" : n >= 2 ? " land--2" : n === 1 ? " land--1" : "") });
    })));

  // In each country the bubbles sit side by side (contacts, deals, team), with the country's name under them.
  const nodes = [];
  const sizeOf = (g) => (g.n === 1 ? 14 : Math.round(20 + 7 * Math.sqrt(g.n)));
  for (const code of perCountry.keys()) {
    const here = all.filter((g) => g.code === code).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    const gap = 3;
    const total = here.reduce((t, g) => t + sizeOf(g), 0) + gap * (here.length - 1);
    let left = -total / 2;
    for (const g of here) { g.dx = left + sizeOf(g) / 2; g.at = here[0]; left += sizeOf(g) + gap; }
    nodes.push({ el: h("span", { class: "map__label", "aria-hidden": "true" }, code), x: here[0].x, y: here[0].y, dx: 0, dy: Math.max(...here.map(sizeOf)) / 2 + 3, code, name: here[0].name });
  }
  const tip = h("div", { class: "maptip", hidden: true });
  function showTip(x, y, title, lines) {
    tip.replaceChildren(h("b", null, title), ...lines.map((l) => h("div", null, l)));
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    tip.style.left = clamp(x - r.left + 14, 8, r.width - tip.offsetWidth - 8) + "px";
    tip.style.top = clamp(y - r.top + 16, 8, r.height - tip.offsetHeight - 8) + "px";
  }
  const hideTip = () => { tip.hidden = true; };

  const fresh = all.map((g) => g.key).sort().join("|") !== lastPins;
  lastPins = all.map((g) => g.key).sort().join("|");
  all.sort((a, b) => b.n - a.n).forEach((g, order) => {
    const label = `${g.name}: ${plural(g.n, ...KIND_LABEL[g.kind])}`;
    const btn = h("button", {
      class: "bubble bubble--" + g.kind, type: "button", "aria-pressed": String(sel === g.code), "aria-label": label, "data-code": g.code,
      onclick: () => select(g.code),
    }, g.n > 1 ? g.n : "");
    if (fresh && !calm()) btn.style.animationDelay = order * 28 + "ms";
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("pointerenter", (e) => showTip(e.clientX, e.clientY, label, [...g.names.sort().slice(0, 5), g.names.length > 5 && `+ ${g.names.length - 5} more`].filter(Boolean)));
    btn.addEventListener("pointerleave", hideTip);
    nodes.push({ el: btn, x: g.at.x, y: g.at.y, dx: g.dx, dy: 0, size: sizeOf(g), code: g.code });
  });

  const control = (label, name, run) => {
    const b = h("button", { type: "button", "aria-label": name, title: name, onclick: run }, label);
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("dblclick", (e) => e.stopPropagation());
    return b;
  };
  const el = h("div", { class: "map" + (fresh && !calm() ? " map--fresh" : "") }, svg, nodes.map((n) => n.el), tip,
    h("div", { class: "map__zoom" },
      control("+", "Zoom in", () => zoomBy(1.8)), control("−", "Zoom out", () => zoomBy(1 / 1.8)),
      control("⟲", "Back to the whole region", () => flyTo(fit(regionBox(all), aspect())))));

  const rect = () => el.getBoundingClientRect();
  const aspect = () => { const r = rect(); return r.width / r.height; };

  function draw() {
    const r = rect();
    if (!r.width || !r.height || !view) return;
    view.k = clamp(view.k, 0.8, 80);
    view.cx = clamp(view.cx, 0, W);
    view.cy = clamp(view.cy, 0, H);
    const vw = W / view.k, vh = vw * r.height / r.width;
    const x0 = view.cx - vw / 2, y0 = view.cy - vh / 2;
    svg.setAttribute("viewBox", `${x0} ${y0} ${vw} ${vh}`);
    // Bubbles grow a little as you come closer, and codes become names.
    const grow = clamp(0.9 + 0.13 * Math.log2(view.k), 0.9, 1.7);
    const close = view.k >= 3.2;
    for (const n of nodes) {
      n.el.style.left = ((n.x - x0) / vw) * r.width + n.dx * grow + "px";
      n.el.style.top = ((n.y - y0) / vh) * r.height + n.dy * grow + "px";
      if (n.size) {
        n.el.style.width = n.el.style.height = n.size * grow + "px";
        n.el.style.fontSize = 12 * Math.min(grow, 1.3) + "px";
      } else if (n.el.textContent !== (close ? n.name : n.code)) n.el.textContent = close ? n.name : n.code;
    }
  }

  // ---------- movement ----------
  function stop() { cancelAnimationFrame(frame); frame = 0; }
  function flyTo(target, ms = 620) {
    stop();
    if (!view || calm()) { view = target; draw(); return; }
    const from = { ...view };
    const start = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms), e = ease(t);
      view = { cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e, k: from.k * Math.pow(target.k / from.k, e) };
      draw();
      frame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    frame = requestAnimationFrame(step);
  }
  // Zoom so the point under (clientX, clientY) stays under it.
  function zoomed(f, clientX, clientY) {
    const r = rect();
    const fx = (clientX - r.left) / r.width - 0.5, fy = (clientY - r.top) / r.height - 0.5;
    const vw = W / view.k, vh = vw * r.height / r.width;
    const k = clamp(view.k * f, 0.8, 80);
    const vw2 = W / k, vh2 = vw2 * r.height / r.width;
    return { cx: view.cx + fx * (vw - vw2), cy: view.cy + fy * (vh - vh2), k };
  }
  function zoomBy(f) {
    if (!view) return;
    const r = rect();
    flyTo(zoomed(f, r.left + r.width / 2, r.top + r.height / 2), 280);
  }
  function select(code) {
    sel = sel === code ? null : code;
    offMap = false;
    flyNext = sel ? "sel" : null;
    refresh();
  }

  el.addEventListener("wheel", (e) => {
    if (!view) return;
    e.preventDefault();
    stop();
    hideTip();
    view = zoomed(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018)), e.clientX, e.clientY);
    draw();
  }, { passive: false });
  el.addEventListener("dblclick", (e) => { if (view) flyTo(zoomed(2.2, e.clientX, e.clientY), 300); });

  // One finger or the mouse drags; two fingers pinch. A drag glides on after release.
  const touches = new Map();
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    if (!view) return;
    stop();
    hideTip();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0, target: e.target, vx: 0, vy: 0, t: performance.now(), pinch: touches.size > 1 };
    el.classList.add("is-dragging");
  });
  el.addEventListener("pointermove", (e) => {
    if (!touches.has(e.pointerId)) {
      // Not dragging: say what is under the cursor.
      const land = e.target.closest?.(".land");
      const place = land && NAME_OF_SHAPE.get(+land.dataset.i);
      if (place) showTip(e.clientX, e.clientY, place[1], [perCountry.has(place[0]) ? summary(place[0]) : "Nobody here yet"]);
      else if (!e.target.closest?.(".bubble")) hideTip();
      return;
    }
    const before = [...touches.values()];
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const after = [...touches.values()];
    const r = rect();
    const mid = (pts) => ({ x: pts.reduce((t, p) => t + p.x, 0) / pts.length, y: pts.reduce((t, p) => t + p.y, 0) / pts.length });
    const a = mid(before), b = mid(after);
    if (after.length > 1) {
      const dist = (pts) => Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      view = zoomed(dist(after) / dist(before), b.x, b.y);
      drag.pinch = true;
    }
    const vw = W / view.k;
    const dx = b.x - a.x, dy = b.y - a.y;
    view.cx -= (dx / r.width) * vw;
    view.cy -= (dy / r.width) * vw;
    const now = performance.now(), dt = Math.max(1, now - drag.t);
    drag.vx = 0.7 * (dx / dt) + 0.3 * drag.vx;
    drag.vy = 0.7 * (dy / dt) + 0.3 * drag.vy;
    drag.t = now;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    draw();
  });
  const release = (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.delete(e.pointerId);
    if (touches.size) return;
    el.classList.remove("is-dragging");
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.moved < 5 && !d.pinch) {
      // A click, not a drag: a country with pins is selected; anywhere else clears.
      const land = d.target.closest?.(".land--has");
      const code = land && codeOfShape.get(+land.dataset.i);
      if (code) select(code);
      else if (sel) select(sel);
      return;
    }
    if (d.pinch || calm() || performance.now() - d.t > 80) return;
    let vx = d.vx, vy = d.vy, last = performance.now();
    const glide = (now) => {
      const dt = now - last;
      last = now;
      const r = rect(), vw = W / view.k;
      view.cx -= (vx * dt / r.width) * vw;
      view.cy -= (vy * dt / r.width) * vw;
      vx *= Math.pow(0.94, dt / 16); vy *= Math.pow(0.94, dt / 16);
      draw();
      frame = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(glide) : 0;
    };
    if (Math.hypot(vx, vy) > 0.15) frame = requestAnimationFrame(glide);
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("pointerleave", hideTip);

  // A row in the list lights up its bubbles.
  highlight = (codes) => { for (const n of nodes) if (n.size) n.el.classList.toggle("is-hot", Boolean(codes && codes.includes(n.code))); };

  // ---------- first draw ----------
  function mount() {
    if (!el.isConnected) return;
    const a = aspect();
    if (!a) return;
    stop();
    const home = fit(regionBox(all), a);
    if (!view) {
      if (introDone || calm()) view = home;
      else { view = fit([0, 0, W, H], a); draw(); flyTo(home, 900); }
      introDone = true;
    } else if (flyNext === "region") flyTo(home);
    else if (flyNext === "sel" && sel) {
      const g = all.find((x) => x.code === sel);
      if (g) flyTo(fit(g.shape >= 0 ? shapeBox(g.shape) : [g.x - 30, g.y - 30, g.x + 30, g.y + 30], a));
    }
    flyNext = null;
    draw();
  }
  queueMicrotask(mount);
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
    group("Go to", REGIONS.map(([id, label]) => pill(label, region === id, set(() => { region = id; flyNext = "region"; })))),
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
      h("ul", null, rows.map((it) => {
        const row = h("li", { class: "arow" },
          h("button", { class: "arow__main", type: "button", onclick: it.open },
            h("div", { class: "arow__title" }, it.name), it.meta && h("div", { class: "arow__text" }, it.meta)));
        row.addEventListener("pointerenter", () => highlight(it.places.map((p) => p.code)));
        row.addEventListener("pointerleave", () => highlight(null));
        return row;
      })));
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
