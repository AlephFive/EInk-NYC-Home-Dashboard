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

And one repository **variable** (Variables tab, not Secrets):

| Variable | Needed by | Value |
|---|---|---|
| `WORKER_URL` | the post-deploy smoke test | `https://<your-worker>.workers.dev` |

It is a variable rather than a secret because the hostname is public anyway,
and a failed smoke test is only readable if the URL it hit is visible. The
smoke test is skipped if it is unset, so the pipeline works before you set it.

`MTA_API_KEY` is **not** here. It is set once on the Worker with
`wrangler secret put MTA_API_KEY` and persists across deploys — CI never
resends it, so it never passes through GitHub.

## Setting up the Cloudflare deploy

1. **Create the API token.** Cloudflare dashboard → My Profile → API Tokens →
   Create Token → **Edit Cloudflare Workers** template. That template already
   carries the right permissions; do not hand-build a token unless you need to
   narrow it further.
2. **Find the account id** in the Cloudflare dashboard sidebar, or run
   `npx wrangler whoami`.
3. Add both as repository secrets, and the deployed URL as the `WORKER_URL`
   variable.
4. **Deploy once by hand first** — `npx wrangler deploy` from `trmnl-recipe/`,
   and `npx wrangler secret put MTA_API_KEY`. The secret is set on the Worker
   and persists across deploys; CI never sends it. Deploying by hand once also
   means the first CI deploy is updating something that already works rather
   than creating it blind.

What the pipeline does on every push and PR, before any deploy:

- **Typecheck** the Worker
- **Timezone guard** under `TZ=UTC` (see below)
- **Bundle dry run** — `wrangler deploy --dry-run`, which catches an import the
  Workers runtime has no polyfill for, or a JSON file that moved. Typechecking
  cannot see either.

And after a deploy to `main`, a **smoke test against the live URL**: health,
a two-card board across both feed families, station names resolving from the
bundled lookups, no card erroring, departure times reading as New York local,
the payload inside TRMNL's 5KB cap, and the station picker answering.

It deliberately does **not** assert a departure count. A feed can legitimately
be empty — service ends, a stop is peak-only — and empty is not an error here.

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
