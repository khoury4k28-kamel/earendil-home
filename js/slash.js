// Slash commands in a text box: type "/" to name a project, task, contact or
// person exactly. "/project" (or any of the four) lists that kind; "/" followed
// by any other letters searches all four at once. Picking one writes its exact
// name into the text, which is what lets the Log's reader, and a person reading
// a note, know which record is meant.

import { state } from "./store.js";

const KINDS = [
  { key: "project", label: "Project", hint: "Name a project", list: () => [
    ...state.deals.map((d) => ({ name: d.name, sub: d.organisation || "", closed: d.stage === "signed" || d.stage === "closed" })),
    ...state.projects.map((p) => ({ name: p.name, sub: "", closed: p.status === "done" })),
  ] },
  { key: "task", label: "Task", hint: "Name a task", list: () => state.tasks.map((t) => ({ name: t.title, sub: "", closed: t.status === "done" })) },
  { key: "contact", label: "Contact", hint: "Name an outside contact", list: () => state.contacts.map((c) => ({ name: c.name, sub: c.organisation || "" })) },
  { key: "person", label: "Person", hint: "Name a teammate", list: () => state.people.map((p) => ({ name: p.name, sub: p.role || "" })) },
];
const LIMIT = 8;
const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// What the menu should offer for the text before the caret, or null.
function read(before) {
  // "/project some words": that kind, filtered by the words.
  const typed = before.match(/(^|\s)\/(project|task|contact|person) ([^\n\/]{0,60})$/i);
  if (typed) {
    const kind = KINDS.find((k) => k.key === typed[2].toLowerCase());
    return { start: before.length - typed[0].length + typed[1].length, kind, query: typed[3] };
  }
  // "/wor": the commands that begin so, then anything by that name.
  const word = before.match(/(^|\s)\/([^\s\/]{0,40})$/);
  if (word) return { start: before.length - word[0].length + word[1].length, kind: null, query: word[2] };
  return null;
}
// Open ones first, then names that begin with what was typed. A whole-hub
// search goes by name only; inside one kind the organisation or role counts too.
const rank = (it, q) => Number(Boolean(it.closed)) * 2 + Number(!fold(it.name).startsWith(q));
function matches(kind, query, nameOnly) {
  const q = fold(query).trim();
  const hit = (it) => !q || fold(it.name).includes(q) || (!nameOnly && fold(it.sub).includes(q));
  const seen = new Set();
  return kind.list().filter((it) => it.name && hit(it) && !seen.has(it.name) && seen.add(it.name))
    .sort((a, b) => rank(a, q) - rank(b, q) || a.name.localeCompare(b.name));
}
function options(found) {
  if (found.kind) return matches(found.kind, found.query).slice(0, LIMIT).map((it) => ({ type: "item", label: it.name, sub: it.sub || found.kind.label, text: it.name }));
  const q = fold(found.query);
  const commands = KINDS.filter((k) => k.key.startsWith(q)).map((k) => ({ type: "command", label: "/" + k.key, sub: k.hint, text: "/" + k.key + " " }));
  if (!q) return commands;
  const items = KINDS.flatMap((k) => matches(k, found.query, true).slice(0, 4).map((it) => ({ type: "item", label: it.name, sub: k.label, text: it.name, rank: rank(it, q) })))
    .sort((a, b) => a.rank - b.rank);   // a stable sort: within a rank, projects stay ahead of tasks, contacts and people
  return [...commands, ...items].slice(0, LIMIT);
}

let menu = null;      // the one open menu
function close() {
  if (!menu) return;
  menu.el.remove();
  menu = null;
}
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function paint() {
  const { box, input, opts } = menu;
  box.replaceChildren(...opts.map((o, i) => {
    const row = el("button", "slash__item");
    row.type = "button";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(i === menu.at));
    row.append(el("span", "slash__label", o.label), el("span", "slash__sub", o.sub));
    row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(input, i); });   // keeps the caret in the box
    return row;
  }));
  box.children[menu.at]?.scrollIntoView({ block: "nearest" });
}
function place() {
  const r = menu.input.getBoundingClientRect();
  const width = Math.min(Math.max(r.width, 280), 420);
  const s = menu.el.style;
  s.width = width + "px";
  s.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + "px";
  // Above the box when it sits low on the screen, as the Log's does.
  if (r.top > window.innerHeight * 0.55) { s.top = ""; s.bottom = window.innerHeight - r.top + 6 + "px"; }
  else { s.bottom = ""; s.top = r.bottom + 6 + "px"; }
}
function update(input) {
  if (menu && !menu.input.isConnected) close();
  const caret = input.selectionStart ?? input.value.length;
  const found = input.selectionEnd === caret ? read(input.value.slice(0, caret)) : null;
  const opts = found ? options(found) : [];
  if (!opts.length) { close(); return; }
  if (!menu || menu.input !== input) {
    close();
    const wrap = el("div", "slash");
    const box = el("div", "slash__list");
    box.setAttribute("role", "listbox");
    wrap.append(box);
    document.body.append(wrap);
    menu = { el: wrap, box, input, at: 0 };
  }
  Object.assign(menu, { found, opts, caret, at: Math.min(menu.at, opts.length - 1) });
  place();
  paint();
}
function pick(input, i) {
  const o = menu.opts[i];
  if (!o) return;
  const { found, caret } = menu;
  const text = o.type === "item" ? o.text + " " : o.text;
  input.value = input.value.slice(0, found.start) + text + input.value.slice(caret);
  const at = found.start + text.length;
  input.setSelectionRange(at, at);
  menu.at = 0;
  // Tells the box's own listeners (draft, height, the next menu) that the text changed.
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---------- names shown as names ----------
// A text box draws all its text one way, so a copy of the text sits exactly
// behind the box with every record name marked, and the box's own letters are
// made see-through. Any exact name is marked, picked from the list or typed.
const backs = new WeakMap();
const COPY = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "wordSpacing", "textAlign", "textIndent", "tabSize",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"];
function nameFinder() {
  const names = [...new Set(KINDS.flatMap((k) => k.list().map((it) => String(it.name || "").trim())).filter((n) => n.length >= 3))]
    .sort((a, b) => b.length - a.length);
  if (!names.length) return null;
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?<![\\p{L}\\p{N}])(?:" + names.map(esc).join("|") + ")(?![\\p{L}\\p{N}])", "gu");
}
function marked(text) {
  const find = nameFinder();
  const out = [];
  let at = 0;
  if (find) for (const m of text.matchAll(find)) {
    if (m.index > at) out.push(document.createTextNode(text.slice(at, m.index)));
    out.push(el("mark", "slashname", m[0]));
    at = m.index + m[0].length;
  }
  const any = out.length > 0;
  out.push(document.createTextNode(text.slice(at) + "​"));   // keeps a last empty line its height
  return { nodes: out, any };
}
function sync(input) {
  if (!input.isConnected || !input.parentElement) return;
  let back = backs.get(input);
  const { nodes, any } = marked(input.value);
  if (!any) {
    // Nothing to mark: the box shows its own text, as it always did.
    if (back) { back.el.remove(); input.style.color = ""; input.style.caretColor = ""; backs.delete(input); }
    return;
  }
  const cs = getComputedStyle(input);
  if (!back || !back.el.isConnected) {
    const div = el("div", "slashback");
    div.setAttribute("aria-hidden", "true");
    if (getComputedStyle(input.parentElement).position === "static") input.parentElement.style.position = "relative";
    input.parentElement.insertBefore(div, input);
    back = { el: div, ink: back ? back.ink : cs.color };
    backs.set(input, back);
  }
  const area = input.tagName === "TEXTAREA";
  const st = back.el.style;
  for (const k of COPY) st[k] = cs[k];
  const edge = (side) => parseFloat(cs["border" + side + "Width"]) || 0;
  const pad = (side) => parseFloat(cs["padding" + side]) || 0;
  const bar = input.offsetWidth - input.clientWidth - edge("Left") - edge("Right");   // a scroll bar narrows the lines
  st.left = input.offsetLeft + "px";
  st.top = input.offsetTop + "px";
  st.width = input.offsetWidth - Math.max(0, bar) + "px";
  st.height = input.offsetHeight + "px";
  st.color = back.ink;
  st.whiteSpace = area ? "pre-wrap" : "pre";
  st.lineHeight = area ? cs.lineHeight : input.clientHeight - pad("Top") - pad("Bottom") + "px";   // a one-line box centres its text
  back.el.replaceChildren(...nodes);
  back.el.scrollTop = input.scrollTop;
  back.el.scrollLeft = input.scrollLeft;
  input.style.color = "transparent";
  input.style.caretColor = back.ink;
}

// A redraw can replace the box the menu belongs to: the menu goes with it.
document.addEventListener("focusin", (e) => { if (menu && e.target !== menu.input) close(); });
window.addEventListener("resize", close);

// Switch the menu on for one text box or text area.
export function withSlash(input) {
  if (!input || input.dataset.slash) return input;
  input.dataset.slash = "on";
  input.addEventListener("input", () => { update(input); sync(input); });
  input.addEventListener("click", () => update(input));
  input.addEventListener("blur", close);
  // The copy behind the box follows it: its text, its scrolling and its size.
  for (const ev of ["keyup", "scroll", "focus", "change"]) input.addEventListener(ev, () => sync(input));
  if (typeof ResizeObserver === "function") new ResizeObserver(() => sync(input)).observe(input);
  requestAnimationFrame(() => sync(input));
  // Ahead of the box's own keys, so Return picks from the menu and does not send.
  input.addEventListener("keydown", (e) => {
    if (!menu || menu.input !== input || e.isComposing) return;
    const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (move) { menu.at = (menu.at + move + menu.opts.length) % menu.opts.length; paint(); }
    else if (e.key === "Enter" || e.key === "Tab") pick(input, menu.at);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  return input;
}
// The same for a one-line add box (the box is inside a wrapper).
export function slashIn(wrap) {
  withSlash(wrap?.querySelector("input, textarea"));
  return wrap;
}
