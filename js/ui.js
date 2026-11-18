// Small building blocks shared by every screen: element builder, formatters,
// the side drawer, dialogs and the toast. Text always goes in as text nodes,
// never as HTML, so nothing a teammate types can run as code.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === "") continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---------- formatters ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
  return isNaN(d) ? null : d;
}
export function fmtDate(iso) {
  const d = parseDate(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "";
}
export function fmtDateTime(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return "";
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${d.getHours()}:${mm}`;
}
export function todayLabel() {
  const d = new Date();
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function daysSince(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((t - d) / 864e5);
}
function unit(n) {
  n = Math.abs(n);
  return n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""];
}
const trim = (x) => String(Math.round(x * 10) / 10).replace(/\.0$/, "");
export function fmtMoney(n) {
  if (n == null || n === "") return "";
  const [d, u] = unit(n);
  return `$${trim(n / d)}${u}`;
}
export function fmtRange(lo, hi) {
  if (lo == null && hi == null) return "";
  if (lo == null || hi == null || lo === hi) return fmtMoney(lo ?? hi);
  const [d1, u1] = unit(lo);
  const [d2, u2] = unit(hi);
  return u1 === u2 ? `$${trim(lo / d1)}–${trim(hi / d2)}${u2}` : `${fmtMoney(lo)}–${fmtMoney(hi)}`;
}
export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

// ---------- small components ----------
export function avatar(name, size) {
  return h("span", { class: "avatar" + (size ? " avatar--" + size : ""), "aria-hidden": "true" }, initials(name));
}
export function emptyState(title, text, action) {
  return h("div", { class: "empty" }, h("div", null, h("b", null, title), text ? " " + text : ""), action);
}
export function panel(title, action, ...body) {
  return h("section", { class: "panel" },
    h("div", { class: "panel__head" }, h("h2", { class: "eyebrow" }, title), action),
    h("div", { class: "panel__body" }, body));
}
export function kv(pairs) {
  const dl = h("dl", { class: "kv" });
  for (const [k, v] of pairs) {
    if (v == null || v === "" || v === false) continue;
    dl.append(h("dt", null, k), h("dd", null, v));
  }
  return dl;
}

// ---------- toast ----------
let toastTimer;
export function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.textContent = ""; }, 3600);
}

// ---------- re-render hook (set by app.js) ----------
let rerender = () => {};
export function setRerender(fn) { rerender = fn; }
export function refresh() { rerender(); }

// ---------- drawer ----------
const layer = () => document.getElementById("layer");
let drawer = null;

export function openDrawer(render) {
  closeDrawer();
  const panelEl = h("aside", { class: "drawer", role: "dialog", "aria-modal": "true" });
  const scrim = h("div", { class: "scrim", onmousedown: (e) => { if (e.target === scrim) closeDrawer(); } }, panelEl);
  layer().append(scrim);
  drawer = { render, scrim, panelEl };
  paintDrawer(true);
}
export function paintDrawer(force) {
  if (!drawer) return;
  const a = document.activeElement;
  // Don't wipe something a teammate is typing when a change arrives from elsewhere.
  if (!force && a && drawer.panelEl.contains(a) && /INPUT|TEXTAREA/.test(a.tagName) && a.value) return;
  const scroll = drawer.panelEl.querySelector(".drawer__body")?.scrollTop || 0;
  const parts = drawer.render();
  if (!parts) { closeDrawer(); return; }
  drawer.panelEl.replaceChildren(...parts);
  const body = drawer.panelEl.querySelector(".drawer__body");
  if (body) body.scrollTop = scroll;
}
export function closeDrawer() {
  if (!drawer) return;
  drawer.scrim.remove();
  drawer = null;
}
export function drawerFrame({ eyebrow, title, sub, actions }, ...blocks) {
  return [
    h("header", { class: "drawer__head" },
      h("div", { class: "block" },
        eyebrow && h("div", { class: "eyebrow" }, eyebrow),
        h("h2", { class: "h2" }, title),
        sub && h("div", { class: "sub" }, sub)),
      h("div", { class: "actions" }, actions,
        h("button", { class: "x", type: "button", "aria-label": "Close", onclick: closeDrawer }, "×"))),
    h("div", { class: "drawer__body" }, blocks),
  ];
}
export function block(title, ...kids) {
  return h("section", { class: "block" }, title && h("h3", { class: "eyebrow" }, title), kids);
}

// ---------- dialog ----------
const dialogs = [];
export function openDialog({ title, body, foot }) {
  const box = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "dialog__head" }, h("h2", { class: "h3" }, title),
      h("button", { class: "x", type: "button", "aria-label": "Close", onclick: () => close() }, "×")),
    h("div", { class: "dialog__body" }, body),
    foot && h("div", { class: "dialog__foot" }, foot));
  const scrim = h("div", { class: "scrim scrim--center", onmousedown: (e) => { if (e.target === scrim) close(); } }, box);
  function close() {
    scrim.remove();
    const i = dialogs.indexOf(close);
    if (i >= 0) dialogs.splice(i, 1);
  }
  layer().append(scrim);
  dialogs.push(close);
  const first = box.querySelector("input, select, textarea");
  if (first) first.focus();
  return close;
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (dialogs.length) dialogs[dialogs.length - 1]();
  else closeDrawer();
});
