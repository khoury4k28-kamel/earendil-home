// Deal Tracker: every deal the company is working on, as a board by stage or
// as a table. Open a deal to see who's involved, its size and its progress.

import { h, avatar, fmtDate, fmtRange, plural, refresh } from "../ui.js";
import { state, update, isOpenDeal, personName, sortByName } from "../store.js";
import { STAGES, stageLabel } from "../schema.js";
import { editRecord, openDeal, stalledDays } from "../detail.js";

let mode = "board";
try { mode = localStorage.getItem("deals-view") || "board"; } catch { /* storage may be blocked */ }
function setMode(m) {
  mode = m;
  try { localStorage.setItem("deals-view", m); } catch { /* ignore */ }
  refresh();
}

function stat(label, value, note) {
  return h("div", { class: "stat" }, h("div", { class: "eyebrow" }, label), h("div", { class: "stat__v" }, value), note && h("div", { class: "stat__note" }, note));
}

function summary() {
  const open = state.deals.filter(isOpenDeal);
  const sized = open.filter((d) => d.size_low != null || d.size_high != null);
  const lo = sized.reduce((s, d) => s + (d.size_low ?? d.size_high), 0);
  const hi = sized.reduce((s, d) => s + (d.size_high ?? d.size_low), 0);
  const stalled = open.filter((d) => stalledDays(d) != null).length;
  const noDate = open.filter((d) => !d.last_touch).length;
  const done = state.deals.length - open.length;
  return h("div", { class: "stats" },
    stat("Sized pipeline", sized.length ? fmtRange(lo, hi) : "None yet", `Estimates on ${sized.length} of ${plural(open.length, "open deal")}`),
    stat("Open", open.length, "Lead to negotiating"),
    stat("Stalled", stalled, "No contact in 30 days" + (noDate ? `. ${noDate} more have no contact date` : "")),
    stat("No size yet", open.length - sized.length, "Open deals without an estimate"),
    stat("Signed or closed", done, done ? "" : "Nothing signed yet"));
}

function dealCard(d) {
  const size = fmtRange(d.size_low, d.size_high);
  const stalled = stalledDays(d);
  const open = () => openDeal(d.id);
  return h("div", {
    class: "deal", role: "button", tabindex: "0", draggable: "true",
    onclick: open,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
    ondragstart: (e) => { e.dataTransfer.setData("text/plain", d.id); e.dataTransfer.effectAllowed = "move"; },
  },
    h("div", { class: "deal__name" }, d.name),
    h("div", { class: "deal__meta" }, [d.kind && d.kind[0].toUpperCase() + d.kind.slice(1), d.region].filter(Boolean).join(" · ")),
    h("div", { class: "deal__foot" },
      h("span", { class: "num" }, size || h("span", { class: "muted" }, "No size yet")),
      d.owner_id && personName(d.owner_id) ? avatar(personName(d.owner_id), "s") : h("span", { class: "muted small" }, "No owner")),
    (stalled || d.to_confirm) && h("div", { class: "deal__foot" },
      stalled ? h("span", { class: "stalled" }, h("span", { class: "sq" }), `Stalled ${stalled} d`) : h("span"),
      d.to_confirm && h("span", { class: "tag" }, "To confirm")));
}

function board() {
  return h("div", { class: "board-wrap" }, h("div", { class: "board" }, STAGES.map((s) => {
    const deals = sortByName(state.deals.filter((d) => (d.stage || "lead") === s.value));
    const lo = deals.reduce((t, d) => t + (d.size_low ?? d.size_high ?? 0), 0);
    const hi = deals.reduce((t, d) => t + (d.size_high ?? d.size_low ?? 0), 0);
    const col = h("section", { class: "col" + (s.value === "signed" ? " col--signed" : "") },
      h("div", { class: "col__head" },
        h("h2", { class: "caps" }, `${s.label} · ${deals.length}`),
        h("span", { class: "num small" }, hi ? fmtRange(lo, hi) : "")),
      h("div", { class: "col__body" }, deals.length ? deals.map(dealCard) : h("div", { class: "col__none" }, "None")));
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("is-over"); });
    col.addEventListener("dragleave", () => col.classList.remove("is-over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("is-over");
      const id = e.dataTransfer.getData("text/plain");
      const deal = state.deals.find((d) => d.id === id);
      if (deal && deal.stage !== s.value) update("deals", id, { stage: s.value });
    });
    return col;
  })));
}

function table() {
  const order = Object.fromEntries(STAGES.map((s, i) => [s.value, i]));
  const deals = [...state.deals].sort((a, b) => order[a.stage] - order[b.stage] || a.name.localeCompare(b.name));
  return h("div", { class: "table-wrap" }, h("table", null,
    h("thead", null, h("tr", null, ["Deal", "With", "Stage", "Size", "Owner", "Last contact", "Next step"].map((c) => h("th", null, c)))),
    h("tbody", null, deals.map((d) => {
      const stalled = stalledDays(d);
      return h("tr", { class: "clickable", onclick: () => openDeal(d.id) },
        h("td", null, h("div", { class: "name" }, d.name), d.to_confirm && h("span", { class: "tag" }, "To confirm")),
        h("td", null, d.organisation, h("div", { class: "row__meta" }, [d.kind, d.region].filter(Boolean).join(" · "))),
        h("td", { class: "tight" }, stageLabel(d.stage)),
        h("td", { class: "tight num" }, fmtRange(d.size_low, d.size_high) || h("span", { class: "muted" }, "Not set")),
        h("td", { class: "tight" }, personName(d.owner_id) || h("span", { class: "muted" }, "Nobody yet")),
        h("td", { class: "tight" }, d.last_touch ? fmtDate(d.last_touch) : h("span", { class: "muted" }, "None logged"),
          stalled && h("div", { class: "stalled small" }, `Stalled ${stalled} d`)),
        h("td", null, d.next_step || h("span", { class: "muted" }, "Not set")));
    }))));
}

export function render() {
  return h("main", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "page-head__text" }, h("h1", { class: "h1" }, "Deal Tracker"),
        h("div", { class: "sub" }, "Everything the company is working on: who's involved, how big, and where it stands. Anyone on the team can edit.")),
      h("div", { class: "actions" },
        h("div", { class: "seg", role: "group", "aria-label": "View" },
          h("button", { type: "button", "aria-pressed": String(mode === "board"), onclick: () => setMode("board") }, "Board"),
          h("button", { type: "button", "aria-pressed": String(mode === "table"), onclick: () => setMode("table") }, "Table")),
        h("button", { class: "btn btn--primary", type: "button", onclick: () => editRecord("deals", null, { stage: "lead", kind: "customer", people_ids: [], contact_ids: [] }) }, "Add deal"))),
    summary(),
    state.deals.length === 0
      ? h("div", { class: "empty" }, h("div", null, h("b", null, "No deals yet."), " Add the first one to start the tracker."))
      : mode === "table" ? table() : board(),
    mode === "board" && state.deals.length > 0 && h("div", { class: "small muted" }, "Drag a card to another column to change its stage, or open it and pick the stage there."));
}
