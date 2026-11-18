// Connection settings for Earendil Home.
//
// supabaseUrl and supabaseKey are the project's URL and its PUBLISHABLE key
// (starts with "sb_publishable_"). Both are made to be public: the database's
// row-level rules decide who can read or write. Never put a secret key here.
export const config = {
  supabaseUrl: "",
  supabaseKey: "",

  // Local preview only. When the page is opened on localhost and no project is
  // set above (or the address ends in ?preview), the hub reads this private
  // seed file instead of the database. Changes made in preview are not saved.
  previewSeed: "../vault/_admin/seed.json",

  // Supabase client library, pinned to an exact version.
  supabaseLib: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js",
};
