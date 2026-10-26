# trmnlp project

The plugin as TRMNL's own dev server expects it. `trmnlp push` uploads
`src/settings.yml` and the `.liquid` layouts; `.trmnlp.yml` is local only.

## Run the preview

Docker Desktop must be running.

```bash
cd trmnl-recipe/plugin
docker run --rm --pull always \
  --publish 4567:4567 \
  --volume "$(pwd):/plugin" \
  trmnl/trmnlp serve --bind 0.0.0.0
```

Then open <http://localhost:4567>. It fetches the live polling URL in
`src/settings.yml`, merges the test values from `.trmnlp.yml`, and renders all
four layouts with live reload.

**Set the hostname first** — from `trmnl-recipe/`:

```bash
npm run configure <your-worker>.workers.dev
```

## Other commands

| Command | What it does |
|---|---|
| `trmnlp lint` | Checks against TRMNL's best practices. Run before store submission. |
| `trmnlp build --png` | Pixel-accurate PNG renders, which is what the device actually shows |
| `trmnlp login` / `push` | Uploads the plugin, instead of pasting YAML into the web form |

Prefix each with the Docker invocation above, swapping `serve --bind 0.0.0.0`
for the command.

## What is here

| File | Purpose |
|---|---|
| `src/settings.yml` | Uploaded. Polling URL, refresh interval, the 27 form fields. |
| `src/full.liquid` | The board. Phase 1 renders debug text, deliberately. |
| `src/half_*.liquid`, `src/quadrant.liquid` | Placeholders — a dense departure list needs its own row budget at those sizes, which is a phase 2 decision. |
| `.trmnlp.yml` | Local only: test field values and the time zone. |

`../recipe/` holds the same content as paste-ready files, for configuring the
plugin through the web form instead.
