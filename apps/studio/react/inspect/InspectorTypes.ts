export type InspectorSelection = {
  source:'runtime'|'authoring'|'environment';
  id:string;
} | null;

export type InspectorRelation = {
  predicate:string;
  object:string;
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

export type EmptyInspectorModel = {
  source:null|'runtime'|'authoring'|'environment'|string;
  kind:'empty'|'missing'|'environment'|'unsupported'|string;
  id:string|null;
  title?:string;
  subtitle?:string;
};

export type InspectorModel = RuntimeInspectorModel | AuthoringInspectorModel | EmptyInspectorModel;

export type InspectorProjectionLike = {
  project:(selection:InspectorSelection)=>InspectorModel;
  relations:(selection:InspectorSelection)=>InspectorRelation[];
};

export type EditorCommandsLike = {
  runtimeAction:(action:string,id:string,args?:Record<string,unknown>)=>Promise<unknown>;
  scaleRuntime:(id:string,scale:number)=>Promise<unknown>;
  renameAuthoringNode:(id:string,name:string)=>Promise<unknown>;
  transformAuthoringNode:(id:string,transform:{position?:number[];scale?:number[]})=>Promise<unknown>;
};
