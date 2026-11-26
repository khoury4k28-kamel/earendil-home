// Deals & Tasks: where the work is kept. The tab opens on a box for every
// deal and project (a deal is a project with a pipeline). A task always sits
// inside one of them. Press a box and it opens on its own page:
// its tasks, the subtasks under each, and how far along they are. Home only
// gathers from here.

import { h, refresh, toast, ago, quickAdd, fmtDate, fmtDateTime, fmtRange, plural, avatar, kv } from "../ui.js";
import { state, create, update, personName, byId, sortByName, notesFor, addNote, fileUrl, projectsForDeal, pinned } from "../store.js";
import { pinButton, isPinned } from "../pins.js";
import { stageLabel, projectStatusLabel, categoryLabel } from "../schema.js";
import { editRecord, addProject, openWork, workMark, stalledDays, personChip, openContact, openPerson, noteMeta, pickPerson } from "../detail.js";
import { allWork, workOf, isLive, isOn, tasksOf, subtasksOf, subtasksReady, addSubtask, taskOrder, progress, docsFor, docsReady } from "../work.js";

let scope = null;        // "mine" or "all"; mine once the hub knows who is looking
let showFinished = false;
let showDone = false;
let pageView = "tasks";   // inside a project: its tasks, or its progress
let pageKey = "";

const meId = () => state.me.id;
const key = (w) => w.kind + ":" + w.id;
const whose = () => (meId() ? scope || "mine" : "all");
const isOpen = (t) => t.status !== "done";
const go = (k) => { location.hash = "#work" + (k ? "/" + k : ""); };

function seg(label, options, current, set) {
  return h("div", { class: "seg", role: "group", "aria-label": label }, options.map(([value, text]) =>
    h("button", { type: "button", "aria-pressed": String(current === value), onclick: () => { set(value); refresh(); } }, text)));
}
// A wide progress bar with its count beside it.
function meter(done, total) {
  return h("div", { class: "meter" },
    h("span", { class: "meter__bar", role: "img", "aria-label": `${done} of ${total} tasks done` },
      h("span", { style: `width:${total ? Math.round((done / total) * 100) : 0}%` })),
    h("span", { class: "meter__n num" }, total ? `${done} of ${total} done` : "No tasks yet"));
}

function workList(mine) {
  const pool = allWork().filter((w) => !mine || isOn(w.rec, meId()) || isPinned(w.kind, w.id));
  // Pinned ones come first, whoever they belong to.
  const order = (a, b) => Number(isPinned(b.kind, b.id)) - Number(isPinned(a.kind, a.id)) || String(a.next?.due || "9").localeCompare(String(b.next?.due || "9")) || a.name.localeCompare(b.name);
  return { live: pool.filter((w) => isLive(w.kind, w.rec)).sort(order), finished: pool.filter((w) => !isLive(w.kind, w.rec)).sort(order) };
}

// ---------- the boxes ----------
// A box is a small picture of the deal's own page: what it is, the next tasks
// (each can be ticked here), the document that goes with it, who is on it and
// how far along it is. Pressing anywhere else on the box opens its page.
// Two tasks and a count: the box has a fixed height, and a task cut in half reads as a fault.
const MAX_TASKS = 2;
function boxTask(t, isNext) {
  const meta = [t.status === "doing" && "In progress", t.due && "Due " + fmtDate(t.due)].filter(Boolean).join(" · ");
  return h("li", { class: "wbox__task" },
    h("button", {
      class: "check", type: "button", role: "checkbox", "aria-checked": t.status === "doing" ? "mixed" : "false", "aria-label": "Mark " + t.title + " done",
      onclick: (e) => { e.stopPropagation(); update("tasks", t.id, { status: "done" }); },
    }),
    h("div", { class: "wbox__tt" },
      h("div", { class: "wbox__ttitle" }, isNext && h("span", { class: "next" }, "Next"), t.title),
      meta && h("div", { class: "wbox__tmeta" }, meta)),
    pinButton("task", t.id, t.title));
}
// RULE: a document only shows with its own thumbnail; if the picture fails the whole preview goes.
function boxDoc(docs) {
  const doc = docs[0];
  const img = h("img", { src: fileUrl(doc.thumb), alt: "", width: doc.w, height: doc.h, loading: "lazy" });
  const el = h("div", { class: "wbox__doc" },
    h("span", { class: "wbox__thumb" }, img),
    h("span", { class: "wbox__dtext" },
      h("span", { class: "wbox__dtitle" }, doc.title),
      h("span", { class: "wbox__dmeta" }, [doc.pages && plural(doc.pages, "page"), docs.length > 1 && `+${docs.length - 1} more`].filter(Boolean).join(" · "))));
  img.addEventListener("error", () => { el.closest(".wbox")?.classList.remove("wbox--doc"); el.remove(); });
  return el;
}
function box(w) {
  const r = w.rec;
  const isDeal = w.kind === "deal";
  const quiet = isDeal ? stalledDays(r) : null;
  const open = tasksOf(w.kind, w.id).filter(isOpen).sort(taskOrder);
  // The picture is the deal's deck if it has one: wide pages before upright ones (a contract, a brochure).
  const wide = (d) => (d.w > d.h ? 0 : 1);
  const docs = isDeal ? docsFor(r).map((x) => x.doc).filter((d) => fileUrl(d.thumb)).sort((a, b) => wide(a) - wide(b)) : [];
  const team = [...new Set([r.owner_id, ...(r.people_ids || [])])].map((id) => byId("people", id)).filter(Boolean);
  // A contact that is just the organisation again adds nothing to the line above it.
  const contacts = isDeal ? (r.contact_ids || []).map((id) => byId("contacts", id)).filter((c) => c && c.name !== r.organisation) : [];
  const href = "#work/" + key(w);
  return h("div", { class: "wbox" + (docs.length ? " wbox--doc" : "") + (quiet ? " wbox--quiet" : "") + (open.length > MAX_TASKS ? " wbox--busy wbox--full" : open.length > 1 ? " wbox--busy" : ""), onclick: () => { location.hash = href; } },
    h("div", { class: "wbox__top" },
      h("span", { class: "wbox__kind" }, workMark(w), isDeal ? stageLabel(r.stage) : projectStatusLabel(r.status)),
      h("span", { class: "wbox__topr" },
        quiet ? h("span", { class: "stalled" }, `No contact in ${quiet} days`)
          : isDeal && r.last_touch && h("span", null, "Last contact " + fmtDate(r.last_touch)),
        pinButton(w.kind, w.id, w.name))),
    h("a", { class: "wbox__name", href, onclick: (e) => e.stopPropagation() }, w.name),
    h("div", { class: "wbox__sub" }, [isDeal && r.organisation, isDeal && r.region, !isDeal && r.due && "Due " + fmtDate(r.due)].filter(Boolean).join(" · ")),
    h("div", { class: "wbox__body" },
      h("div", { class: "wbox__main" },
        r.summary && h("p", { class: "wbox__sum" }, r.summary),
        open.length > 0
          ? h("div", { class: "wbox__tasks" },
            h("ul", null, open.slice(0, MAX_TASKS).map((t, i) => boxTask(t, i === 0))),
            open.length > MAX_TASKS && h("div", { class: "wbox__moret" }, `+${plural(open.length - MAX_TASKS, "more task")}`))
          : h("div", { class: "wbox__tasks wbox__tasks--none" },
            h("span", null, w.total ? "All tasks done" : isDeal ? "No next step" : "No tasks yet"), h("span", { class: "link" }, "Add a task"))),
      docs.length > 0 && boxDoc(docs)),
    h("div", { class: "wbox__foot" },
      team.length > 0 && h("span", { class: "wbox__who" },
        h("span", { class: "wbox__avs" }, team.slice(0, 4).map((p) => avatar(p.name, "s"))),
        team.length === 1 ? team[0].name : plural(team.length, "person", "people")),
      contacts.length > 0 && h("span", { class: "wbox__who wbox__who--c" }, contacts.length === 1 ? contacts[0].name : plural(contacts.length, "contact")),
      meter(w.done, w.total)));
}
// The slot left open by an odd number of boxes: start the next one from it.
function newBox(add) {
  return h("div", { class: "wbox wbox--new" },
    h("div", { class: "wbox__newt" }, "Start something new"),
    h("div", { class: "wbox__newb" }, add.slice(1)));
}
const addButtons = (belongs = {}) => [
  h("button", { class: "btn", type: "button", onclick: () => editRecord("tasks", null, { status: "todo", owner_id: meId() || null, ...belongs }) }, "Add task"),
  h("button", { class: "btn btn--primary", type: "button", onclick: () => addProject((kind, row) => go(kind + ":" + row.id)) }, "Add project"),
];
// Pinned tasks, above the boxes: each opens the deal or project it sits in.
function pinnedTasks() {
  const list = pinned("task").filter(isOpen);
  if (!list.length) return null;
  return h("section", { class: "panel pinned" },
    h("div", { class: "panel__head" }, h("h2", { class: "eyebrow" }, `Pinned tasks · ${list.length}`)),
    h("div", { class: "panel__body" }, h("ul", { class: "rows" }, list.map((t) => {
      const w = workOf(t);
      const meta = [w?.name, taskMeta(t)].filter(Boolean).join(" · ");
      return h("li", { class: "row" }, tick(t),
        h("button", { class: "row__main rowbtn", type: "button", onclick: () => (w ? go(key(w)) : editRecord("tasks", t)) },
          h("div", { class: "row__title" }, t.title), meta && h("div", { class: "row__meta" }, meta)),
        pinButton("task", t.id, t.title));
    }))));
}
function boxes() {
  const mine = whose() === "mine";
  const { live, finished } = workList(mine);
  return h("main", { class: "page page--boxes" },
    h("div", { class: "page-head" },
      h("h1", { class: "h1" }, "Projects & Tasks"),
      h("div", { class: "actions" },
        meId() && seg("Whose work", [["mine", "Mine"], ["all", "Everyone"]], whose(), (v) => { scope = v; }),
        addButtons())),
    pinnedTasks(),
    live.length + (showFinished ? finished.length : 0) > 0
      ? h("div", { class: "wboxes" }, live.map(box), showFinished && finished.map(box),
        (live.length + (showFinished ? finished.length : 0)) % 2 === 1 && newBox(addButtons()))
      : h("div", { class: "empty" }, h("div", null, h("b", null, mine ? "No projects of yours yet." : "No projects yet."))),
    finished.length > 0 && h("button", { class: "more", type: "button", onclick: () => { showFinished = !showFinished; refresh(); } },
      showFinished ? "Hide finished" : `${finished.length} finished · Show`));
}

// ---------- inside a box: tasks and their subtasks ----------
function tick(t) {
  return h("button", {
    class: "check", type: "button", role: "checkbox",
    "aria-checked": t.status === "done" ? "true" : t.status === "doing" ? "mixed" : "false",
    "aria-label": "Mark " + t.title + (t.status === "done" ? " not done" : " done"),
    onclick: () => update("tasks", t.id, { status: t.status === "done" ? "todo" : "done" }),
  });
}
const taskMeta = (t, owner = true) => [owner && personName(t.owner_id), t.status === "doing" && "In progress", t.due && "Due " + fmtDate(t.due)].filter(Boolean).join(" · ");
// Who does a task, chosen on the row. It then shows on that person's Home.
function assign(t) {
  return pickPerson({ id: `wk-own-${t.id}`, value: t.owner_id, blank: "Assign", label: "Who does: " + t.title, onChange: (v) => {
    const before = t.owner_id || null;
    update("tasks", t.id, { owner_id: v });
    toast(v ? `Assigned to ${personName(v)}. It shows on their Home.` : "Nobody is on it now.", ["Undo", () => update("tasks", t.id, { owner_id: before })]);
  } });
}
function subRow(s) {
  const meta = taskMeta(s, false);
  return h("li", { class: "row srow" + (s.status === "done" ? " done" : "") }, tick(s),
    h("button", { class: "row__main rowbtn", type: "button", onclick: () => editRecord("tasks", s) },
      h("div", { class: "row__title" }, s.title), meta && h("div", { class: "row__meta" }, meta)),
    assign(s), pinButton("task", s.id, s.title));
}
function taskRow(t, isNext) {
  const subs = subtasksOf(t.id);
  const subsDone = subs.filter((s) => !isOpen(s)).length;
  const meta = taskMeta(t, false);
  return h("li", { class: "tkrow" + (t.status === "done" ? " done" : "") },
    h("div", { class: "row tkrow__line" }, tick(t),
      h("button", { class: "row__main rowbtn", type: "button", onclick: () => editRecord("tasks", t) },
        h("div", { class: "row__title" }, isNext && h("span", { class: "next" }, "Next"), t.title),
        meta && h("div", { class: "row__meta" }, meta)),
      assign(t), pinButton("task", t.id, t.title),
      subs.length > 0 && h("span", { class: "tkrow__n num", title: `${subsDone} of ${subs.length} subtasks done` }, `${subsDone}/${subs.length}`),
      subs.length > 0 && h("span", { class: "bar", role: "img", "aria-label": `${subsDone} of ${subs.length} subtasks done` },
        h("span", { style: `width:${Math.round((subsDone / subs.length) * 100)}%` }))),
    (subs.length > 0 || (subtasksReady() && isOpen(t))) && h("div", { class: "subs" },
      subs.length > 0 && h("ul", { class: "rows" }, subs.map(subRow)),
      subtasksReady() && isOpen(t) && quickAdd(`wk-sub-${t.id}`, "Add a subtask", (title) => addSubtask(t, title))));
}
function inside({ crumb, facts, done, total, tasks, addId, addLabel, onAdd, actions, markNext, side, progressView }) {
  const open = tasks.filter(isOpen).sort(taskOrder);
  const finished = tasks.filter((t) => !isOpen(t)).sort(taskOrder);
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "crumbs crumbs--page" }, h("a", { href: "#work" }, "Projects & Tasks"), h("span", { class: "muted" }, " / "), h("b", null, crumb)),
      h("div", { class: "actions" }, actions)),
    h("div", { class: "winside" },
      h("div", { class: "winside__main" },
      h("div", { class: "sub" }, facts),
      meter(done, total),
      seg("Show", [["tasks", "Tasks"], ["progress", "Progress"]], pageView, (v) => { pageView = v; }),
      pageView === "progress" ? progressView() : h("section", { class: "panel" },
        h("div", { class: "panel__head" }, h("h2", { class: "eyebrow" }, `Tasks · ${open.length} open`)),
        h("div", { class: "panel__body" },
          open.length > 0 && h("ul", { class: "tkrows" }, open.map((t, i) => taskRow(t, markNext && i === 0))),
          quickAdd(addId, addLabel, onAdd),
          finished.length > 0 && h("button", { class: "more", type: "button", onclick: () => { showDone = !showDone; refresh(); } },
            showDone ? "Hide done" : `${plural(finished.length, "done task")} · Show`),
          showDone && finished.length > 0 && h("ul", { class: "tkrows" }, finished.map((t) => taskRow(t, false)))))),
      side && h("aside", { class: "winside__side" }, side)));
}

// ---------- everything else the hub knows about this deal or project ----------
// Gathered from across the hub: the people on it, the outside contacts, the
// documents, the projects under it and the notes. Each opens where it lives.
function gathered(title, count, ...body) {
  return h("section", { class: "panel gath" },
    h("div", { class: "panel__head" }, h("h2", { class: "eyebrow" }, count == null ? title : `${title} · ${count}`)),
    h("div", { class: "panel__body" }, body));
}
// A dashed "add" picker: choose one and it is linked.
function adder(label, options, onPick) {
  if (!options.length) return null;
  const sel = h("select", { class: "pick pick--empty gath__add", "aria-label": label },
    h("option", { value: "" }, label), options.map(([value, text]) => h("option", { value }, text)));
  sel.addEventListener("change", () => sel.value && onPick(sel.value));
  return sel;
}
// The same picker as a small dashed "+" that sits after the last chip. The
// list itself is the browser's own, laid invisibly over the plus.
function plusAdder(label, options, onPick) {
  if (!options.length) return null;
  const sel = h("select", { "aria-label": label, title: label },
    h("option", { value: "" }, label), options.map(([value, text]) => h("option", { value }, text)));
  sel.addEventListener("change", () => sel.value && onPick(sel.value));
  return h("span", { class: "plus-add" }, h("span", { "aria-hidden": "true" }, "+"), sel);
}
function teamBlock(table, r) {
  const ids = [...new Set([r.owner_id, ...(r.people_ids || [])])].filter((id) => byId("people", id));
  const others = sortByName(state.people.filter((p) => !ids.includes(p.id))).map((p) => [p.id, p.name]);
  return gathered("Team", ids.length,
    h("div", { class: "chips" }, ids.map((id) => personChip(id)),
      plusAdder("Add a team member", others, (id) => update(table, r.id, { people_ids: [...(r.people_ids || []), id] }))));
}
function contactsBlock(d) {
  const list = (d.contact_ids || []).map((id) => byId("contacts", id)).filter(Boolean);
  const others = sortByName(state.contacts.filter((c) => !(d.contact_ids || []).includes(c.id))).map((c) => [c.id, c.name]);
  return gathered("Contacts", list.length,
    list.length > 0 && h("ul", { class: "rows" }, list.map((c) => h("li", { class: "row grow" },
      avatar(c.name, "s"),
      h("button", { class: "row__main rowbtn", type: "button", onclick: () => openContact(c.id) },
        h("div", { class: "row__title" }, c.name),
        h("div", { class: "row__meta" }, [c.title, c.organisation !== c.name && c.organisation, categoryLabel(c.category), c.country, c.email].filter(Boolean).join(" · ") || "No details yet"))))),
    adder("Add a contact", others, (id) => update("deals", d.id, { contact_ids: [...(d.contact_ids || []), id] })));
}
// RULE: a document only shows with its own thumbnail; one whose picture fails to load is taken off.
function docRow(d, { doc, linked }) {
  const img = h("img", { src: fileUrl(doc.thumb), alt: "", width: doc.w, height: doc.h });
  img.addEventListener("error", () => img.closest("li")?.remove());
  return h("li", { class: "gdoc" },
    h("a", { class: "gdoc__link", href: fileUrl(doc.file), target: "_blank", rel: "noopener" },
      h("span", { class: "gdoc__thumb" }, img),
      h("span", { class: "gdoc__text" }, h("span", { class: "gdoc__title" }, doc.title),
        h("span", { class: "row__meta" }, [doc.category, doc.pages && plural(doc.pages, "page"), fmtDate(doc.date)].filter(Boolean).join(" · ")))),
    linked && h("button", { class: "more more--head", type: "button", title: "Take this document off the project",
      onclick: () => update("deals", d.id, { document_ids: (d.document_ids || []).filter((x) => x !== doc.id) }) }, "Unlink"));
}
function docsBlock(d) {
  const list = docsFor(d).filter((x) => fileUrl(x.doc.thumb));
  const shown = new Set(list.map((x) => x.doc.id));
  const others = state.documents.filter((x) => !x.archive && !shown.has(x.id)).sort((a, b) => String(a.title).localeCompare(String(b.title))).map((x) => [x.id, x.title]);
  const add = docsReady() && adder("Link a document", others, (id) => update("deals", d.id, { document_ids: [...(d.document_ids || []), id] }));
  if (!list.length && !add) return null;
  return gathered("Documents", list.length, list.length > 0 && h("ul", { class: "gdocs" }, list.map((x) => docRow(d, x))), add);
}
function projectsBlock(d) {
  const list = projectsForDeal(d.id);
  if (!list.length) return null;
  return gathered("Projects under this one", list.length, h("ul", { class: "rows" }, list.map((p) => {
    const pr = progress("project", p.id);
    return h("li", { class: "row grow" }, workMark({ kind: "project", rec: p }),
      h("a", { class: "row__main rowbtn", href: `#work/project:${p.id}` },
        h("div", { class: "row__title" }, p.name),
        h("div", { class: "row__meta" }, [projectStatusLabel(p.status), pr.total ? `${pr.done} of ${pr.total} tasks done` : "No tasks yet"].join(" · "))));
  })));
}
function notesBlock(type, id) {
  const notes = notesFor(type, id);
  return gathered("Notes", notes.length || null,
    // Oldest first, so the newest note is last and the box to add one sits right under it.
    notes.length > 5 && h("div", { class: "small muted" }, `${notes.length - 5} earlier in the details panel`),
    h("div", { class: "notes-up" }, notes.slice(0, 5).reverse().map((n) => h("div", { class: "note" },
      h("div", { class: "prose" }, n.body),
      noteMeta(n)))),
    quickAdd(`wk-note-${type}-${id}`, "Add a note", (body) => addNote(type, id, body)));
}
function aboutBlock(w) {
  const r = w.rec;
  const isDeal = w.kind === "deal";
  const size = isDeal && fmtRange(r.size_low, r.size_high);
  const parent = !isDeal && byId("deals", r.deal_id);
  const rows = [
    ["Region", isDeal && r.region],
    ["Size", size],
    ["Last contact", isDeal && r.last_touch && fmtDate(r.last_touch)],
    ["Part of", parent && h("a", { class: "link", href: `#work/deal:${parent.id}` }, parent.name)],
    ["To confirm", isDeal && r.to_confirm],
  ].filter(([, v]) => v);
  if (!r.summary && !rows.length) return null;
  return gathered("About", null, r.summary && h("div", { class: "prose" }, r.summary), rows.length > 0 && kv(rows));
}
function sideOf(w) {
  const r = w.rec;
  return w.kind === "deal"
    ? [aboutBlock(w), teamBlock("deals", r), contactsBlock(r), docsBlock(r), projectsBlock(r), notesBlock("deal", r.id)]
    : [aboutBlock(w), teamBlock("projects", r), notesBlock("project", r.id)];
}
// ---------- progress: what has happened on this project ----------
// One timeline, newest first: what the team wrote about it (in the Log, in
// Slack or as a note), and the tasks finished and added. Above it, where the
// project stands and who has what.
const dayOf = (iso) => String(iso || "").slice(0, 10);
function progressOf(w) {
  const r = w.rec;
  const tasks = tasksOf(w.kind, w.id);
  const all = [...tasks, ...tasks.flatMap((t) => subtasksOf(t.id))];
  const events = [];
  for (const n of notesFor(w.kind, w.id)) events.push({ at: n.created_at, kind: n.source === "log" ? "Log" : n.source === "slack" ? "Slack" : n.source === "system" ? "Update" : "Note", text: n.body, meta: noteMeta(n) });
  // What was logged about this project's outside contacts counts too.
  for (const c of (w.kind === "deal" ? r.contact_ids || [] : []).map((id) => byId("contacts", id)).filter(Boolean)) {
    for (const n of notesFor("contact", c.id)) events.push({ at: n.created_at, kind: n.source === "log" ? "Log" : n.source === "slack" ? "Slack" : "Note", text: [h("b", null, c.name + ": "), n.body], meta: noteMeta(n) });
  }
  for (const t of all) {
    if (t.status === "done") events.push({ at: t.updated_at || null, kind: "Done", done: true, text: t.title, meta: personName(t.owner_id) && h("div", { class: "row__meta" }, personName(t.owner_id)) });
    else if (t.created_at) events.push({ at: t.created_at, kind: "Added", text: t.title, meta: personName(t.owner_id) && h("div", { class: "row__meta" }, "For " + personName(t.owner_id)) });
  }
  const dated = events.filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const undated = events.filter((e) => !e.at);
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const doneWeek = dated.filter((e) => e.done && e.at >= week).length;
  const last = dated[0]?.at;
  const fact = (label, value) => h("div", { class: "fact" }, h("span", { class: "small muted" }, label), h("span", { class: "fact__v num" }, value));
  // Who has what: everyone on the project or holding one of its tasks.
  const ids = [...new Set([r.owner_id, ...(r.people_ids || []), ...all.map((t) => t.owner_id)])].filter((id) => byId("people", id));
  const load = ids.map((id) => ({ id, name: personName(id), open: all.filter((t) => t.owner_id === id && isOpen(t)).length, done: all.filter((t) => t.owner_id === id && !isOpen(t)).length }));
  const nobody = all.filter((t) => isOpen(t) && !byId("people", t.owner_id)).length;
  const row = (e) => h("li", { class: "ev" + (e.done ? " ev--done" : "") },
    h("span", { class: "ev__kind" }, e.kind),
    h("div", { class: "ev__main" }, h("div", { class: "prose" }, e.text), e.meta));
  const days = [];
  for (const e of dated) { const d = dayOf(e.at); if (days.at(-1)?.day !== d) days.push({ day: d, list: [] }); days.at(-1).list.push(e); }
  return h("div", { class: "prog" },
    h("div", { class: "facts" },
      fact("Tasks done", w.total ? `${w.done} of ${w.total}` : "No tasks yet"),
      fact("Done in the last 7 days", String(doneWeek)),
      fact("Last activity", last ? ago(last) : "None yet")),
    load.length > 0 && h("section", { class: "panel" },
      h("div", { class: "panel__head" }, h("h2", { class: "eyebrow" }, "Who has what")),
      h("div", { class: "panel__body" }, h("ul", { class: "rows" },
        load.map((p) => h("li", { class: "row grow" }, avatar(p.name, "s"),
          h("button", { class: "row__main rowbtn", type: "button", onclick: () => openPerson(p.id) }, h("div", { class: "row__title" }, p.name)),
          h("span", { class: "small muted num" }, `${p.open} open · ${p.done} done`))),
        nobody > 0 && h("li", { class: "row grow" }, h("div", { class: "row__main muted" }, "Not assigned yet"), h("span", { class: "small muted num" }, `${nobody} open`))))),
    h("section", { class: "panel" },
      h("div", { class: "panel__head" }, h("h2", { class: "eyebrow" }, "Recent activity")),
      h("div", { class: "panel__body" },
        !events.length && h("div", { class: "muted" }, "Nothing has happened here yet. What the team writes in the Log about this project shows here, with tasks as they are finished."),
        days.map((d) => h("div", { class: "evday" }, h("div", { class: "evday__t" }, fmtDate(d.day)), h("ul", { class: "evs" }, d.list.map(row)))),
        undated.length > 0 && h("div", { class: "evday" }, h("div", { class: "evday__t" }, dated.length ? "Earlier" : "Done so far"), h("ul", { class: "evs" }, undated.map(row))))));
}

function workPage(w) {
  if (pageKey !== key(w)) { pageKey = key(w); pageView = "tasks"; }
  const r = w.rec;
  const isDeal = w.kind === "deal";
  const belongs = isDeal ? { deal_id: w.id, project_id: null } : { project_id: w.id, deal_id: null };
  return inside({
    crumb: [workMark(w), w.name],
    facts: [isDeal ? stageLabel(r.stage) : projectStatusLabel(r.status), isDeal && r.organisation, personName(r.owner_id) || "No owner",
      !isDeal && r.due && "Due " + fmtDate(r.due)].filter(Boolean).join(" · "),
    done: w.done, total: w.total, tasks: tasksOf(w.kind, w.id), markNext: true,
    addId: `wk-task-${w.kind}-${w.id}`, addLabel: "Add a task",
    onAdd: (title) => create("tasks", { title, status: "todo", ...belongs, owner_id: meId() || r.owner_id || null }),
    actions: [pinButton(w.kind, w.id, w.name), h("button", { class: "btn", type: "button", onclick: () => openWork(w.kind, w.id) }, "Project details")],
    side: sideOf(w), progressView: () => progressOf(w),
  });
}
export function render(sub) {
  const k = sub ? decodeURIComponent(sub) : "";
  const w = k && allWork().find((x) => key(x) === k);
  return w ? workPage(w) : boxes();
}
