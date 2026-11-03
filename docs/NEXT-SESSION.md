# Where this is, and what submission still needs

The recipe is live on TRMNL as plugin **524413** and rendering a real
six-card board on hardware. What follows is the state as of 2026-11-03,
then the gaps between here and a store submission.

## State

| | |
|---|---|
| Worker | deployed, CI green on push to `main` |
| Plugin | pushed; `id: 524413` in `plugin/src/settings.yml` |
| Polling | `POST` with a JSON body — see below |
| Tests | 352 |
| Device | rendering correctly; every transit type verified live |

## The polling format, and why it changed

The board was a `GET` with the whole thing packed into the query string,
and that format caused more defects than anything else in this project: a
card headed "Bus Stop 6" built from a stop that does not exist, a heading
reading ":5:", "· Subway" smuggled through an `@name` suffix, a route
filter silently ignored for sitting past a tail, a badge reading "ACE:5:",
and a fully configured board falling back to the demo because TRMNL stores
a picker value as `id::label` and the parser split on the first colon.

Every one was the Worker inferring which field it was reading from where a
separator fell, in a value that can contain every separator.

It is a `POST` with a JSON body now. The station arrives already split —
`{"type": "subway", "ids": ["127", "725"]}` — built in Liquid from the
readable value TRMNL stores, so the form still shows a human-readable
string and the Worker reads named fields. Values are escaped with
`| json`.

**`| json` exists and works.** An earlier pass concluded it did not,
having probed it inside an HTML attribute where the quotes were mangled
and read the empty result as a missing filter. Tested properly it quotes,
escapes and handles empty strings.

The query-string parser is still there, for a board rendered by a polling
template that has not been re-saved.

## Pushing the plugin, carefully

`trmnlp push` **rewrites the local file**: it flattens the indentation,
mangles placeholders ("1,2,3" became "123"), drops `polling_body` and
`polling_headers`, and has dropped `custom_fields` entirely.

The discipline that works:

1. **Commit before pushing.** Twice now the rewritten file has been
   committed instead of the real one, and the second time it blanked the
   board — `polling_verb: post` with an empty body means TRMNL posts
   nothing and the Worker returns the demo.
2. **After pushing, `git checkout --` the file.** Treat the post-push
   working tree as damage to discard, never as something to `git add`.

Also note `trmnlp pull` never returns `polling_body` — it comes back as an
empty key every time. It cannot be used to verify what was uploaded, and
reading it as "the body was dropped" has sent this project down two blind
alleys.

## Before submitting

1. **Test the three mashup layouts on the device.** Only `full` has been
   seen on real hardware. `half_horizontal`, `half_vertical` and
   `quadrant` have never left `trmnlp build`.
2. **Set `refresh_interval` to 900 in the web UI.** The push round trip
   rewrites it to 1440, so the server has been wrong for some time.
3. **Rotate the TRMNL API key.** It was pasted into a chat transcript
   repeatedly during development.
4. **Record the installation video.** Submission wants it from scratch:
   install, pick six stations, see the board.
5. **Email `team@trmnl.com`** with the plugin id, owner email, rationale,
   the video, and test credentials.

## Open, and deliberately not fixed

- **A squashed last row on some cards.** Three attempts, each on an
  unverified hypothesis, none of which changed the render: a whole-row
  height budget, clipping the limiter's box, overriding the framework's
  `word-break: break-word`. What is known: the Content Limiter measures in
  the browser, `.content` carries `max-height: 100%` and `word-break:
  break-word`, and every card receives the same
  `data-content-max-height`. The next attempt should start from the
  rendered page, not the CSS.
- **SI bullet centring.** `.bullet--pair` compensates its `letter-spacing`
  with `text-indent`, which indents the line box rather than the inline
  content and may be doing nothing. Only appears on a Staten Island
  Railway card. `padding-left` would be the honest lever.
- **Direction 1 is always empty at a terminal.** Correct rather than
  broken — `isCityBound()` asks whether a trip *ends* at a city terminal,
  and nothing departs Grand Central towards the city. Whether a terminal
  should fall back to showing both is a product call, not a bug.

## Gotchas worth not rediscovering

- **A deployed Worker runs in UTC.** `wrangler dev` inherits the
  developer's zone, so a timezone bug is invisible locally. CI guards this
  under `TZ=UTC`.
- **The local preview renders the demo board, not your panel.** TRMNL has
  no API to read a user's stored settings back, so the preview cannot
  discover what a device is configured to show. It renders `DEMO_CARDS`,
  generated into `.trmnlp.yml` by `npm run preview:sync`.

  The consequence worth remembering: **the preview cannot show a bug in a
  stored value**, because every value in it was written correctly by the
  generator. That is how "Bus:6:" reached the device while every local
  screenshot stayed clean.
- **Every 800x480 device has `--device-ui-scale: 1`.** The multiplier that
  varies is `--modifier-scale`, a per-plugin *user* setting
  (`screen--scale-small` … `xxlarge`). An earlier note here claimed the
  device raised `--device-ui-scale`; reading the framework disproved it.
- **Type must never be sized in pixels.** The framework multiplies every
  size by the user's scale, so a literal does not scale with the board. A
  test enforces this.
- **`trmnlp` does not stamp a device class on `.screen`.** Each layout
  pins the `ogv2` profile itself, checked against the live stylesheet by
  `layouts.test.ts`.
