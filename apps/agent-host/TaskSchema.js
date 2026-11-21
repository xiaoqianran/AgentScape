import * as z from 'zod/v4';

// The model proposes a task. Only the Host can convert it to Runtime acceptance checks.
const id=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const quote=z.string().min(1).max(180);
const scalar=z.union([z.string().max(200),z.number().finite(),z.boolean(),z.null()]);
const base={quote};
const entity=z.object({...base,kind:z.literal('entity'),targetId:id,count:z.number().int().min(1).max(16).default(1)}).strict();
const relation=z.object({...base,kind:z.literal('relation'),subject:id,
  predicate:z.enum(['ON','NEAR','INSIDE','CONTAINS','SUPPORTS']),object:id}).strict();
const action=z.object({...base,kind:z.literal('action'),targetId:id,capability:id,
  source:z.enum(['project','physical-articulation','environment']).default('project')}).strict();
const state=z.object({...base,kind:z.literal('state'),targetId:id,stateKey:id,value:scalar}).strict();
const visual=z.object({...base,kind:z.literal('visual'),description:z.string().min(1).max(200)}).strict();
const unverifiable=z.object({...base,kind:z.literal('unverifiable'),description:z.string().min(1).max(200)}).strict();

export const taskDraftSchema=z.object({
  requirements:z.array(z.discriminatedUnion('kind',[entity,relation,action,state,visual,unverifiable])).min(1).max(24),
  complete:z.boolean()
}).strict();
