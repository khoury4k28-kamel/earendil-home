// Documents: your pinned ones first, then every deck, brochure and image, each
// with a thumbnail. Click one to open it; press its pin to keep it at the top.
// Pins are personal: what you pin shows for you and nobody else. Anyone on the
// team can add a PDF or a picture, replace it with a newer version, or remove it.

import { h, fmtDate, plural, refresh, toast, openDialog } from "../ui.js";
import { openForm } from "../form.js";
import { state, pinnedDocs, togglePin, fileUrl, update, addDocument, replaceDocumentFile, removeDocument } from "../store.js";
import { ACCEPT, refusal, makeThumb } from "../thumbs.js";

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
const url = fileUrl;

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
        d.live && h("a", { class: "doc__live", href: d.live, target: "_blank", rel: "noopener noreferrer" }, "Live deck →")),
      state.documentsEditable && h("div", { class: "doc__tools" },
        h("button", { class: "doc__tool", type: "button", onclick: () => editDocument(d) }, "Edit"),
        h("button", { class: "doc__tool", type: "button", onclick: () => pickFile((file) => replaceWith(d, file)) }, "Replace file"))));
}

// ---------- adding and changing ----------
const AUDIENCES = Object.entries(AUDIENCE).map(([value, [label]]) => ({ value, label }));
const categories = () => [...new Set(["Pitch decks", "Partnerships", "Product", "Visuals", ...state.documents.map((d) => d.category).filter(Boolean)])];
function categoryList() {
  const id = "doc-categories";
  document.getElementById(id)?.remove();
  document.body.append(h("datalist", { id }, categories().map((c) => h("option", { value: c }))));
  return id;
}
const titleFrom = (name) => name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
const liveLink = (v) => (v && /^https:\/\//i.test(v) ? v : null);

function pickFile(then) {
  const input = h("input", { type: "file", accept: ACCEPT, hidden: true });
  input.addEventListener("change", () => { const f = input.files[0]; input.remove(); if (f) then(f); });
  document.body.append(input);
  input.click();
}

async function replaceWith(d, file) {
  const no = refusal(file);
  if (no) { toast(no); return; }
  toast("Sending the new file…");
  let thumb;
  try { thumb = await makeThumb(file); } catch (err) { console.error(err); toast("That file couldn't be read, so nothing was changed."); return; }
  toast((await replaceDocumentFile(d.id, file, thumb)) ? "Replaced. Pins and details are kept." : "The new file couldn't be sent. Check your connection and try again.");
}

function editDocument(d) {
  openForm({
    title: "Edit document",
    record: d,
    fields: [
      { key: "title", label: "Title", required: true, wide: true },
      { key: "category", label: "Section", required: true, list: categoryList },
      { key: "audience", label: "Who can see it", type: "select", required: true, options: AUDIENCES },
      { key: "note", label: "Note", type: "textarea", placeholder: "One line on what it is or when to use it" },
      { key: "live", label: "Link to the live deck", wide: true, placeholder: "https://" },
    ],
    onSave: (v) => update("documents", d.id, { ...v, live: liveLink(v.live) }),
    onDelete: async () => { if (await removeDocument(d.id)) toast("Removed."); },
  });
}

function addDialog(first) {
  let file = null, thumb = null, busy = false;
  const error = h("div", { class: "form-error", hidden: true });
  const fail = (text) => { error.textContent = text; error.hidden = false; };
  const preview = h("div", { class: "drop__preview" });
  const prompt = h("div", { class: "drop__prompt" }, h("b", null, "Choose a file"), h("span", { class: "muted" }, "or drop one here. PDF or picture, up to 50 MB."));
  const drop = h("button", { class: "drop", type: "button" }, preview, prompt);
  const title = h("input", { class: "input", id: "doc-title", type: "text", autocomplete: "off" });
  const category = h("input", { class: "input", id: "doc-category", type: "text", autocomplete: "off", list: categoryList(), placeholder: "Pitch decks, Product, Visuals…" });
  const audience = h("select", { class: "select", id: "doc-audience" }, AUDIENCES.map((o) => h("option", { value: o.value }, o.label)));
  const note = h("textarea", { class: "textarea", id: "doc-note", placeholder: "One line on what it is or when to use it" });
  const live = h("input", { class: "input", id: "doc-live", type: "url", autocomplete: "off", placeholder: "https://" });
  const save = h("button", { class: "btn btn--primary", type: "button", disabled: true }, "Add document");

  async function take(f) {
    if (busy) return;
    const no = refusal(f);
    if (no) { fail(no); return; }
    error.hidden = true;
    file = f; thumb = null; save.disabled = true;
    preview.replaceChildren();
    prompt.replaceChildren(h("b", null, f.name), h("span", { class: "muted" }, "Making the thumbnail…"));
    if (!title.value.trim()) title.value = titleFrom(f.name);
    try { thumb = await makeThumb(f); } catch (err) {
      console.error(err);
      if (file === f) { file = null; prompt.replaceChildren(h("b", null, "Choose a file"), h("span", { class: "muted" }, "PDF or picture, up to 50 MB.")); fail("That file couldn't be read. If it is a PDF with a password, remove the password first."); }
      return;
    }
    if (file !== f) return;   // another file was chosen meanwhile
    preview.replaceChildren(h("img", { src: URL.createObjectURL(thumb.blob), alt: "", width: thumb.w, height: thumb.h }));
    prompt.replaceChildren(h("b", null, f.name), h("span", { class: "muted" }, [thumb.pages && plural(thumb.pages, "page"), size(f.size), "Choose another"].filter(Boolean).join(" · ")));
    save.disabled = false;
  }
  drop.addEventListener("click", () => pickFile(take));
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); });
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) take(f); });

  const field = (label, control, wide) => h("div", { class: "field" + (wide ? " wide" : "") }, h("label", { class: "field__label", for: control.id }, label), control);
  const form = h("form", { class: "form", novalidate: true }, error,
    h("div", { class: "field wide" }, drop),
    field("Title *", title, true), field("Section *", category), field("Who can see it *", audience),
    field("Note", note, true), field("Link to the live deck", live, true));
  const close = openDialog({
    title: "Add a document", body: form,
    foot: [h("span"), h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"), save)],
  });

  async function submit() {
    if (busy || !file || !thumb) return;
    if (!title.value.trim()) { fail("Title is needed."); title.focus(); return; }
    if (!category.value.trim()) { fail("Section is needed."); category.focus(); return; }
    busy = true; save.disabled = true; save.textContent = "Sending…";
    const row = await addDocument(file, thumb, {
      title: title.value.trim(), category: category.value.trim(), audience: audience.value,
      note: note.value.trim() || null, live: liveLink(live.value.trim()),
    });
    if (!row) { busy = false; save.disabled = false; save.textContent = "Add document"; fail("The file couldn't be sent. Check your connection and try again."); return; }
    close();
    toast("Added for the whole team.");
  }
  save.addEventListener("click", submit);
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  if (first) take(first);
}
const addButton = () => state.documentsEditable && h("button", { class: "btn btn--primary", type: "button", onclick: () => addDialog() }, "Add document");

export function render() {
  const all = state.documents.filter((d) => d.thumb && url(d.thumb));   // no picture to show yet: not listed
  if (!all.length) {
    return h("main", { class: "page" }, h("div", { class: "page-head" }, h("h1", { class: "h1" }, "Documents"), addButton()),
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
    h("div", { class: "page-head" }, h("div", { class: "title-line" }, h("h1", { class: "h1" }, "Documents"), h("span", { class: "muted" }, line)), addButton()),
    // Pins stay in view whichever section is picked; only a search sets them aside.
    !q && h("section", { class: "sec" },
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
