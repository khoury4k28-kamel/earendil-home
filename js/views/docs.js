// Documents: your pinned ones first, then every deck, brochure and image, each
// with a thumbnail. Click one to open it; press its pin to keep it at the top.
// Pins are personal: what you pin shows for you and nobody else. The files are
// collected into the vault by its build-documents script; the hub only shows them.

import { h, fmtDate, plural, refresh, toast } from "../ui.js";
import { state, pinnedDocs, togglePin } from "../store.js";

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

const NS = "http://www.w3.org/2000/svg";
function pinIcon() {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M9 3h6l-1 6 3 3v2h-4.2V21h-1.6v-7H7v-2l3-3-1-6z");
  svg.append(path);
  return svg;
}
function pinButton(d, pinned) {
  return h("button", {
    class: "doc__pin", type: "button", "aria-pressed": String(pinned), "aria-label": (pinned ? "Unpin " : "Pin ") + d.title, title: pinned ? "Unpin" : "Pin for yourself",
    onclick: () => { togglePin(d.id); toast(pinned ? "Unpinned." : "Pinned for you."); },
  }, pinIcon());
}

// RULE: every document shown has a thumbnail. One without, or whose picture
// fails to load, is not shown.
function thumb(d) {
  const img = h("img", { src: url(d.thumb), alt: "", width: d.w, height: d.h });   // loaded at once: there are few, and they are small
  img.addEventListener("error", () => img.closest(".doc")?.remove());
  return img;
}

function card(d, big, pinned) {
  const [tag, tip] = AUDIENCE[d.audience] || ["", ""];
  const meta = [d.kind, d.pages && plural(d.pages, "page"), fmtDate(d.date), size(d.size)].filter(Boolean).join(" · ");
  return h("article", { class: "doc" + (big ? " doc--big" : "") + (pinned ? " is-pinned" : "") },
    pinButton(d, pinned),
    h("a", { class: "doc__thumb", href: url(d.file), target: "_blank", rel: "noopener", "aria-label": "Open " + d.title },
      thumb(d),
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
  const all = state.documents.filter((d) => d.thumb);
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
  const pins = pinnedDocs();
  const pinned = pins.map((id) => all.find((d) => d.id === id)).filter(Boolean);   // this person's own, in the order they pinned them
  const older = all.length - current.length;
  const count = (c) => pool.filter((d) => c === "all" || d.category === c).length;
  const line = [plural(current.length, "document"), ...cats.slice(0, 3).map((c) => `${current.filter((d) => d.category === c).length} ${c.toLowerCase()}`),
    state.documentsUpdated && "collected " + fmtDate(state.documentsUpdated)].filter(Boolean).join(" · ");
  const search = h("input", { class: "input search", id: "docs-search", type: "search", placeholder: "Search documents", value: query, "aria-label": "Search documents" });
  search.addEventListener("input", () => { query = search.value; refresh(); });

  return h("main", { class: "page" },
    h("div", { class: "page-head" }, h("div", { class: "title-line" }, h("h1", { class: "h1" }, "Documents"), h("span", { class: "muted" }, line))),
    cat === "all" && !q && h("section", { class: "sec" },
      h("div", { class: "sec__head" }, h("h2", { class: "sec__title" }, pinned.length ? `Pinned · ${pinned.length}` : "Pinned")),
      pinned.length
        ? h("div", { class: "docs docs--big" }, pinned.map((d) => card(d, true, true)))
        : h("div", { class: "muted" }, "Nothing pinned. Press the pin on any document to keep it here. Only you see your pins.")),
    h("div", { class: "filters" },
      [["all", "All"], ...cats.map((c) => [c, c])].map(([value, label]) =>
        h("button", { class: "filter", type: "button", "aria-pressed": String(cat === value), onclick: () => { cat = value; refresh(); } }, label, h("span", { class: "num" }, count(value)))),
      older > 0 && h("button", { class: "filter filter--quiet", type: "button", "aria-pressed": String(showOlder), onclick: () => { showOlder = !showOlder; refresh(); } },
        "Earlier versions", h("span", { class: "num" }, older)),
      search),
    shown.length ? h("div", { class: "docs" }, shown.map((d) => card(d, false, pins.includes(d.id)))) : h("div", { class: "muted" }, "No match."));
}
