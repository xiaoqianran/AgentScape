# AgentScape application entrypoints

The existing Studio at `/` remains the production default until the dedicated homepage rollout is approved.

- `/home/` — AgentScape homepage, based on `apps/spline-home`. Navigation links to Studio and Observatory.
- `/` — World Studio (unchanged bootstrap and runtime).
- `/observatory/` — physics, navigation, rendering, and integration diagnostics.

All three HTML pages are built by the repository root Vite configuration. `apps/spline-home/vite.config.js` is retained for isolated UI development, not used by the combined build. App-specific hash routes on `/home/` remain local to that app. The root homepage cutover should be a separate deployment change after product copy, interactions, and links are reviewed.
