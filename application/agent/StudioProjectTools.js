/** Shared MCP tool names and mutation semantics, independent of transport and Studio. */
export const STUDIO_PROJECT_TOOLS=Object.freeze(['studio_project','studio_files','scene_query','scene_capture','scene_timeline']);
export const STUDIO_PROJECT_TOOL_SET=new Set(STUDIO_PROJECT_TOOLS);
export const SCOPED_STUDIO_TOOLS=new Set(['session_attach',...STUDIO_PROJECT_TOOLS,'scene_observe','scene_verify']);
export function projectToolMutates(name,args={}){
  switch(name){
    case 'studio_project':return ['create','create_world','run','open','close'].includes(args.operation);
    case 'studio_files':return ['write','patch','file','resource','apply_batch','undo_batch'].includes(args.operation);
    case 'scene_timeline':return (args.command??'status')!=='status';
    default:return false;
  }
}
/** Normalize the public protocol into the existing Studio Bridge project operations. */
export function projectBridgeArgs(name,input){
  if(name==='scene_timeline')return {...input,operation:'timeline'};
  if(name==='studio_project'&&input.operation==='create')return {...input,operation:'write',create:true};
  return input;
}
