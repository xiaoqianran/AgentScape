export type InspectorSelection = {
  source:'runtime'|'authoring'|'environment';
  id:string;
} | null;

export type InspectorRelation = {
  predicate:string;
  object:string;
};

export type InspectorAffordanceAction = {
  action:string;
  execution:'query'|'editor'|'interaction'|'world-action';
  available:boolean|null;
  canApproach?:boolean;
  reason?:string|null;
  partName?:string;
  parameters:Record<string,{type?:string;enum?:string[];limits?:number[];maxLength?:number;[key:string]:unknown}>;
};

export type InspectorAffordances = {
  source:'asset'|'environment';
  label:string;
  evidenceKind:string;
  physicsVerified:boolean;
  actions:InspectorAffordanceAction[];
};

export type RuntimeInspectorModel = {
  source:'runtime';
  kind:'entity';
  id:string;
  title:string;
  subtitle:string;
  asset:string;
  type:string;
  transform:{
    position:number[];
    rotation:number[];
    scale:number;
  };
  spatial:{
    size:number[];
    nearbyCount:number;
  };
  actions:string[];
  actor?:string|null;
  affordances?:InspectorAffordances|null;
};

export type AuthoringInspectorModel = {
  source:'authoring';
  kind:string;
  id:string;
  title:string;
  subtitle:string;
  name:string;
  visible:boolean;
  transform:{
    position:number[];
    quaternion:number[];
    scale:number[];
  };
  childCount:number;
  modelRef:unknown;
  metadata:unknown;
};

export type EnvironmentInspectorModel = {
  source:'environment';
  kind:'environment';
  id:string;
  title:string;
  subtitle:string;
  actor?:string|null;
  affordances?:InspectorAffordances|null;
};

export type EmptyInspectorModel = {
  source:null|'runtime'|'authoring'|'environment'|string;
  kind:'empty'|'missing'|'environment'|'unsupported'|string;
  id:string|null;
  title?:string;
  subtitle?:string;
};

export type InspectorModel = RuntimeInspectorModel | AuthoringInspectorModel | EnvironmentInspectorModel | EmptyInspectorModel;

export type InspectorProjectionLike = {
  project:(selection:InspectorSelection)=>InspectorModel;
  projectActions?:(selection:InspectorSelection)=>{legacyAction?:string|null;kind:string;id:string|null;title?:string;type?:string;actor?:string|null;affordances?:InspectorAffordances|null};
  relations:(selection:InspectorSelection)=>InspectorRelation[];
};

export type ActionOperation = {operationId:number;actor:string|null;targetId:string;action:string;status:string;feedback:string;error:string};
export type EditorCommandsLike = {
  executeLegacy?:(target:string)=>Promise<unknown>;
  subscribeActions?:(listener:()=>void)=>()=>void;
  actionSnapshot?:(actor:string|null,target:string)=>ActionOperation|null;
  isActionPending?:(target:string)=>boolean;
  listActors?:()=>{agents:Array<{id:string}>;selected:string|null};
  selectActor?:(actor:string)=>unknown;
  runtimeAction:(action:string,id:string,args?:Record<string,unknown>)=>Promise<unknown>;
  executeAffordance?:(input:{actor:string;target:string;action:string;args?:Record<string,unknown>;partName?:string;surfaceId?:string})=>Promise<{verification?:{status:string};value?:{physicsVerified?:boolean;evidenceKind?:string;status?:string;reason?:string}}>;
  scaleRuntime:(id:string,scale:number)=>Promise<unknown>;
  renameAuthoringNode:(id:string,name:string)=>Promise<unknown>;
  transformAuthoringNode:(id:string,transform:{position?:number[];scale?:number[]})=>Promise<unknown>;
};
