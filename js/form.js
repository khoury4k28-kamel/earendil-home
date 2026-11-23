// One form builder for every kind of record. A field list goes in; a dialog
// with the right inputs comes out, and the typed values come back on Save.

import { h, openDialog } from "./ui.js";

function control(f, value) {
  const id = "f-" + f.key;
  switch (f.type) {
    case "textarea":
      return h("textarea", { class: "textarea", id, placeholder: f.placeholder }, value ?? "");
    case "lines":
      return h("textarea", { class: "textarea", id, placeholder: f.placeholder }, (value || []).join("\n"));
    case "select": {
      const sel = h("select", { class: "select", id },
        !f.required && h("option", { value: "" }, f.blank || "Not set"),
        (f.options || []).map((o) => h("option", { value: o.value }, o.label)),
        (f.groups || []).filter((g) => g.options.length).map((g) => h("optgroup", { label: g.label }, g.options.map((o) => h("option", { value: o.value }, o.label)))));
      sel.value = value ?? (f.required ? f.options?.[0]?.value : "");
      return sel;
    }
    case "multi": {
      const chosen = new Set(value || []);
      if (!f.options.length) return h("div", { class: "field__hint" }, f.none || "Nothing to choose from yet.");
      const tick = (o) => h("label", { class: "tick" },
        h("input", { type: "checkbox", value: o.value, checked: chosen.has(o.value) }), o.label);
      const groups = (f.groups || []).filter((g) => g.options.length);
      if (!groups.length) return h("div", { class: "picks", id }, f.options.map(tick));
      // Grouped: one row per group that opens to show its people. The row's own
      // box ticks or clears the whole group.
      return h("div", { class: "picks picks--groups", id }, groups.map((g) => {
        const rows = g.options.map(tick);
        const boxes = rows.map((r) => r.firstChild);
        const all = h("input", { type: "checkbox", class: "tick__all", "aria-label": "Everyone in " + g.label });
        const count = h("span", { class: "pgroup__count" });
        const sync = () => {
          const n = boxes.filter((b) => b.checked).length;
          all.checked = n === boxes.length;
          all.indeterminate = n > 0 && n < boxes.length;
          count.textContent = n ? `${n} of ${boxes.length}` : String(boxes.length);
        };
        all.addEventListener("change", () => { boxes.forEach((b) => { b.checked = all.checked; }); sync(); });
        boxes.forEach((b) => b.addEventListener("change", sync));
        sync();
        const group = h("details", { class: "pgroup", open: boxes.some((b) => b.checked) },
          h("summary", { class: "pgroup__head" }, all, h("span", { class: "pgroup__name" }, g.label), count),
          h("div", { class: "pgroup__body" }, rows));
        all.addEventListener("change", () => { if (all.checked) group.open = true; });   // show who was just ticked
        return group;
      }));
    }
    case "checkbox":
      return h("label", { class: "tick" }, h("input", { type: "checkbox", id, checked: !!value }), f.checkLabel || f.label);
    default:
      return h("input", {
        class: "input", id, type: f.type || "text", value: value ?? "", placeholder: f.placeholder,
        step: f.type === "number" ? "any" : null, autocomplete: "off", list: f.list ? f.list() : null,
      });
  }
}

function read(f, root) {
  const el = root.querySelector("#f-" + f.key);
  switch (f.type) {
    case "multi":
      return el ? [...el.querySelectorAll("input:checked:not(.tick__all)")].map((i) => i.value) : [];
    case "checkbox":
      return el.checked;
    case "lines":
      return el.value.split("\n").map((s) => s.trim()).filter(Boolean);
    case "number":
      return el.value.trim() === "" || isNaN(Number(el.value)) ? null : Number(el.value);
    default: {
      const v = el.value.trim();
      return v === "" ? null : v;
    }
  }
}

export function openForm({ title, fields, record = {}, onSave, onDelete, saveLabel = "Save" }) {
  const error = h("div", { class: "form-error", hidden: true });
  const form = h("form", { class: "form", novalidate: true },
    error,
    fields.map((f) => h("div", { class: "field" + (f.wide || ["textarea", "lines", "multi"].includes(f.type) ? " wide" : "") },
      f.type !== "checkbox" && h("label", { class: "field__label", for: "f-" + f.key }, f.label + (f.required ? " *" : "")),
      control(f, record[f.key]),
      f.hint && h("div", { class: "field__hint" }, f.hint))));

  const save = h("button", { class: "btn btn--primary", type: "button" }, saveLabel);
  const del = onDelete && h("button", { class: "btn btn--quiet", type: "button" }, "Delete");
  const close = openDialog({
    title, body: form,
    foot: [h("div", { class: "actions" }, del), h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"), save)],
  });

  async function submit() {
    const values = {};
    for (const f of fields) values[f.key] = read(f, form);
    const missing = fields.find((f) => f.required && (values[f.key] == null || values[f.key] === ""));
    if (missing) {
      error.textContent = `${missing.label} is needed.`;
      error.hidden = false;
      form.querySelector("#f-" + missing.key)?.focus();
      return;
    }
    save.disabled = true;
    await onSave(values);
    close();
  }
  save.addEventListener("click", submit);
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") { e.preventDefault(); submit(); }
  });

  if (del) {
    let armed = false;
    del.addEventListener("click", async () => {
      if (!armed) { armed = true; del.textContent = "Click again to delete"; del.classList.remove("btn--quiet"); return; }
      await onDelete();
      close();
    });
  }
}
