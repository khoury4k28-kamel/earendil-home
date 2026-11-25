// Deals & Tasks: where the work is kept. The tab opens on a box for every
// deal and project (a deal is a project with a pipeline). A task always sits
// inside one of them. Press a box and it opens on its own page:
// its tasks, the subtasks under each, and how far along they are. Home only
// gathers from here.

import { h, refresh, quickAdd, fmtDate, fmtDateTime, fmtRange, plural, avatar, kv } from "../ui.js";
import { state, create, update, personName, byId, sortByName, notesFor, addNote, fileUrl, projectsForDeal } from "../store.js";
import { stageLabel, projectStatusLabel, categoryLabel } from "../schema.js";
import { editRecord, openWork, workMark, stalledDays, personChip, openContact, noteMeta } from "../detail.js";
import { allWork, isLive, isOn, tasksOf, subtasksOf, subtasksReady, addSubtask, taskOrder, progress, docsFor, docsReady } from "../work.js";

let scope = null;        // "mine" or "all"; mine once the hub knows who is looking
let showFinished = false;
let showDone = false;

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
  const pool = allWork().filter((w) => !mine || isOn(w.rec, meId()));
  const order = (a, b) => String(a.next?.due || "9").localeCompare(String(b.next?.due || "9")) || a.name.localeCompare(b.name);
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
      meta && h("div", { class: "wbox__tmeta" }, meta)));
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
      quiet ? h("span", { class: "stalled" }, `No contact in ${quiet} days`)
        : isDeal && r.last_touch && h("span", null, "Last contact " + fmtDate(r.last_touch))),
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
    h("div", { class: "wbox__newb" }, add.slice(1).reverse()));
}
const addButtons = (belongs = {}) => [
  h("button", { class: "btn", type: "button", onclick: () => editRecord("tasks", null, { status: "todo", owner_id: meId() || null, ...belongs }) }, "Add task"),
  h("button", { class: "btn", type: "button", onclick: () => editRecord("projects", null, { status: "active", owner_id: meId() || null, people_ids: [] }, (row) => go("project:" + row.id)) }, "Add project"),
  h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("deals", null, { stage: "lead", kind: "customer", owner_id: meId() || null, people_ids: [], contact_ids: [] }, (row) => go("deal:" + row.id)) }, "Add deal"),
];
function boxes() {
  const mine = whose() === "mine";
  const { live, finished } = workList(mine);
  return h("main", { class: "page page--boxes" },
    h("div", { class: "page-head" },
      h("h1", { class: "h1" }, "Deals & Tasks"),
      h("div", { class: "actions" },
        meId() && seg("Whose work", [["mine", "Mine"], ["all", "Everyone"]], whose(), (v) => { scope = v; }),
        addButtons())),
    live.length + (showFinished ? finished.length : 0) > 0
      ? h("div", { class: "wboxes" }, live.map(box), showFinished && finished.map(box),
        (live.length + (showFinished ? finished.length : 0)) % 2 === 1 && newBox(addButtons()))
      : h("div", { class: "empty" }, h("div", null, h("b", null, mine ? "No deals or projects of yours yet." : "No deals or projects yet."))),
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
const taskMeta = (t) => [personName(t.owner_id), t.status === "doing" && "In progress", t.due && "Due " + fmtDate(t.due)].filter(Boolean).join(" · ");
function subRow(s) {
  const meta = taskMeta(s);
  return h("li", { class: "row srow" + (s.status === "done" ? " done" : "") }, tick(s),
    h("button", { class: "row__main rowbtn", type: "button", onclick: () => editRecord("tasks", s) },
      h("div", { class: "row__title" }, s.title), meta && h("div", { class: "row__meta" }, meta)));
}
function taskRow(t, isNext) {
  const subs = subtasksOf(t.id);
  const subsDone = subs.filter((s) => !isOpen(s)).length;
  const meta = taskMeta(t);
  return h("li", { class: "tkrow" + (t.status === "done" ? " done" : "") },
    h("div", { class: "row tkrow__line" }, tick(t),
      h("button", { class: "row__main rowbtn", type: "button", onclick: () => editRecord("tasks", t) },
        h("div", { class: "row__title" }, isNext && h("span", { class: "next" }, "Next"), t.title),
        meta && h("div", { class: "row__meta" }, meta)),
      subs.length > 0 && h("span", { class: "tkrow__n num", title: `${subsDone} of ${subs.length} subtasks done` }, `${subsDone}/${subs.length}`),
      subs.length > 0 && h("span", { class: "bar", role: "img", "aria-label": `${subsDone} of ${subs.length} subtasks done` },
        h("span", { style: `width:${Math.round((subsDone / subs.length) * 100)}%` }))),
    (subs.length > 0 || (subtasksReady() && isOpen(t))) && h("div", { class: "subs" },
      subs.length > 0 && h("ul", { class: "rows" }, subs.map(subRow)),
      subtasksReady() && isOpen(t) && quickAdd(`wk-sub-${t.id}`, "Add a subtask", (title) => addSubtask(t, title))));
}
function inside({ crumb, facts, done, total, tasks, addId, addLabel, onAdd, actions, markNext, side }) {
  const open = tasks.filter(isOpen).sort(taskOrder);
  const finished = tasks.filter((t) => !isOpen(t)).sort(taskOrder);
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "crumbs crumbs--page" }, h("a", { href: "#work" }, "Deals & Tasks"), h("span", { class: "muted" }, " / "), h("b", null, crumb)),
      h("div", { class: "actions" }, actions)),
    h("div", { class: "winside" },
      h("div", { class: "winside__main" },
      h("div", { class: "sub" }, facts),
      meter(done, total),
      h("section", { class: "panel" },
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
function teamBlock(table, r) {
  const ids = [...new Set([r.owner_id, ...(r.people_ids || [])])].filter((id) => byId("people", id));
  const others = sortByName(state.people.filter((p) => !ids.includes(p.id))).map((p) => [p.id, p.name]);
  return gathered("Team", ids.length,
    h("div", { class: "chips" }, ids.map((id) => personChip(id)),
      adder("Add a team member", others, (id) => update(table, r.id, { people_ids: [...(r.people_ids || []), id] }))));
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
    linked && h("button", { class: "more more--head", type: "button", title: "Take this document off the deal",
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
  return gathered("Projects under this deal", list.length, h("ul", { class: "rows" }, list.map((p) => {
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
    quickAdd(`wk-note-${type}-${id}`, "Add a note", (body) => addNote(type, id, body)),
    notes.slice(0, 5).map((n) => h("div", { class: "note" },
      h("div", { class: "prose" }, n.body),
      noteMeta(n))),
    notes.length > 5 && h("div", { class: "small muted" }, `${notes.length - 5} earlier in the details panel`));
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
    ["Deal", parent && h("a", { class: "link", href: `#work/deal:${parent.id}` }, parent.name)],
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
function workPage(w) {
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
    actions: h("button", { class: "btn", type: "button", onclick: () => openWork(w.kind, w.id) }, isDeal ? "Deal details" : "Project details"),
    side: sideOf(w),
  });
}
export function render(sub) {
  const k = sub ? decodeURIComponent(sub) : "";
  const w = k && allWork().find((x) => key(x) === k);
  return w ? workPage(w) : boxes();
}
