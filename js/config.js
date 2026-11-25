// Connection settings for Earendil Home.
//
// supabaseUrl and supabaseKey are the project's URL and its PUBLISHABLE key
// (starts with "sb_publishable_"). Both are made to be public: the database's
// row-level rules decide who can read or write. Never put a secret key here.
export const config = {
  supabaseUrl: "https://wycqeywhtcfvexoogsei.supabase.co",
  supabaseKey: "sb_publishable_wgh6Fn-dXYNhXKlZPa36QA_2nPHrhwU",

  // The Log's reader is an Edge Function. Supabase's editor gives each function
  // an address of its own choosing, which can differ from the name shown in
  // its list: this is the last part of that address (its URL in the list).
  readLogFunction: "swift-task",

  // Sign-in is for the team's own addresses only.
  emailDomain: "earendilrobotics.com",

  // The live hub signs people in with their Microsoft work account. Supabase
  // holds the Microsoft app's details; nothing about it is stored here.

  // Local preview only: the team password, as a salted hash in a private file
  // that never leaves this Mac. Set it with vault/_admin/set-team-password.py.
  previewLogin: "../vault/_admin/login.json",

  // Local preview only. When the page is opened on localhost and no project is
  // set above (or the address ends in ?preview), the hub reads this private
  // seed file instead of the database. Changes made in preview are not saved.
  previewSeed: "../vault/_admin/seed.json",
  // The same, for the Documents tab and the news radar: private files in the vault.
  previewDocuments: "../vault/Documents/index.json",
  previewRadar: "../vault/Radar/radar.json",

  // Supabase client library, version 2.118.0, taken from the official npm
  // package and served from this site, so no outside server is trusted for code.
  supabaseLib: "js/vendor/supabase-2.118.0.js",
};
