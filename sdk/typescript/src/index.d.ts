export type Vec3 = [number, number, number];
export type Quaternion = [number, number, number, number];
export type CapabilityLevel = 'visual' | 'physical' | 'interactive';
export interface CodeExecutionOptions { mode: 'disabled' | 'worker-wasm' | 'trusted-local' | 'os-isolated'; authorized?: boolean; remote?: boolean; wallTimeoutMs?: number; timeoutMs?: number; memoryBytes?: number; configPath?: string }
export interface ThreeCodeInput { kind:'three-code'; source:string; definition?:Record<string,unknown> }
export interface Transform { position?: Vec3; quaternion?: Quaternion; scale?: number }
export interface AssetRecipe { schema: 'agentscape.asset-recipe'; schemaVersion: 1; id: string; parts: unknown[]; capabilities?: { level: CapabilityLevel; physics?: unknown; actions?: string[]; surfaces?: unknown[] } }
export interface MechanicalComponent {
  id:string;parent:string|null;shape:'group'|'box'|'sphere'|'cylinder';position:Vec3;size:Vec3;color:string;collision:boolean;
}
export interface MechanicalMotion {
  id:string;node:string;type:'revolute'|'prismatic';axis:Vec3;limits:[number,number];open:number;
  mass:number;friction:number;stiffness:number;damping:number;
}
export interface MechanicalDraft {
  schema:'agentscape.mechanical-draft';schemaVersion:1;name:string;type:string;
  components:MechanicalComponent[];motions:MechanicalMotion[];
}
export interface ReviewPhysics { body: 'fixed' | 'dynamic'; mass: number; friction: number; colliders?: Array<{shape:'box';halfExtents:Vec3;translation?:Vec3}> }
export interface InteractionReview { proposalId:string; confirmed:true; physics:ReviewPhysics; parts?: Array<{id:string;node:string;parent?:string;physics:ReviewPhysics;
  joint:{type:'prismatic'|'revolute';axis:Vec3;parentAnchor:Vec3;childAnchor:Vec3;limits:[number,number];motor?:{stiffness:number;damping:number}}}> }
export interface GLBInput { kind:'glb';bytes:Uint8Array;name?:string;urdfBytes?:Uint8Array;review?:InteractionReview }
export interface CapabilityProposal { schema:'agentscape.capability-proposal';schemaVersion:1;proposalId:string;sourceHash:string;urdfHash:string|null;compilerVersion:string;
  physics:{body:null;mass:null;friction:null;colliders:unknown[]};
  parts:Array<{id:string;node:string;parent?:string;joint:Record<string,unknown>;physics?:Record<string,unknown>;confidence?:number;executable:false;physicsVerified:false;missing:string[]}>;
  operations:Array<{action:string;part?:string;executable:false;physicsVerified:false;requires:string}>;missing:string[];evidence:Record<string,unknown> }
export interface ModelInput { id: string; asset: string | AssetRecipe | MechanicalDraft | GLBInput | ThreeCodeInput; level?: CapabilityLevel; transform?: Transform; position?: Vec3 }
export interface Diagnostic { code: string; message: string; stage: string; retryable: boolean }
export type AdmissionStatus = 'ready' | 'provisional' | 'rejected';
export interface AdmissionLayer { status: AdmissionStatus; reasons: string[]; required: boolean }
export interface AssetAdmission { status: AdmissionStatus; reasons: string[]; layers: { provider: AdmissionLayer; compiler: AdmissionLayer; runtime: AdmissionLayer } }
export interface SceneResult<T = unknown> { schema: 'agentscape.scene-result'; schemaVersion: 1; operation: string; status: 'succeeded' | 'failed' | 'cancelled'; revision: number; id?: string; admission: AssetAdmission | null; verification: { status: 'not-requested' | 'verified' | 'unverified'; evidence: unknown }; diagnostics: Diagnostic[]; value: T }
export interface JobRef { id: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled' }
export interface AffordancePhysics { registered: boolean; body: 'fixed' | 'dynamic' | 'kinematic' | null; currentBody: 'fixed' | 'dynamic' | 'kinematic' | null; mass: number | null; friction: number | null; colliderCount: number }
export interface AffordanceJoint { type: 'fixed' | 'revolute' | 'prismatic'; axis?: Vec3; limits?: [number, number]; parentAnchor?: Vec3; childAnchor?: Vec3; [key: string]: unknown }
export interface ArticulationState { id: string; partName: string; jointType: string; coordinate: number; target: number | null; error: number | null; tolerance: number; limits: [number, number] | null; localAxis: Vec3; coordinateReference: 'rest-zero-pose' }
export interface AffordanceAction {
  action: string; parameters: Record<string, unknown>; execution: 'query' | 'editor' | 'interaction' | 'world-action';
  available: boolean | null; canApproach?:boolean; reason?: string | null; partName?: string; distance?: number; maxDistance?: number;
  targetPosition?: Vec3; blocker?: Record<string, unknown>; joint?: AffordanceJoint; state?: ArticulationState | null;
  contract?: { id: string; capability: string; action: string; target: { entityId: string; partName: string }; preconditions: unknown[]; effects: unknown[]; stateTransition: Record<string, unknown>; verifierTarget: Record<string, unknown> };
}
export interface ObjectAffordances {
  schema: 'agentscape.object-affordances'; schemaVersion: 1; id: string; source: 'asset' | 'environment';
  label: string; kind: string; position: Vec3; state: Record<string, unknown>;
  physics?: AffordancePhysics;
  actions: AffordanceAction[];
  evidenceKind: string; physicsVerified: false; pending: boolean;
}
export interface AffordanceListing { schema: string; total: number; entities: ObjectAffordances[] }
export type Edit = { type: 'add'; model: Omit<ModelInput, 'asset'> & { asset: string } } | { type: 'setTransform'; id: string; transform: Transform } | { type: 'remove'; id: string } | { type: 'replaceAsset'; id: string; asset: string; level?: CapabilityLevel };
export type PhysicalInteraction = { action: 'push' | 'drag'; actor: string; target: string; args: { direction: Vec3; distance: number; maxForce?: number } }
  | { action: 'rotate'; actor: string; target: string; args: { axis: Vec3; angle: number; maxTorque?: number } }
  | { action: 'slide'; actor: string; target: string; args: { part: string } & ({ target: number; distance?: never } | { distance: number; target?: never }) }
  | { action: 'rotateJoint'; actor: string; target: string; args: { part: string } & ({ target: number; angle?: never } | { angle: number; target?: never }) };
export type Interaction = PhysicalInteraction | { action: 'navigate'; actor: string; position: Vec3 } | { action: 'pickup'; actor: string; target: string } | { action: 'place'; actor: string; target: string; surfaceId?: string } | { action: 'open' | 'close'; actor: string; target: string; partName?: string }
  | { action: 'turn_on' | 'turn_off' | 'pull_out' | 'return'; actor: string; target: string }
  | { action: 'write'; actor: string; target: string; args: { text: string } };
export interface SceneHandle {
  actors():{agents:Array<{id:string;position:Vec3|null}>;selected:string|null};
  selectActor(actor:string):{agents:Array<{id:string;position:Vec3|null}>;selected:string|null};
  prepareAsset(input:Omit<GLBInput,'review'>):Promise<CapabilityProposal>;
  inspect(target: string, options?: { actor?: string }): ObjectAffordances;
  /** Object-only page in live insertion order. Restart after mutations; no global graph work. */
  observe(options: { actor?: string; offset?: number; limit: number }): { schema: 'agentscape.scene-object-page'; schemaVersion: 1; revision: number; total: number; offset: number; nextOffset: number | null; objects: Array<{ id: string; type: string; asset: string; position: Vec3; state: Record<string, unknown>; transform: Transform; physicsRegistered: boolean }> };
  observe(options?: { actor?: string }): { schema: string; schemaVersion: 1; revision: number; actors: ReturnType<SceneHandle['actors']>; style: Record<string, unknown> | null; affordances: AffordanceListing; objects: Array<{ id: string; type: string; asset: string; position: Vec3; state: Record<string, unknown>; transform: Transform; physicsRegistered: boolean }>; relations: unknown[] };
  addModel(input: ModelInput, options?:{signal?:AbortSignal}): Promise<SceneResult>;
  setTransform(input: { id: string; transform: Transform }): Promise<SceneResult>;
  remove(input: { id: string }): Promise<SceneResult>;
  replaceAsset(input: { id: string; asset: string; level?: CapabilityLevel }): Promise<SceneResult>;
  apply(input: { requestId?: string; expectedRevision?: number; operations: Edit[] }): Promise<SceneResult>;
  interact(input: Interaction): JobRef;
  getJob(id: string): JobRef & { result: SceneResult | null };
  waitJob(id: string): Promise<JobRef & { result: SceneResult | null }>;
  cancelJob(id: string): JobRef & { cancellationRequested: boolean };
  verify(criteria?: unknown[]): SceneResult;
  save(): Promise<SceneResult>;
  setStyle(style: string | Record<string, unknown>, options?: { fallback?: 'reject' | 'declared' }): Promise<SceneResult>;
  frame(timestamp: number): void; step(): unknown; close(): void;
}
export declare const AgentScape: { open(options?: { canvas?: string | HTMLElement; project?: unknown; bundle?: unknown; environment?: string; autoStart?: boolean; codeExecution?:CodeExecutionOptions }): Promise<SceneHandle> };
export declare function parseSceneProject(input: unknown): unknown;
export declare const recipeSchema: { parse(input: unknown): unknown };
export declare const assetPackageSchema: { parse(input: unknown): unknown };
export declare const stylePackSchema: { parse(input: unknown): unknown };
export declare const officialStylePacks: Readonly<Record<'realistic' | 'toon' | 'low-poly', Record<string, unknown>>>;
