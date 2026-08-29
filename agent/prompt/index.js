import { BASE_POLICY } from './basePolicy.js';
import { MUTATION_POLICY } from './mutationPolicy.js';
import { RECOVERY_POLICY } from './recoveryPolicy.js';
import { WORLD_POLICY } from './worldPolicy.js';
import { EMBODIED_POLICY } from './embodiedPolicy.js';

export const AGENT_POLICIES = Object.freeze([
  BASE_POLICY,
  MUTATION_POLICY,
  RECOVERY_POLICY,
  WORLD_POLICY,
  EMBODIED_POLICY
]);

export function buildAgentSystemPrompt(toolDefinitions=[]) {
  const tools=toolDefinitions.map((tool)=>tool.name).filter(Boolean);
  const availability=tools.length
    ? `Available tools for this run are supplied as structured contracts: ${tools.join(', ')}. Do not assume any tool not in this list exists.`
    : 'Available tools are supplied separately as structured contracts.';
  return [...AGENT_POLICIES,availability,'Keep the final response concise.'].join('\n\n');
}
