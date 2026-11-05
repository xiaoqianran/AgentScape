# v2 development release

Version: 2.0.0-dev.1. Implementation phases are local work slices; GitHub PRs have not been created or merged automatically. The SDK is not published to npm.

## Release decision versus local engineering acceptance

`V2-PR-09` records local engineering and automated acceptance in [`planning/v2-pr09-acceptance.json`](../planning/v2-pr09-acceptance.json). Passing those local gates **does not authorize a public release**. The independent first-use record in [`docs/first-use-check.md`](first-use-check.md) must remain **not performed** until a non-developer actually completes it. Hosted GitHub Actions must be run against the exact candidate commit and reviewed, including retained artifacts; a local Playwright result is not hosted CI evidence.

Treat the release decision as blocked until both external gates are documented. The software-rendered browser performance baseline is diagnostic evidence only, not proof of performance on physical GPUs or mobile devices. Do not publish an npm package, release tag or hosted Playground as a side effect of engineering acceptance.

## Reproduce

Use Node 22.12+ and npm. Run npm ci, npm run architecture:validate, npm run check, npm run test:mcp, npm run test:browser and npm run storybook:build. Install Playwright Chromium first. Builds writing dist must run sequentially. Review npm audit before release.

Build the SDK with node dev/build-sdk.mjs, run npm pack in sdk/typescript and install the tarball in a fresh application. examples/recipes/table.json provides explicit colliders and a support surface. Admission and actual physical verification remain separate.

Real container tests require the Linux sandbox configured according to apps/mcp-server/PROGRAMMATIC-ASSETS.md and AGENTSCAPE_SANDBOX_INTEGRATION=1. They require no private model provider. Online generation/model-quality tests remain separate integrations.

## Required external evidence

- A person who did not develop the demo independently completes pickup, place, save and reopen; record elapsed time and problems. Agent automation cannot sign this requirement.
- Run CI on a clean hosted runner and review retained artifacts. Local success is not remote CI evidence.
- Confirm private security reporting, repository ownership and release permissions before publication. No package, tag or hosted site is published by this implementation task.
- Hardware GPU and mobile claims need measurements on those devices. Chromium software-rendering results cannot establish them.

## Versioning

Development builds use 2.0.0-dev.N; SDK and engine versions match. Breaking format/API changes require explicit migration/version decisions. Unsupported major schemas are rejected. Keep the original 24 MCP tools until external client migration and an announced deprecation period. Portable bundles, projects and runtime snapshots have distinct responsibilities.

Release notes must state supported environments, capability levels, migration limits, known failures and exact validation platform. Retain browser/performance reports. Local implementation completion does not waive external release gates.
