# Contributing to AgentScape

Start with the [first world](apps/starter/README.md). English and Simplified Chinese issues and pull requests are welcome. Examples, clear reproductions, documentation and accessibility improvements are contributions, too.

## Run locally

Use Node.js 22.12+ (CI uses Node 22).

```sh
npm ci
npm run starter
```

Use `npm run dev` for Studio and `/observatory/` for diagnostics. The starter requires no private credentials, external provider, Python environment or Docker. Optional integrations have their own setup instructions.

## Choose a small change

For your first contribution, consider clarifying a confusing starter instruction, adding a reproducible scene fixture, improving keyboard/mobile usability, or documenting an observed compatibility issue. Describe the expected result and how you tested it.

For changes to public APIs, package formats or runtime ownership, open a GitHub issue with the user problem, a minimal example and the compatibility impact before building a new abstraction. The [three public contracts](planning/public-contracts-v1.md) are still a draft. Do not label proposed features as available.

## Send a pull request

1. Fork the repository and create a focused branch.
2. Make your change without unrelated refactors or generated artifacts.
3. Run targeted tests, then the required checks below for runtime changes.
4. Explain the problem, observable behavior, validation and any limitations in the PR.

Use conventional commit prefixes such as `feat(scene): ...`, `fix(starter): ...`, `docs: ...`. English and Simplified Chinese descriptions are accepted. Keep functions focused and follow the surrounding module conventions.

```sh
npm run test:starter
npm run check
git diff --check
```

For UI changes, also run `npx playwright install chromium` and `npm run test:browser:starter` (or the relevant browser suite). Linux may need `npx playwright install --with-deps chromium`. Browser tests build the production app and run it on port 4178.

Documentation-only changes need relevant link/example review and `git diff --check`; architecture/task changes also need `npm run architecture:validate`. Do not add tests that only repeat trivial implementation details.

MCP's real container security tests require the configured Linux Docker sandbox and `AGENTSCAPE_SANDBOX_INTEGRATION=1`; otherwise those specific tests are skipped. Never remove the sandbox or substitute host execution to make a test pass. See [MCP setup](apps/mcp-server/PROGRAMMATIC-ASSETS.md). The separate cross-repository provider test is not required to run the starter.

## Boundaries and compatibility

- Apps compose application and domain modules. Modules do not import apps.
- Reuse WorldRuntime, AssetModule, skills and SceneSerializer; do not duplicate world state.
- Keep rendering style separate from physics, navigation and interaction evidence.
- Stable existing formats retain their meaning. Experimental APIs may evolve, with changes documented in their guide.
- Do not commit user saves, generated assets, secrets or local service data.

## Report a problem

Use the bug template and attach a minimal starter project/save where possible. Include the commit, Node/browser/OS version, exact steps and the actual error. Remove tokens, private models and personal data before sharing. A reproducible issue is more useful than a large log dump.

Treat contributors respectfully: critique the change, explain the reasoning, and avoid personal attacks or harassment. Maintainers may close abusive or unrelated discussions. No response-time SLA is promised; small, reproducible reports are easiest to review.

## Assets and attribution

Only submit content you have permission to distribute. Provide the source, license and attribution for models, textures and fonts. The repository's MIT code license does not automatically cover third-party assets. See [THIRD_PARTY.md](THIRD_PARTY.md).
