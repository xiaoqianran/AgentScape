import { STUDIO_PROJECT_TOOLS } from './StudioProjectTools.js';

/** Tools available to external Pi and DSH agents. Never expose host-code execution. */
export const AGENT_STUDIO_MCP_TOOLS = Object.freeze([
  'session_attach','studio_session_status','studio_sessions_list',
  'scene_observe','scene_verify','scene_navigation','scene_add_model','scene_apply','scene_history',
  'scene_interact','scene_job','scene_cancel',...STUDIO_PROJECT_TOOLS,
  'asset_build_submit','asset_build_status','asset_publish','asset_inspect'
]);
export const AGENT_STUDIO_MCP_SET = new Set(AGENT_STUDIO_MCP_TOOLS);
