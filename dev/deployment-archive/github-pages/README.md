# Retired GitHub Pages deployment

GitHub Pages was the production web deployment path for AgentScape until 2026-08-28. Production deployment is now owned by Vercel at `https://agentscape-virid.vercel.app/`; GitHub Actions remains CI/smoke-only.

## Archived production state

- Pages URL: `https://xiaoqianran.github.io/AgentScape/`
- Last successful Pages source commit: `b7a550de92afc0eabcaad89c39e5503b3fac8d98`
- Last successful Pages workflow run: `33165620800`
- Vite base used by Pages: `/AgentScape/`
- Original workflow: `deploy-pages.yml.disabled`
- Original Vite config: `vite.config.github-pages.js`
- Exact deployed Actions artifact metadata: `build-manifest.json`
- Binary deployment artifact: GitHub Release `github-pages-retired-2026-08-28`

## Restore procedure

1. Restore `vite.config.github-pages.js` as the active `vite.config.js`.
2. Move `deploy-pages.yml.disabled` back to `.github/workflows/deploy-pages.yml`.
3. Re-enable GitHub Pages with GitHub Actions as its build source.
4. Run `npm ci && npm run check` before deploying.

The archive is historical evidence only. Do not keep Vercel and GitHub Pages as competing production owners.
