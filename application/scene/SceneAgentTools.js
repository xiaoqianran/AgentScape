import { AgentTools } from '../AgentTools.js';
import { SCENE_LEGACY_SKILLS } from './SceneSkillNames.js';

const sceneSkillNames = new Set(SCENE_LEGACY_SKILLS);

/**
 * Explicit Studio adapter for the legacy Scene skill surface.
 * All other tool calls retain AgentTools' registry, context and observability behavior.
 */
export class SceneAgentTools extends AgentTools {
  constructor(runtime, scene, options = {}) {
    super(runtime, options);
    if (typeof scene?.executeSkill !== 'function') throw new TypeError('SceneAgentTools requires a Scene facade');
    this.scene = scene;
  }

  call(name, args = {}, internalContext = {}) {
    if (sceneSkillNames.has(name)) return this.scene.executeSkill(name, args);
    return super.call(name, args, internalContext);
  }
}
