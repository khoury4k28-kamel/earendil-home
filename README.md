# Earendil Home

The front end of Earendil Robotics' internal hub: People, Home, Teams, Deal Tracker and CRM.

This repository holds the page's code only. All data lives in a private database behind a team sign-in, and nothing internal is stored here.

- `index.html`, `css/`, `js/`: the hub. Plain HTML, CSS and JavaScript, no build step.
- `js/config.js`: the database address and its publishable key (both public by design).
- `supabase/schema.sql`: the database structure and access rules. It contains no data.

Font: Inter, SIL Open Font License.
