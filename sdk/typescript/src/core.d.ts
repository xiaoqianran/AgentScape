/**
 * Framework-independent Three.js semantics. The scene and Object3D remain
 * owned and rendered by the host application.
 */
export interface SemanticObject3D {
  readonly isObject3D: boolean;
  readonly uuid?: string;
  readonly name?: string;
  readonly parent?: SemanticObject3D | null;
}
export interface SemanticScene extends SemanticObject3D {
  readonly isScene: boolean;
}
export type SemanticTarget = string | SemanticObject3D;
export interface SemanticActionContext {
  readonly object: SemanticObject3D;
  readonly world: SemanticWorld;
  readonly signal?: AbortSignal;
}
export type SemanticActionFn = (args: unknown, context: SemanticActionContext) => unknown | Promise<unknown>;
export type SemanticAction = SemanticActionFn | {
  execute: SemanticActionFn;
  description?: string;
  available?: (context: SemanticActionContext) => boolean;
};
export interface SemanticDefinition {
  id?: string;
  type?: string;
  label?: string;
  description?: string;
  properties?: unknown;
  read?: () => unknown;
  actions?: Record<string, SemanticAction>;
}
export interface SemanticEntity {
  id: string;
  name: string;
  type: string;
  label: string;
  description: string;
  properties: unknown;
  attached: boolean;
  state: unknown;
  actions: Array<{ name: string; description: string; available: boolean }>;
}
export interface SemanticEvent {
  type: 'entity.registered' | 'entity.unregistered' | 'action.registered' | 'action.unregistered' | 'action.invoked' | 'disposed';
  id: string | null;
  world: SemanticWorld;
}
export interface SemanticPlugin {
  install(world: SemanticWorld, options?: unknown): void | (() => void) | { dispose(): void };
}
export interface SemanticWorld {
  readonly scene: SemanticScene;
  register(object: SemanticObject3D, definition?: SemanticDefinition): () => boolean;
  unregister(target: SemanticTarget): boolean;
  registerAction(target: SemanticTarget, name: string, action: SemanticAction): () => boolean;
  getObject(target: SemanticTarget): SemanticObject3D | null;
  inspect(target: SemanticTarget): SemanticEntity | null;
  list(options?: { attachedOnly?: boolean }): SemanticEntity[];
  invoke(target: SemanticTarget, name: string, args?: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  subscribe(listener: (event: SemanticEvent) => void): () => boolean;
  use(plugin: SemanticPlugin | ((world: SemanticWorld, options?: unknown) => ReturnType<SemanticPlugin['install']>), options?: unknown): () => boolean;
  dispose(): void;
}
/** Attach without renderer takeover, Studio, task compiler, MCP, permissions or sandbox. */
export declare function attach(scene: SemanticScene): SemanticWorld;
