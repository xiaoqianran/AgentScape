export { attach } from './core.js';
export type {
  SemanticWorld, SemanticScene, SemanticObject3D, SemanticTarget,
  SemanticAction, SemanticActionFn, SemanticActionContext, SemanticDefinition,
  SemanticEntity, SemanticEvent, SemanticPlugin
} from './core.js';
export declare const AgentScape: {
  readonly attach: typeof import('./core.js').attach;
  readonly extend: typeof import('./core.js').attach;
};
