// Deal Tracker: every deal the company is working on, as a board by stage or
// as a table. Open a deal to see who's involved, its size and its progress.

import { h, avatar, letterAvatar, fmtDate, fmtMoney, fmtRange, daysSince, plural, refresh, inlineEdit } from "../ui.js";
import { state, update, isOpenDeal, personName, sortByName } from "../store.js";
import { STAGES, stageLabel } from "../schema.js";
import { editRecord, openDeal, stalledDays, setStage, dealIssues, pickPerson } from "../detail.js";

let mode = "board";
try { mode = localStorage.getItem("deals-view") || "board"; } catch { /* storage may be blocked */ }
function setMode(m) {
  mode = m;
  try { localStorage.setItem("deals-view", m); } catch { /* ignore */ }
  refresh();
}

// Which deals to show: all of them, the ones missing something, or mine.
let show = "all";
const NEW_DEAL = { kind: "customer", people_ids: [], contact_ids: [] };
const isMine = (d) => d.owner_id === state.me.id || (d.people_ids || []).includes(state.me.id);
function visible() {
  if (show === "mine" && !state.me.id) show = "all";
  return state.deals.filter((d) => (show === "attention" ? dealIssues(d).length > 0 : show === "mine" ? isMine(d) : true));
}
function filters() {
  const pills = [
    ["all", "All", state.deals.length],
    ["attention", "Needs attention", state.deals.filter((d) => dealIssues(d).length > 0).length],
    state.me.id && ["mine", "Mine", state.deals.filter(isMine).length],
  ].filter(Boolean);
  return h("div", { class: "filters" }, pills.map(([value, label, n]) =>
    h("button", { class: "filter", type: "button", "aria-pressed": String(show === value), onclick: () => { show = value; refresh(); } },
      label, h("span", { class: "num" }, n))));
}

function stat(label, value, note, red) {
  return h("div", { class: "stat", title: note || null },
    h("div", { class: "stat__v" + (red ? " stat__v--red" : "") }, value), h("div", { class: "stat__note" }, label));
}

export function summary() {
  const open = state.deals.filter(isOpenDeal);
  const sized = open.filter((d) => d.size_low != null || d.size_high != null);
  const lo = sized.reduce((s, d) => s + (d.size_low ?? d.size_high), 0);
  const hi = sized.reduce((s, d) => s + (d.size_high ?? d.size_low), 0);
  const stalled = open.filter((d) => stalledDays(d) != null).length;
  const noDate = open.filter((d) => !d.last_touch).length;
  const done = state.deals.length - open.length;
  const total = state.deals.length || 1;
  return h("div", { class: "block" },
    h("div", { class: "stats" },
      stat("in pipeline", sized.length ? fmtRange(lo, hi) : fmtMoney(0), `Estimates on ${sized.length} of ${plural(open.length, "open deal")}`),
      stat("open", open.length, "Lead to negotiating"),
      stat("stalled", stalled, "No contact in 30 days" + (noDate ? `. ${noDate} more have no contact date logged` : ""), stalled > 0),
      stat("no size yet", open.length - sized.length, "Open deals without an estimate"),
      stat("signed or closed", done)),
    h("div", { class: "stagebar-all", role: "img", "aria-label": "Deals by stage" },
      STAGES.map((s) => h("span", { class: "c-" + s.value, title: s.label, style: `width:${(state.deals.filter((d) => (d.stage || "lead") === s.value).length / total) * 100}%` }))));
}

function dealCard(d) {
  const size = fmtRange(d.size_low, d.size_high);
  const stalled = stalledDays(d);
  const days = d.last_touch ? daysSince(d.last_touch) : null;
  const open = () => openDeal(d.id);
  return h("div", {
    class: "deal", role: "button", tabindex: "0", draggable: "true",
    onclick: open,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
    ondragstart: (e) => { e.dataTransfer.setData("text/plain", d.id); e.dataTransfer.effectAllowed = "move"; },
  },
    h("div", { class: "deal__top" }, letterAvatar(d.organisation || d.name),
      h("div", { style: "min-width:0;flex:1" },
        h("div", { class: "deal__name" }, d.name),
        h("div", { class: "deal__meta" }, [d.kind && d.kind[0].toUpperCase() + d.kind.slice(1), d.region].filter(Boolean).join(" · ")),
        size && h("div", { class: "deal__size num" }, size))),
    isOpenDeal(d) && h("div", { class: "deal__next" + (d.next_step ? "" : " muted") }, d.next_step || "No next step"),
    h("div", { class: "deal__foot" },
      d.owner_id && personName(d.owner_id) ? avatar(personName(d.owner_id), "s") : h("span", { class: "muted" }, "No owner"),
      stalled ? h("span", { class: "stalled", title: `No contact in ${stalled} days` }, `${stalled}d`)
        : isOpenDeal(d) && days != null && h("span", { class: "days", title: "Since the last contact" }, days <= 0 ? "today" : `${days}d`)));
}

function board(deals) {
  return h("div", { class: "board-wrap" }, h("div", { class: "board" }, STAGES.map((s) => {
    const inStage = sortByName(deals.filter((d) => (d.stage || "lead") === s.value));
    const lo = inStage.reduce((t, d) => t + (d.size_low ?? d.size_high ?? 0), 0);
    const hi = inStage.reduce((t, d) => t + (d.size_high ?? d.size_low ?? 0), 0);
    const col = h("section", { class: "col col--" + s.value },
      h("div", { class: "col__head" },
        h("h2", { class: "col__title" }, h("span", { class: "dot c-" + s.value }), s.label, h("span", { class: "n" }, inStage.length)),
        h("button", { class: "col__add", type: "button", "aria-label": `Add a deal in ${s.label}`, title: "Add a deal here",
          onclick: () => editRecord("deals", null, { ...NEW_DEAL, stage: s.value }) }, "+"),
        hi > 0 && h("span", { class: "col__sum num" }, fmtRange(lo, hi))),
      h("div", { class: "col__body" }, inStage.map(dealCard)));
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("is-over"); });
    col.addEventListener("dragleave", () => col.classList.remove("is-over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("is-over");
      const id = e.dataTransfer.getData("text/plain");
      if (state.deals.some((d) => d.id === id)) setStage(id, s.value, { undo: true });
    });
    return col;
  })));
}

// The table edits in place: owner, last contact and next step.
function table(deals) {
  const order = Object.fromEntries(STAGES.map((s, i) => [s.value, i]));
  const sorted = [...deals].sort((a, b) => order[a.stage] - order[b.stage] || a.name.localeCompare(b.name));
  return h("div", { class: "table-wrap" }, h("table", null,
    h("thead", null, h("tr", null, ["Deal", "With", "Stage", "Size", "Owner", "Last contact", "Next step"].map((c) => h("th", null, c)))),
    h("tbody", null, sorted.map((d) => {
      const stalled = stalledDays(d);
      const save = (key) => (v) => update("deals", d.id, { [key]: v });
      return h("tr", { class: "clickable", onclick: () => openDeal(d.id) },
        h("td", null, h("div", { class: "name" }, d.name)),
        h("td", null, d.organisation, h("div", { class: "row__meta" }, [d.kind && d.kind[0].toUpperCase() + d.kind.slice(1), d.region].filter(Boolean).join(" · "))),
        h("td", { class: "tight" }, h("span", { class: "dot c-" + (d.stage || "lead") }), stageLabel(d.stage)),
        h("td", { class: "tight num" }, fmtRange(d.size_low, d.size_high)),
        h("td", { class: "tight" }, pickPerson({ value: d.owner_id, blank: "No owner", label: `Owner of ${d.name}`, onChange: save("owner_id") })),
        h("td", { class: "tight" },
          inlineEdit({ id: `t-touch-${d.id}`, value: d.last_touch, display: fmtDate(d.last_touch), placeholder: "Add date", label: `Last contact on ${d.name}`, type: "date", onSave: save("last_touch") }),
          stalled && h("div", { class: "stalled small" }, `Stalled ${stalled}d`)),
        h("td", { class: "cell-edit" }, inlineEdit({ id: `t-next-${d.id}`, value: d.next_step, placeholder: "Add next step", label: `Next step on ${d.name}`, onSave: save("next_step") })));
    }))));
}

export function render() {
  const deals = visible();
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("h1", { class: "h1" }, "Deal Tracker"),
      h("div", { class: "actions" },
        h("div", { class: "seg", role: "group", "aria-label": "View" },
          h("button", { type: "button", "aria-pressed": String(mode === "board"), onclick: () => setMode("board") }, "Board"),
          h("button", { type: "button", "aria-pressed": String(mode === "table"), onclick: () => setMode("table") }, "Table")),
        h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("deals", null, { ...NEW_DEAL, stage: "lead" }) }, "Add deal"))),
    summary(),
    state.deals.length > 0 && filters(),
    state.deals.length === 0
      ? h("div", { class: "empty" }, h("div", null, h("b", null, "No deals yet.")))
      : mode === "table" ? (deals.length ? table(deals) : h("div", { class: "muted" }, "Nothing here.")) : board(deals));
}
