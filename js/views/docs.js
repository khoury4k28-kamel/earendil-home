// Documents: the current decks first, then every deck, brochure, reference,
// film and image, each with a thumbnail. Click one to open it. The files are
// collected into the vault by its build-documents script; the hub only shows them.

import { h, fmtDate, plural, refresh } from "../ui.js";
import { state } from "../store.js";

let cat = "all";
let query = "";
let showOlder = false;

const AUDIENCE = {
  internal: ["Internal", "Don't send outside the team"],
  confidential: ["Confidential", "Share only under NDA"],
  partner: ["For the partner", "Made to go to that partner"],
  external: ["Can be shared", "Uses public figures only"],
};
function size(bytes) {
  if (!bytes) return "";
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
const url = (path) => state.documentsBase + path;

function card(d, big) {
  const [tag, tip] = AUDIENCE[d.audience] || ["", ""];
  const meta = [d.kind, d.pages && plural(d.pages, "page"), fmtDate(d.date), size(d.size)].filter(Boolean).join(" · ");
  return h("article", { class: "doc" + (big ? " doc--big" : "") },
    h("a", { class: "doc__thumb", href: url(d.file), target: "_blank", rel: "noopener", "aria-label": "Open " + d.title },
      h("img", { src: url(d.thumb), alt: "", width: d.w, height: d.h }),   // loaded at once: there are few, and they are small
      d.kind === "Video" && h("span", { class: "doc__play", "aria-hidden": "true" }, "▶"),
      d.archive && h("span", { class: "doc__badge" }, "Earlier version")),
    h("div", { class: "doc__body" },
      h("a", { class: "doc__title", href: url(d.file), target: "_blank", rel: "noopener" }, d.title),
      h("div", { class: "doc__meta" }, meta),
      d.note && h("div", { class: "doc__note" }, d.note),
      h("div", { class: "doc__foot" },
        tag && h("span", { class: "tag aud aud--" + d.audience, title: tip }, tag),
        d.live && h("a", { class: "doc__live", href: d.live, target: "_blank", rel: "noopener noreferrer" }, "Live deck →"))));
}

export function render() {
  const all = state.documents;
  if (!all.length) {
    return h("main", { class: "page" }, h("div", { class: "page-head" }, h("h1", { class: "h1" }, "Documents")),
      h("div", { class: "empty" }, h("div", null, h("b", null, "No documents yet."))));
  }
  const cats = [...new Set(all.map((d) => d.category))];
  const q = query.trim().toLowerCase();
  const current = all.filter((d) => !d.archive);
  const pool = showOlder || q ? all : current;
  const shown = pool.filter((d) => (cat === "all" || d.category === cat) && (!q || [d.title, d.category, d.note, d.kind].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => Number(a.archive) - Number(b.archive) || String(b.date).localeCompare(String(a.date)));
  const latest = all.filter((d) => d.top).sort((a, b) => a.top - b.top);   // the row at the top, in the order set in the vault
  const older = all.length - current.length;
  const count = (c) => pool.filter((d) => c === "all" || d.category === c).length;
  const line = [plural(current.length, "document"), ...cats.slice(0, 3).map((c) => `${current.filter((d) => d.category === c).length} ${c.toLowerCase()}`),
    state.documentsUpdated && "collected " + fmtDate(state.documentsUpdated)].filter(Boolean).join(" · ");
  const search = h("input", { class: "input search", id: "docs-search", type: "search", placeholder: "Search documents", value: query, "aria-label": "Search documents" });
  search.addEventListener("input", () => { query = search.value; refresh(); });

  return h("main", { class: "page" },
    h("div", { class: "page-head" }, h("div", { class: "title-line" }, h("h1", { class: "h1" }, "Documents"), h("span", { class: "muted" }, line))),
    cat === "all" && !q && latest.length > 0 && h("section", { class: "sec" },
      h("div", { class: "sec__head" }, h("h2", { class: "sec__title" }, "Current")),
      h("div", { class: "docs docs--big" }, latest.map((d) => card(d, true)))),
    h("div", { class: "filters" },
      [["all", "All"], ...cats.map((c) => [c, c])].map(([value, label]) =>
        h("button", { class: "filter", type: "button", "aria-pressed": String(cat === value), onclick: () => { cat = value; refresh(); } }, label, h("span", { class: "num" }, count(value)))),
      older > 0 && h("button", { class: "filter filter--quiet", type: "button", "aria-pressed": String(showOlder), onclick: () => { showOlder = !showOlder; refresh(); } },
        "Earlier versions", h("span", { class: "num" }, older)),
      search),
    shown.length ? h("div", { class: "docs" }, shown.map((d) => card(d, false))) : h("div", { class: "muted" }, "No match."));
}
