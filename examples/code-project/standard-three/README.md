# Standard Three.js / npm project

This is ordinary ESM for Vite and AgentScape. It uses `three`, `three-mesh-bvh`,
a shader `?raw` import and a lazy `import('./lazy.js')` action.

From the AgentScape repository:

```sh
npm run dev
# Open /examples/code-project/standard-three/
node dev/build-code-project.mjs examples/code-project/standard-three/main.js public/code-projects/standard-three.json standard_three
```

Import `public/code-projects/standard-three.json` into Studio. You can edit its
main module and generated chunks, run them via MCP, and save/restore the world.
The build resolves installed npm packages at build time; it does not run `npm install` in the browser.

Third-party dependencies are bundled, while `three` is shared with the Studio Runtime.
Assets requiring URLs should be stored in Code Project `resources` explicitly.
