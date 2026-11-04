# Clear these before sending

Ordered by what a reviewer would actually hit.

## 1. The three mashup layouts have never run on hardware

`half_horizontal`, `half_vertical` and `quadrant` exist and are covered by
`tests/layouts.test.ts`, but have only ever been through `trmnlp build`.
Only `full` has been seen on a real panel.

A store reviewer puts a plugin in a mashup. If one of these breaks, that is
the first thing they see. Test each on the device before sending.

Local render is **not** sufficient evidence here — the local preview has
already disagreed with the device once in this project.

## 2. `refresh_interval` is 900 locally and 1440 on the server

`plugin/src/settings.yml:166` says 900. The push round trip rewrites it to
1440, so the deployed plugin has been wrong for some time.

Fix it **in the web UI**, not by pushing: the push is what breaks it.
https://trmnl.com/plugin_settings/524413/edit

## 3. Rotate the TRMNL API key

It was pasted into a chat transcript repeatedly during development. Anyone
holding it can modify the plugin. Rotate before the listing is public.

## 4. `recipe/polling-url.txt` documents a design that was replaced

It describes the GET query-string protocol, `cardN_type` and `depends_on`.
The plugin now POSTs JSON (`settings.yml:70-72`), there is no type field,
and the picker searches all networks at once.

Not reviewer-facing, but it is the most detailed protocol doc in the repo
and it is wrong. Either retitle it as history or delete it.

## Known-open, and fine to ship

These are documented in `docs/NEXT-SESSION.md` and are judgement calls
rather than defects. Listed so nobody treats them as surprises.

- **A squashed last row on some cards.** Three attempts, none of which
  changed the render. Cosmetic.
- **SI bullet centring.** Only on a Staten Island Railway card.
- **Direction 1 empty at a terminal.** Correct behaviour: nothing departs
  Grand Central *towards* the city. The guide tells users to leave
  Direction blank there.
