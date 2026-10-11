# CNB / GitHub synchronization

## Current architecture

- CNB1 (`xiaoqianran/AgentScape`) and CNB2 (`chutianqiuer/AgentScape`) run the `main.push` CNB pipeline.
- If GitHub is already at the CNB branch tip, the CNB pipeline does nothing. Otherwise it can request the `cnb-main-updated` GitHub `repository_dispatch` event.
- GitHub Actions `.github/workflows/cnb-to-github.yml` reconciles GitHub, CNB1 and CNB2 using **fast-forward only** and then pushes the selected commit to CNB1, CNB2, GitCode.
- A scheduled fallback checks at minutes 7, 22, 37, 52 of each hour (UTC); scheduled Actions are best-effort and can be delayed.
- Manual trigger: `gh workflow run cnb-to-github.yml --repo xiaoqianran/AgentScape --ref main`.

## Activate near-real-time dispatch (not active until configured)

1. Create a GitHub fine-grained PAT scoped only to `xiaoqianran/AgentScape`, with repository **Contents: Read** and **Contents: Write** permission (GitHub repository_dispatch requires Contents: Write). Keep its expiry short and rotate periodically.
2. Store the PAT in a **private CNB secret repository**, for example in `github-dispatch.yml` as `CNB_GITHUB_DISPATCH_TOKEN: <token>`. Limit read permissions to the intended CNB CI identities. Never commit this file to AgentScape or print the token in CI logs.
3. Add an `imports:` entry to the `main.push` job in `.cnb.yml`, at the same indentation as `stages:`, pointing to that private secret file (see CNB documentation on imported environment variables). This must be set up on BOTH CNB copies, or with a shared private secret file that both CI identities can read.
4. Push to CNB1 (not GitHub) and verify CNB's `notify-github-reconcile` stage, GitHub Actions `Reconcile CNB to GitHub` with event `repository_dispatch`, and the four remote `main` SHAs.

The CNB job intentionally skips dispatch when no token is injected, so ordinary pushes are not broken during setup. That also means near-real-time synchronization **is not enabled merely by merging this change**. If CNB1 and CNB2 develop divergent histories, GitHub reconciliation stops without force-pushing; resolve divergence explicitly.

GitHub does not normally re-trigger the GitHub `push` mirror workflow from pushes performed using its built-in `GITHUB_TOKEN`. CNB may run its own push pipeline on mirrored commits, but the SHA equality check avoids dispatching again when GitHub is already up-to-date.

References: https://docs.cnb.cool/zh/build/env.html ; https://docs.cnb.cool/zh/build/trigger-rule.html ; https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event
