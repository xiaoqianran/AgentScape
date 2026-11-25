import * as z from 'zod/v4';
import { projectBridgeArgs } from '../../application/agent/StudioProjectTools.js';

const revision=z.number().int().nonnegative();
const nodePath=z.string().max(256);
const objectUuid=z.string().min(1).max(128);
const project=z.record(z.string(),z.unknown());
const filePath=z.string().min(1).max(180);
const batchOperations=z.array(z.object({kind:z.enum(['file','resource']),action:z.enum(['create','write','patch','rename','delete','add']),
    path:z.string().min(1).max(180),newPath:z.string().max(180).optional(),
    content:z.string().optional(),oldText:z.string().optional(),newText:z.string().optional(),
    mime:z.string().optional(),base64:z.string().optional()}).strict()).min(1).max(32);
const inspectionView=z.union([
    z.object({position:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),target:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),fov:z.number().min(10).max(110).optional()}).strict(),
    z.object({nodePath:z.string().max(256),objectUuid:z.string().min(1).max(128).optional(),direction:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]).optional(),position:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]).optional(),target:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]).optional(),fov:z.number().min(10).max(110).optional(),padding:z.number().min(1.02).max(2.5).optional()}).strict()
  ]);

/** Separate narrow public contracts; all operations use one existing project dispatcher. */
export function registerStudioProjectTools(add,dispatch,{projectScope}={}){
  const session={worldSessionId:z.uuid().optional(),requestId:z.uuid().optional()};
  const draft={...session,expectedRevision:revision.optional()};
  const live={...session,expectedRevision:revision,expectedRuntimeId:z.uuid().optional(),expectedSceneRevision:revision.optional()};
  const target={nodePath:nodePath.optional(),objectUuid:objectUuid.optional()};
  const geometry={includeMaterials:z.boolean().optional(),includeLights:z.boolean().optional(),visibility:z.boolean().optional()};
  const register=(name,description,shape)=>add(name,description,shape,(a,e)=>{
    const {worldSessionId,requestId,...input}=a;
    return dispatch(a,projectBridgeArgs(name,input),e);
  });
  register('studio_project',projectScope
    ? 'Manage the prepared code world: read the guide, source preview and revision; run the edited revision; save the live world. Edit code with studio_files.'
    : 'Manage trusted native Three.js code worlds: read lists projects, guide and revision; create accepts optional name/source/project; create_world takes a world_ ID plus 32 lowercase hex digits; open takes an existing project ID; run activates the draft; save persists live state; close returns to the base world. Edit files with studio_files. Not a sandbox.',{
    ...draft,operation:z.enum(projectScope?['read','run','save']:['read','create','create_world','open','run','save','close']),
    ...(!projectScope?{id:z.string().optional(),name:z.string().min(1).optional(),source:z.string().min(1).optional(),project:project.optional()}: {})
  });
  register('studio_files','Edit the current project draft, not the running scene. write replaces entry source or a same-ID project; patch replaces a unique fragment (optional path); file_read reads a named file with offset/limit; file creates/writes/patches/renames/deletes; resource adds/deletes binary resources; preview_batch stages up to 32 edits, apply_batch commits atomically, discard_batch discards, undo_batch reverts. Use current expectedRevision for edits, then studio_project run.',{
    ...draft,operation:z.enum(['write','patch','file_read','file','resource','preview_batch','apply_batch','discard_batch','undo_batch']),
    source:z.string().min(1).optional(),name:z.string().min(1).optional(),project:project.optional(),
    oldText:z.string().min(1).optional(),newText:z.string().optional(),action:z.enum(['create','write','patch','rename','delete','add']).optional(),
    path:filePath.optional(),newPath:z.string().max(180).optional(),content:z.string().optional(),mime:z.string().optional(),base64:z.string().optional(),
    offset:z.number().int().nonnegative().optional(),limit:z.number().int().min(1).max(65536).optional(),previewId:z.uuid().optional(),operations:batchOperations.optional()
  });
  register('scene_query','Read native Three.js geometry without semantic registration. search by query/objectType/material, inspect a path (empty for root), inspect_batch up to 8 paths (4 with visibility). Include materials/lights and approximate opaque-mesh visibility when needed. Results are bounded evidence, not a visual or physical verdict. Reuse expectedRuntimeId, expectedSceneRevision and objectUuid from search; objectUuids aligns with nodePaths. Stale paths with a mismatched UUID are rejected. physics_candidate requires nodePath and objectUuid; returns conservative per-mesh oriented boxes for explicit source binding, never creates a body or grants actions. For registered semantic entities use scene_observe.',{
    ...live,operation:z.enum(['search','inspect','inspect_batch','physics_candidate']),...target,...geometry,
    query:z.string().max(120).optional(),objectType:z.string().max(64).optional(),material:z.string().max(120).optional(),visibleOnly:z.boolean().optional(),includeInternal:z.boolean().optional(),
    nodePaths:z.array(nodePath).min(1).max(8).optional(),objectUuids:z.array(objectUuid).min(1).max(8).optional(),
    offset:z.number().int().nonnegative().optional(),limit:z.number().int().min(1).max(64).optional(),view:inspectionView.optional()
  });
  register('scene_capture','Capture a real JPEG or suggest 2-12 camera views ranked by bounded opaque-mesh ray sampling. capture supports imageMode=mcp (image content) or base64, detached view={position,target,fov} or auto-frame view={nodePath,objectUuid,direction,padding}; isolateNodePath/isolateObjectUuid temporarily isolate the subject. Direct WebGL views exclude custom postprocessing; no simulation step. If a canvas is still initializing, capture waits briefly and returns VISUAL_CANVAS_NOT_READY rather than a tiny image; retry on the same running revision. suggest_views accepts nodePath/objectUuid and optional candidateLimit/grid/directions. Use revisions and UUID from scene_query. Not a visual verdict.',{
    ...live,operation:z.enum(['capture','suggest_views']),...target,
    maxWidth:z.number().int().min(128).max(1024).optional(),maxHeight:z.number().int().min(128).max(1024).optional(),imageMode:z.enum(['base64','mcp']).optional(),
    view:inspectionView.optional(),isolateNodePath:nodePath.optional(),isolateObjectUuid:objectUuid.optional(),
    candidateLimit:z.number().int().min(2).max(12).optional(),grid:z.number().int().min(3).max(7).optional(),fov:z.number().min(10).max(110).optional(),padding:z.number().min(1.02).max(2.5).optional(),
    directions:z.array(z.tuple([z.number().finite(),z.number().finite(),z.number().finite()])).min(2).max(12).optional()
  });
  register('scene_timeline','Control the current code world timeline: status, pause, resume, or step 1-120 fixed ticks while paused. Resume before scene_interact. Does not control external timers or user-created render loops.',{
    ...live,command:z.enum(['status','pause','resume','step']).default('status'),steps:z.number().int().min(1).max(120).optional()
  });
}
