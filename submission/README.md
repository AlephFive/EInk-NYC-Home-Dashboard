# TRMNL store submission

Drafts for submitting **NYC Transit Board** to the TRMNL plugin store.
Everything here is copy to send or read from — nothing in this folder is
built or deployed.

| File | What it is |
| --- | --- |
| `submission-email.md` | The email to `team@trmnl.com`, ready to paste |
| `store-listing.md` | Name, tagline, description and the form copy |
| `video-script.md` | Shot list for the installation recording |
| `blockers.md` | What must be true before any of this is sent |

## Facts the other files reuse

| | |
| --- | --- |
| Plugin id | `524413` |
| Edit URL | https://trmnl.com/plugin_settings/524413/edit |
| Owner email | spo2.spire.club@gmail.com |
| Worker | `https://trmnl-nyc-transit.spo2-spire-club.workers.dev` |
| Polling | `POST /api/board`, `content-type=application/json` |
| Refresh | 900s local; **the web UI is still 1440** — see `blockers.md` |
| Setup guide | https://brian.ma/nyc-transit-board/ |
| Source | https://github.com/AlephFive/nyc-transit-board |
| Tests | 353 passing (`npm test` in `trmnl-recipe/`) |

## Order of work

1. Clear everything in `blockers.md`. Two items are correctness problems
   a reviewer will hit, not polish.
2. Record the video against `video-script.md`.
3. Paste `store-listing.md` into the plugin's own fields and push.
4. Send `submission-email.md`.
