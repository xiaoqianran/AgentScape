# AgentScape 3D Core

**agentscape3d** is a small, unrestricted semantic and action extension for host-owned Three.js scenes. It does not require Studio, a renderer, WorldRuntime, MCP, an AI provider, an approval workflow, a sandbox or a physics engine.

~~~js
import * as THREE from 'three';
import { attach } from 'agentscape3d';

const scene = new THREE.Scene();
const door = new THREE.Group();
scene.add(door);
const world = attach(scene);
world.register(door, {
  id: 'door', type: 'custom-door',
  read: () => ({ angle: door.rotation.y }),
  actions: { open: () => { door.rotation.y = -Math.PI / 2; } }
});
await world.invoke('door', 'open');
world.dispose(); // Does not dispose the scene or door
~~~

The same API works on objects imported through GLTFLoader or created in JavaScript. Use world.use(plugin) for optional extensions; there are no automatically installed plugins.

Optional npm packages:
- **agentscape3d-engine**: legacy full WorldRuntime, physics, assets and the explicit MCP integration
- **agentscape3d-studio**: standalone Studio and static website

See docs/sdk-packages.md and docs/semantic-core.md in the repository.

This is a breaking npm-entry migration, not a published release. Code executes with the permissions of the host JavaScript environment; Core does not impose or claim a security boundary.
