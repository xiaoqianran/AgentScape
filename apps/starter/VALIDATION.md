# Starter validation — 2026-11-05

Validation performed locally on Windows, using the repository's real Rapier/Recast runtime and Playwright Chromium. These are automated checks, not an external-user usability study.

- `AGENTSCAPE_SANDBOX_INTEGRATION=1 npm run check` (PowerShell environment assignment): architecture, planning, assets, world viability, typecheck, **318 test files / 1600 tests**, production build passed. Existing real MCP sandbox tests were enabled.
- `npm run test:starter`: **2 tests passed**. Actual pickup and settled placement, real physics registration, add/move, JSON serialization and fresh-runtime restore; invalid project, import and concurrent edit rejection; held-object edit rejection; lifecycle checks.
- `npm run test:browser:starter`: production browser flow exercises pickup/place, chair add/move, download, page reload and import. Four objects restore. A malformed import leaves the displayed object count intact. No page script errors captured.
- `git diff --check`: passed.

The [captured view](../../docs/evidence/starter-first-world.png) shows the scene after restore; it is an actual browser screenshot, not a rendering mockup. Browser artifacts remain in ignored `test-results/` and `playwright-report/` directories.

The build still reports large chunks and browser externalization warnings from existing dependencies. Startup cost has not been certified on low-end/mobile hardware. No hosted Playground, third-party user trial, npm SDK publication, universal browser support, arbitrary GLB import or StylePack compatibility is claimed.

This milestone is the local onboarding loop. The general Scene/Asset/Style contracts, unified MCP/Studio use of the full API, portable asset packages and public sharing remain separate follow-up work.
