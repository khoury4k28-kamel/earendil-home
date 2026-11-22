// What each kind of record is made of: the lists of stages and categories, and
// the fields its edit form shows.

import { state, sortByName } from "./store.js";
import { countryList } from "./places.js";

export const STAGES = [
  { value: "lead", label: "Lead" },
  { value: "conversation", label: "In conversation" },
  { value: "negotiating", label: "Negotiating" },
  { value: "signed", label: "Signed" },
  { value: "closed", label: "Closed" },
];
export const stageLabel = (v) => STAGES.find((s) => s.value === v)?.label || "Lead";

export const DEAL_KINDS = ["customer", "partnership", "joint venture", "investment"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));

export const CATEGORIES = [
  { value: "client", label: "Client", many: "Clients" },
  { value: "investor", label: "Investor", many: "Investors" },
  { value: "partner", label: "Partner", many: "Partners" },
  { value: "contractor", label: "Contractor", many: "Contractors" },
  { value: "prospect", label: "Prospect", many: "Prospects" },
  { value: "introducer", label: "Introducer", many: "Introducers" },
];
export const categoryLabel = (v) => CATEGORIES.find((c) => c.value === v)?.label || "";

export const CONTACT_STATUS = ["In contact", "Target", "To confirm"].map((v) => ({ value: v, label: v }));
export const PROJECT_STATUS = [{ value: "active", label: "Active" }, { value: "paused", label: "On hold" }, { value: "done", label: "Done" }];
export const projectStatusLabel = (v) => PROJECT_STATUS.find((s) => s.value === v)?.label || "Active";
export const TASK_STATUS = [{ value: "todo", label: "To do" }, { value: "doing", label: "In progress" }, { value: "done", label: "Done" }];
export const SOURCES = ["Slack", "Email", "Granola"];

export const NOUN = { people: "person", teams: "team", goals: "target", milestones: "milestone", tasks: "task", projects: "project", deals: "deal", contacts: "contact" };

const people = () => sortByName(state.people).map((p) => ({ value: p.id, label: p.name }));
const teams = () => sortByName(state.teams).map((t) => ({ value: t.id, label: t.name }));
const deals = () => sortByName(state.deals).map((d) => ({ value: d.id, label: d.name }));
const projects = () => sortByName(state.projects).map((p) => ({ value: p.id, label: p.name }));
const contacts = () => sortByName(state.contacts).map((c) => ({ value: c.id, label: c.organisation && c.organisation !== c.name ? `${c.name} (${c.organisation})` : c.name }));

export function fieldsFor(table, record = {}) {
  switch (table) {
    case "people": return [
      { key: "name", label: "Name", required: true },
      { key: "title", label: "Role" },
      { key: "team_id", label: "Team", type: "select", options: teams(), blank: "No team yet" },
      { key: "reports_to", label: "Reports to", type: "select", options: people().filter((p) => p.value !== record.id), blank: "Nobody set" },
      { key: "responsibilities", label: "What they do", type: "textarea", placeholder: "Their responsibilities, in a few lines" },
      { key: "focus", label: "Working on now", type: "textarea", placeholder: "What they're focused on this week" },
      { key: "email", label: "Email", type: "email", hint: "Use their sign-in email so the hub greets them by name." },
      { key: "location", label: "Based in" },
      { key: "note", label: "Note", wide: true },
    ];
    case "teams": return [
      { key: "name", label: "Team name", required: true },
      { key: "lead_id", label: "Lead", type: "select", options: people(), blank: "No lead yet" },
      { key: "strategy", label: "Strategy", type: "textarea", placeholder: "What this team is trying to achieve, and how" },
    ];
    case "goals": return [
      { key: "title", label: "Target", required: true, wide: true },
      { key: "team_id", label: "Belongs to", type: "select", options: teams(), blank: "Whole company" },
      { key: "due", label: "Due", type: "date" },
      { key: "current", label: "Where it stands", type: "number" },
      { key: "target", label: "Target number", type: "number" },
      { key: "unit", label: "Unit", placeholder: "deals, $, units…" },
      { key: "note", label: "Note" },
    ];
    case "milestones": return [
      { key: "title", label: "Milestone", required: true, wide: true },
      { key: "date", label: "Date", type: "date" },
      { key: "date_label", label: "Shown as", placeholder: "e.g. Early Jan 2027", hint: "Leave empty to show the date." },
      { key: "status", label: "Status", type: "select", required: true, options: [{ value: "upcoming", label: "Upcoming" }, { value: "done", label: "Done" }] },
      { key: "kind", label: "Kind", type: "select", required: true, options: [{ value: "company", label: "Ours" }, { value: "external", label: "Outside event we track" }] },
      { key: "team_id", label: "Belongs to", type: "select", options: teams(), blank: "Whole company" },
    ];
    case "tasks": return [
      { key: "title", label: "Task", required: true, wide: true },
      { key: "owner_id", label: "Owner", type: "select", options: people(), blank: "Nobody yet" },
      { key: "status", label: "Status", type: "select", required: true, options: TASK_STATUS },
      { key: "due", label: "Due", type: "date" },
      { key: "belongs", label: "Belongs to", type: "select", blank: "Nothing (a quick to-do)", groups: [
        { label: "Deals", options: deals().map((o) => ({ value: "deal:" + o.value, label: o.label })) },
        { label: "Projects", options: projects().map((o) => ({ value: "project:" + o.value, label: o.label })) },
      ] },
      { key: "team_id", label: "Team", type: "select", options: teams(), blank: "No team" },
      { key: "company_wide", type: "checkbox", label: "Company-wide", checkLabel: "Show on Home as a company-wide to-do" },
    ];
    case "projects": return [
      { key: "name", label: "Project", required: true, wide: true },
      { key: "owner_id", label: "Owner", type: "select", options: people(), blank: "Nobody yet" },
      { key: "status", label: "Status", type: "select", required: true, options: PROJECT_STATUS },
      { key: "due", label: "Due", type: "date" },
      { key: "deal_id", label: "Under a deal", type: "select", options: deals(), blank: "No deal" },
      { key: "people_ids", label: "Who's on it", type: "multi", options: people(), none: "Add people on the Teams tab first." },
      { key: "summary", label: "What it's for", type: "textarea" },
    ];
    case "deals": return [
      { key: "name", label: "Deal name", required: true },
      { key: "organisation", label: "With" },
      { key: "kind", label: "Type", type: "select", required: true, options: DEAL_KINDS },
      { key: "region", label: "Region" },
      { key: "stage", label: "Stage", type: "select", required: true, options: STAGES },
      { key: "owner_id", label: "Owner", type: "select", options: people(), blank: "Nobody yet" },
      { key: "size_low", label: "Size, low (US$)", type: "number", placeholder: "30000000" },
      { key: "size_high", label: "Size, high (US$)", type: "number", placeholder: "100000000" },
      { key: "size_note", label: "About the size", wide: true, placeholder: "Estimate or firm? Where the figure comes from" },
      { key: "people_ids", label: "Who's involved (team)", type: "multi", options: people(), none: "Add people first." },
      { key: "contact_ids", label: "Who's involved (outside)", type: "multi", options: contacts(), none: "Add contacts in the CRM first." },
      { key: "last_touch", label: "Last contact", type: "date" },
      { key: "summary", label: "Summary", type: "textarea" },
      { key: "to_confirm", label: "To confirm", wide: true, placeholder: "Anything on this card that still needs checking" },
    ];
    case "contacts": return [
      { key: "name", label: "Name", required: true },
      { key: "kind", label: "This is", type: "select", required: true, options: [{ value: "person", label: "A person" }, { value: "organisation", label: "An organization" }] },
      { key: "organisation", label: "Organization" },
      { key: "title", label: "Role" },
      { key: "category", label: "Category", type: "select", required: true, options: CATEGORIES },
      { key: "status", label: "Status", type: "select", required: true, options: CONTACT_STATUS },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone", type: "tel" },
      { key: "country", label: "Country", list: countryList },
      { key: "owner_id", label: "Who knows them", type: "select", options: people(), blank: "Nobody set" },
      { key: "last_touch", label: "Last contact", type: "date" },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
    default: return [];
  }
}
