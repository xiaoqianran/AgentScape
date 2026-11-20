/** Tools available to external Pi and DSH agents. Never expose host-code execution. */
export const AGENT_STUDIO_MCP_TOOLS = Object.freeze([
  'session_attach','studio_session_status',
  'scene_observe','scene_verify','scene_add_model','scene_apply',
  'scene_interact','scene_job','scene_cancel','studio_project',
  'asset_build_submit','asset_build_status','asset_publish','asset_inspect'
]);
export const AGENT_STUDIO_MCP_SET = new Set(AGENT_STUDIO_MCP_TOOLS);
