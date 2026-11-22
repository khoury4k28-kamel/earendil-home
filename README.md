# Earendil Home

The front end of Earendil Robotics' internal hub: Home, Deals & Tasks, Teams (with everyone on the team), CRM, Deal Tracker and Documents.

This repository holds the page's code only. All data lives in a private database behind a team sign-in, and nothing internal is stored here.

- `index.html`, `css/`, `js/`: the hub. Plain HTML, CSS and JavaScript, no build step.
- `js/config.js`: the database address and its publishable key (both public by design).
- `supabase/schema.sql`: the database structure and access rules. It contains no data.

Font: Hanken Grotesk, SIL Open Font License.

## The map

`js/geo.js` is generated: country outlines, a point for each country, and where each time zone sits. To rebuild it:

```
npm pack world-atlas@2.0.2        # then unpack it
node tools/build-geo.mjs <path>/countries-110m.json /usr/share/zoneinfo/zone.tab js/geo.js
```

The outlines are Natural Earth (public domain) as packaged by world-atlas (ISC, `js/geo.LICENSE.txt`). The time zone table is IANA's `zone.tab` (public domain).

A person's place on the Teams page and the map comes from the time zone their device reports when they open the hub. No GPS is read and no outside service is called.
