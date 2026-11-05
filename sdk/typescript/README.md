# AgentScape TypeScript SDK

Development version; not published to npm. Build from the repository with `node dev/build-sdk.mjs`, then run `npm pack` inside this directory and install the resulting tarball in your application.

```js
import { AgentScape } from '@agentscape/sdk';
const world = await AgentScape.open({ canvas: '#app' });
await world.addModel({ id: 'cup', asset: 'builtin://cup', position: [0, 0, 2] });
const saved = await world.save();
const reopened = await AgentScape.open({ bundle: saved.value });
reopened.close();
world.close();
```

`#app` is an HTML container with an explicit width and height. Rendering schedules automatically when a container is supplied. Headless hosts advance `step()` themselves. Interactions return jobs; query or await them with `getJob` / `waitJob`, and inspect their verification evidence separately.

The current built-in environment is `monument-hall`; assets include agent, cup, table and chair. Use await world.setStyle(ref) with builtin://realistic, builtin://toon or builtin://low-poly. Headless hosts validate and defer rendering. This SDK shares the application Scene service and does not maintain another object store.

`agentscape starter new-directory` scaffolds an empty destination. Install this SDK tarball and Vite in that directory, then `npm run dev`. No provider key or paid service is needed for built-in worlds. Python Connector SDK usage is unchanged.
