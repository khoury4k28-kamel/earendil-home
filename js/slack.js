// What the hub picks up from Slack.
//
// Messages in the channels the hub's Slack app was invited to are read on the
// server (supabase/functions/slack-events). Notes and contact dates go in on
// their own. Anything that would change a record (a task done or added, a
// stage moved, a new contact) arrives here as a suggestion: a person applies
// it or dismisses it. This file is that last step, and what Home shows of it.

import { h, toast, ago, openDialog } from "./ui.js";
import { state, create, update, byId, isOpenDeal } from "./store.js";
import { describe, perform, stillOpen, rec } from "./actions.js";
import { workOf, isOn } from "./work.js";

export const slackReady = () => Boolean(state.slackReady);

// Only an address on Slack's own site becomes a link.
export const slackLink = (url) => (typeof url === "string" && /^https:\/\/[a-z0-9-]+\.slack\.com\//.test(url) ? url : null);

// The deal or project a suggestion is about, if any.
function workFor(s) {
  if (s.target_type === "deal" || s.target_type === "project") {
    const r = rec(s.target_type, s.target_id);
    return r ? { kind: s.target_type, id: r.id, rec: r, name: r.name } : null;
  }
  if (s.target_type === "task") { const t = byId("tasks", s.target_id); return t ? workOf(t) : null; }
  return null;
}
// Whose call is it? Mine if I said it, if it is about work I am on, or if it
// is about work nobody is on (then it is anyone's).
function forMe(s) {
  const me = state.me.id;
  if (!me || s.person_id === me) return true;
  if (s.target_type === "task" && byId("tasks", s.target_id)?.owner_id === me) return true;
  const w = workFor(s);
  if (!w) return !byId("people", s.person_id);
  return isOn(w.rec, me) || !(byId("people", w.rec.owner_id) || (w.rec.people_ids || []).length);
}

// Suggestions still waiting, newest first. One whose change has already
// happened another way is left out.
export function openSuggestions(mineOnly) {
  return state.slack_suggestions
    .filter((s) => s.status === "open" && stillOpen(s) && (!mineOnly || forMe(s)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function apply(s) {
  // A task someone said they would do is theirs; otherwise it goes to whoever applies it.
  const back = await perform(s, { owner: byId("people", s.person_id) ? s.person_id : state.me.id, source: "Slack" });
  if (!back) { toast("That couldn't be applied."); return; }
  await update("slack_suggestions", s.id, { status: "applied" });
  toast(describe(s, true) + ".", ["Undo", async () => { await back(); update("slack_suggestions", s.id, { status: "open" }); }]);
}
function dismiss(s) {
  update("slack_suggestions", s.id, { status: "dismissed" });
  toast("Dismissed.", ["Undo", () => update("slack_suggestions", s.id, { status: "open" })]);
}

// One suggestion as a row: what it would do, who said it and where, and the two answers.
export function suggestionRow(s) {
  const w = workFor(s);
  const link = slackLink(s.link);
  const said = [s.author, s.channel && "in " + s.channel].filter(Boolean).join(" ");
  return h("li", { class: "arow srow" },
    h("div", { class: "arow__main" },
      h("div", { class: "arow__title" }, describe(s)),
      h("div", { class: "arow__sub" },
        w && h("a", { class: "wtag", href: `#work/${w.kind}:${w.id}` }, w.name),
        h("span", null, [said, ago(s.created_at)].filter(Boolean).join(" · ")),
        s.why && h("span", { class: "srow__why" }, s.why),
        link && h("a", { class: "link", href: link, target: "_blank", rel: "noopener noreferrer" }, "Open in Slack"))),
    h("button", { class: "btn", type: "button", onclick: () => apply(s) }, "Apply"),
    h("button", { class: "quiet", type: "button", "aria-label": "Dismiss: " + describe(s), onclick: () => dismiss(s) }, "Dismiss"));
}

// ---------- preview only: try the feed without Slack ----------
// Preview has no Slack and no reader. So the screens can be tried, a message
// typed here is matched to records by name, the way the Log's preview is.
function standIn(text) {
  const low = text.toLowerCase();
  const said = (name) => { const n = String(name || "").toLowerCase().trim(); return n.length >= 3 && low.includes(n); };
  const me = state.me;
  const stamp = { author: me.label || "Team", person_id: me.id || null, channel: "#preview", link: null, status: "open" };
  const deals = state.deals.filter((d) => isOpenDeal(d) && (said(d.organisation) || said(d.name)));
  let made = 0;
  for (const d of deals) {
    create("activity", { entity_type: "deal", entity_id: d.id, body: text.slice(0, 600), author: stamp.author, source: "slack", link: null, created_at: new Date().toISOString() });
    made += 1;
    if (/\b(signed|closed the deal)\b/.test(low) && d.stage !== "signed") {
      create("slack_suggestions", { ...stamp, type: "move_stage", target_type: "deal", target_id: d.id, stage: "signed", why: "Said to be signed", created_at: new Date().toISOString() });
      made += 1;
    }
  }
  for (const t of state.tasks.filter((t) => t.status !== "done" && said(t.title))) {
    create("slack_suggestions", { ...stamp, type: "complete_task", target_type: "task", target_id: t.id, why: "Named in the message", created_at: new Date().toISOString() });
    made += 1;
  }
  const todo = text.match(/\b(?:i will|i'll|need to|todo:?)\s+([^.!?\n]{4,120})/i);
  if (todo) {
    const d = deals[0];
    const title = todo[1].trim();
    create("slack_suggestions", { ...stamp, type: "add_task", target_type: d ? "deal" : "none", target_id: d ? d.id : null, title: title[0].toUpperCase() + title.slice(1), why: "Something still to do", created_at: new Date().toISOString() });
    made += 1;
  }
  return made;
}
export function simulateSlack() {
  const box = h("textarea", { class: "textarea", id: "slack-sim", rows: "4", placeholder: "Type a message as it might be posted in a channel. Name a deal or a task." });
  const close = openDialog({
    title: "Try a Slack message",
    body: h("div", { class: "block" }, box,
      h("div", { class: "muted small" }, "Preview only: names found in the message stand in for the reader. Nothing is sent to Slack.")),
    foot: [h("span"), h("button", { class: "btn btn--primary", type: "button", onclick: () => {
      const text = box.value.trim();
      if (!text) { box.focus(); return; }
      const made = standIn(text);
      close();
      toast(made ? "Read. See the deal's notes and “From Slack” on Home." : "Nothing in that message matched a deal or a task.");
    } }, "Post")],
  });
  box.focus();
}
