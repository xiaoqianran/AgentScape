import { expect, it } from 'vitest';
import { createWoodlandWorkshop } from '../../modules/world/content/woodlandWorkshop.js';
import { cabinCanvasHost } from '../helpers/cabinCanvasHost.js';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { disposeObject3D } from '../../modules/rendering/disposeObject3D.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';

it('connects the garden to both workshop work areas through production Recast', async () => {
  const environment = createWoodlandWorkshop();
  const navigation = createRecastNavigationSystem({ store:new ObjectStore(), environmentRoots:[environment.root] });
  try {
    for (const destination of [[-3,0,-4],[2.5,0,-2]]) {
      const path = await navigation.findPath([0,0,8], destination);
      expect(path.reachable).toBe(true);
      expect(path.path.length).toBeGreaterThanOrEqual(2);
    }
  } finally {
    navigation.dispose();
    environment.dispose();
    disposeObject3D(environment.root);
  }
}, 15000);

it('edits the notice board and the wooden sign in place and restores both', () => {
  const host = cabinCanvasHost();
  const environment = createWoodlandWorkshop({ editorHost:host.editorHost, document:host.document });
  try {
    const board = environment.interactions.find((item) => item.id === 'workshop:notice');
    const sign = environment.interactions.find((item) => item.id === 'workshop:sign');
    expect(board.label).toBe('告示板文字');
    expect(environment.storageKey).toBe('agentscape.woodland.text.v1');
    expect(environment.views.map((view) => view.label)).toEqual(['全景', '工坊', '庭院']);

    expect(board.activate()).toBe(true);
    host.editorHost.querySelector('#boardInput').value = '欢迎来到林间工坊';
    host.editorHost.querySelector('#boardOk').listeners.get('click')();
    expect(environment.snapshot().text.board).toBe('欢迎来到林间工坊');

    expect(sign.activate()).toBe(true);
    host.editorHost.querySelector('#signInput').value = '往里走';
    host.editorHost.querySelector('#signOk').listeners.get('click')();
    const saved = environment.snapshot();
    expect(saved.text).toEqual({ board:'欢迎来到林间工坊', sign:'往里走' });

    environment.setText({ board:'临时', sign:'临时' });
    expect(environment.restore(saved)).toBe(true);
    expect(environment.snapshot()).toEqual(saved);
    expect(environment.restore({ schemaVersion:2 })).toBe(false);

    // Editable text lives on the world surfaces themselves, not in a second page layer.
    expect(environment.root.getObjectByName('Notice board').material[4].map.isCanvasTexture).toBe(true);
    expect(environment.root.getObjectByName('Workshop sign').material[4].map.isCanvasTexture).toBe(true);
  } finally {
    environment.dispose();
    disposeObject3D(environment.root);
  }
});
