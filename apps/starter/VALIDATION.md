# Starter validation — 2026-11-20

Validation performed locally on Windows, using the repository's Rapier/Recast runtime and Playwright Chromium. These are automated checks, not an external-user usability study.

- `AGENTSCAPE_SANDBOX_INTEGRATION=1 npm run check` (PowerShell environment assignment): architecture, planning, assets, world viability, typecheck, test suite and production build. This historical full-check run predates the current example expansion and must be rerun before release.
- `npm run test:starter`: real pickup and settled placement, physical registration, add/move, JSON serialization and fresh-runtime restore; invalid project, import and concurrent edit rejection; held-object edit rejection; lifecycle checks. The initial scene now has four objects and the integration flow restores five after adding one.
- `npm run test:browser:starter`: production browser flow exercises guided pickup/place, adds a selected asset, moves it, downloads, reloads and imports. It checks the restored object count and that malformed import leaves the current world intact. The responsive canvas flow restores the four-object default world.
- Observatory scenario `interaction.place.seat` places an object on the chair's seat surface and verifies support geometry, physics position and interaction events.
- `git diff --check`: run as part of the current change verification.

The captured view at [starter-first-world.png](../../docs/evidence/starter-first-world.png) is a browser screenshot, not a rendering mockup. Browser artifacts remain in ignored `test-results/` and `playwright-report/` directories.

The build has previously reported large chunks and browser externalization warnings from existing dependencies. Startup cost has not been certified on low-end/mobile hardware. No hosted Playground, third-party user trial, npm SDK publication, universal browser support, arbitrary GLB import or StylePack compatibility is claimed.

This milestone is the local onboarding loop. The general Scene/Asset/Style contracts, unified MCP/Studio use of the full API, portable asset packages and public sharing remain separate follow-up work.
