# CI

Three pipelines, because this repo has **three independent deploy targets**:

| Workflow | Covers | Deploys to |
|---|---|---|
| `worker.yml` | `trmnl-recipe/src/` — the API | **Cloudflare**, via `wrangler deploy` |
| `plugin.yml` | `trmnl-recipe/plugin/` — form, Liquid, polling URL | **TRMNL**, via `trmnlp push` |
| `dashboard.yml` | `EInk-NYC-Home-Dashboard/` — the React panel | nothing; it is screenshotted locally |

Each is path-filtered, so editing a Liquid template does not redeploy the
Worker and changing the row logic does not push the plugin.

One cross-dependency is wired deliberately: the Worker imports the dashboard's
transit modules directly, so `worker.yml` also watches
`EInk-NYC-Home-Dashboard/src/utils/` and `src/staticData/`. A change there can
break the Worker without touching `trmnl-recipe/` at all.

## Secrets to add

Repository Settings → Secrets and variables → Actions.

| Secret | Needed by | Where it comes from |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `worker.yml` deploy | Cloudflare dashboard → My Profile → API Tokens → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | `worker.yml` deploy | Cloudflare dashboard sidebar, or `wrangler whoami` |
| `TRMNL_API_KEY` | `plugin.yml` push | TRMNL account settings |

`MTA_API_KEY` is **not** here. It is set once on the Worker with
`wrangler secret put MTA_API_KEY` and persists across deploys — CI never
resends it, so it never passes through GitHub.

## Both deploy jobs are off until you deploy by hand once

- **`worker.yml` deploy** runs only on `main`, so it is inert while this work
  lives on a branch.
- **`plugin.yml` push** is gated behind `if: false`, and must stay that way
  until `src/settings.yml` carries the plugin's `id`. Without an id,
  `trmnlp push` creates a **new** plugin on every run instead of updating the
  one you have.

To enable the plugin push: create the plugin once, copy its id into
`src/settings.yml`, add `TRMNL_API_KEY`, then delete the `if: false`.

## The timezone guard

`worker.yml` runs `.github/scripts/checkTimeZone.mjs` under `TZ=UTC`.

A deployed Worker runs in UTC, and `formatClockTime` once omitted `timeZone` —
so every departure rendered four or five hours out. It was invisible locally
because `wrangler dev` inherits the developer's own zone; it would only have
surfaced on the device.

The guard reads the source and fails if the formatter stops passing a zone.
Verified to fail on the real regression, not just to pass on good code.
