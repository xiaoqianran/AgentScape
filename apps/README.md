# AgentScape application entrypoints

The Spline-style AgentScape homepage is the production root. Studio remains available as a separate application route.

- `/` — AgentScape homepage, based on `apps/spline-home`. Its navigation links to Studio and Observatory.
- `/studio/` — World Studio (unchanged bootstrap and runtime).
- `/home/` — compatibility route for the same homepage.
- `/observatory/` — physics, navigation, rendering, and integration diagnostics.

All pages are built by the repository root Vite configuration. `apps/spline-home/vite.config.js` is retained for isolated UI development, not used by the combined build. The root Vite route plugin serves the homepage at `/` and emits the Studio entry at `/studio/`. App-specific hash routes remain local to the homepage app.

The public `agentscape3d` npm package is the SDK/CLI/MCP distribution; it does not contain or serve these web application routes. The website is the root Vite multi-page build deployed as a static site.
