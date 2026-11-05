import { openScene } from '../../../application/scene/SceneFacade.js';
import { openScenePackage } from '../../../application/scene/ScenePackage.js';
export { parseSceneProject } from '../../../application/scene/SceneProject.js';
export { recipeSchema, assetPackageSchema } from '../../../modules/asset/model/AssetInputContracts.js';
export { stylePackSchema, officialStylePacks } from '../../../modules/rendering/style/StylePack.js';

export const AgentScape = {
  async open({ canvas, project, bundle, environment = 'monument-hall', autoStart = true }: {
    canvas?: string | HTMLElement; project?: unknown; bundle?: unknown; environment?: string; autoStart?: boolean;
  } = {}) {
    if (bundle && project) throw Object.assign(new Error('Use project or bundle'), { code: 'INVALID_OPTIONS' });
    const container = typeof canvas === 'string' ? globalThis.document?.querySelector<HTMLElement>(canvas) : canvas;
    if (canvas && !container) throw Object.assign(new Error('Canvas container not found'), { code: 'INVALID_CANVAS' });
    const definition = project || { schema: 'agentscape.scene-project', schemaVersion: 1, name: 'My world',
      environment: { type: 'builtin', id: environment }, objects: [] };
    const scene = bundle ? await openScenePackage(bundle, { container }) : await openScene({ project: definition, container });
    let frameId: number | undefined;
    if (container && autoStart) {
      const frame = (timestamp: number) => { scene.frame(timestamp); frameId = requestAnimationFrame(frame); };
      frameId = requestAnimationFrame(frame);
    }
    const close = scene.close.bind(scene);
    return { ...scene, close() { close(); if (frameId != null) cancelAnimationFrame(frameId); } };
  }
};
