import * as THREE from 'three';
import { attach } from '../../sdk/typescript/src/core.js';

const scene = new THREE.Scene();
const door = new THREE.Group();
door.name = 'Door';
scene.add(door);

const world = attach(scene);
world.register(door, {
  id: 'door',
  type: 'anything',
  read: () => ({ angle: door.rotation.y }),
  actions: {
    open: () => { door.rotation.y = -Math.PI / 2; },
    close: () => { door.rotation.y = 0; }
  }
});

await world.invoke('door', 'open');
console.log(world.inspect('door'));
world.dispose();
