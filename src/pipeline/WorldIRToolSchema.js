const text={type:'string',minLength:1};
const scalar={anyOf:[{type:'string'},{type:'number'},{type:'boolean'},{type:'null'}]};
const vec3={type:'array',items:{type:'number'},minItems:3,maxItems:3};
const strict=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});

const asset=strict({
  assetId:text,query:text,prompt:text,type:text,generate:{type:'boolean'},provider:text
});
asset.anyOf=[{required:['assetId']},{required:['query']},{required:['prompt']},{required:['type']}];

const physicsRequirement=strict({
  bodyClass:{type:'string',enum:['rigid','articulated','character','soft','cloth']},
  requiredCapabilities:{type:'array',items:text,uniqueItems:true},
  executionMode:{type:'string',enum:['realtime','validation-only']},
  qualityPolicy:strict({
    deterministicRequired:{type:'boolean'},realtimeRequired:{type:'boolean'},fallbackPolicy:{type:'string',enum:['deny']}
  })
});

const entity=strict({
  id:text,asset,
  transform:strict({position:vec3}),
  physicsRequirement,
  capabilityIntent:{type:'array',items:text,uniqueItems:true},
  initialState:{type:'object',additionalProperties:scalar}
},['id','asset']);

const relation=strict({
  subject:text,predicate:{type:'string',enum:['ON','NEAR']},object:text,surfaceId:text,
  distance:{type:'number',exclusiveMinimum:0}
},['subject','predicate','object']);

const interactionCommon={id:text,actorId:text,targetId:text,supportId:text,description:{type:'string'}};
const interaction={oneOf:[
  strict({...interactionCommon,capability:{type:'string',enum:['OPEN','CLOSE','PICKUP']}},['id','targetId','capability']),
  strict({...interactionCommon,capability:{type:'string',enum:['PLACE']}},['id','supportId','capability']),
  strict({...interactionCommon,capability:{type:'string',enum:['SWITCH']},stateKey:text,value:scalar},['id','targetId','capability','stateKey','value'])
]};

const ruleCondition={oneOf:[
  strict({kind:{type:'string',enum:['equals']},targetId:text,stateKey:text,value:scalar},['kind','targetId','stateKey','value']),
  strict({kind:{type:'string',enum:['not-equals']},targetId:text,stateKey:text,value:scalar},['kind','targetId','stateKey','value'])
]};
const ruleEffect=strict({kind:{type:'string',enum:['set-state']},targetId:text,stateKey:text,value:scalar},['kind','targetId','stateKey','value']);
const rule=strict({id:text,event:text,condition:ruleCondition,effect:ruleEffect,description:{type:'string'}},['id','event','effect']);

const acceptance={oneOf:[
  strict({id:text,kind:{type:'string',enum:['world-valid']},description:{type:'string'}},['id','kind']),
  strict({id:text,kind:{type:'string',enum:['object-exists']},targetId:text,description:{type:'string'}},['id','kind','targetId']),
  strict({id:text,kind:{type:'string',enum:['state-equals']},targetId:text,stateKey:text,value:scalar,description:{type:'string'}},['id','kind','targetId','stateKey','value']),
  strict({id:text,kind:{type:'string',enum:['interaction-verified']},targetId:text,capability:text,description:{type:'string'}},['id','kind','targetId','capability']),
  strict({id:text,kind:{type:'string',enum:['relation-exists']},subject:text,predicate:{type:'string',enum:['ON','NEAR','INSIDE','CONTAINS','SUPPORTS']},object:text,surfaceId:text,description:{type:'string'}},['id','kind','subject','predicate','object']),
  strict({id:text,kind:{type:'string',enum:['no-unresolved']},description:{type:'string'}},['id','kind'])
]};

export const WORLD_IR_TOOL_SCHEMA=strict({
  schema:{type:'string',enum:['agentscape.world-ir']},
  schemaVersion:{type:'integer',enum:[1]},
  revision:strict({id:text,parentId:text,reason:{type:'string'}},['id']),
  provenance:strict({source:text,sourceId:text,createdBy:text,evidenceRefs:{type:'array',items:text,uniqueItems:true}},['source']),
  intent:strict({name:text,description:{type:'string'},task:{type:'string'}},['name']),
  policy:strict({
    generation:strict({provider:text,generate:{type:'boolean'}}),
    physics:strict({fallbackPolicy:{type:'string',enum:['deny']}})
  }),
  entities:{type:'array',items:entity},
  spatial:strict({relations:{type:'array',items:relation}},['relations']),
  interactions:{type:'array',items:interaction},
  rules:{type:'array',items:rule},
  acceptance:{type:'array',items:acceptance}
},['schema','schemaVersion','revision','provenance','intent','entities','spatial','interactions','rules','acceptance']);

const {schema: _schema, schemaVersion: _schemaVersion, revision: _revision, provenance: _provenance, ...plannerProperties}=WORLD_IR_TOOL_SCHEMA.properties;
export const WORLD_PLANNER_PROPOSAL_SCHEMA={
  type:'object',additionalProperties:false,
  properties:plannerProperties,
  required:WORLD_IR_TOOL_SCHEMA.required.filter((key)=>!['schema','schemaVersion','revision','provenance'].includes(key))
};
