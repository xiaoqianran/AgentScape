export class AgentScapeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AgentScapeError';
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  assetNotFound: (id) => new AgentScapeError('ASSET_NOT_FOUND', `Unknown asset: ${id}`, { id }),
  objectNotFound: (id) => new AgentScapeError('OBJECT_NOT_FOUND', `Object not found: ${id}`, { id }),
  actionUnsupported: (id, action) => new AgentScapeError('ACTION_UNSUPPORTED', `${id} does not support ${action}`, { id, action }),
  interactionUnavailable: (actorId, targetId, reason, details = {}) => new AgentScapeError('INTERACTION_UNAVAILABLE', `${actorId} cannot interact with ${targetId}: ${reason}`, { actorId, targetId, reason, ...details }),
  carryUnavailable: (actorId, targetId, reason, details = {}) => new AgentScapeError('CARRY_UNAVAILABLE', `${actorId} cannot carry ${targetId}: ${reason}`, { actorId, targetId, reason, ...details }),
  invalidManifest: (message, details) => new AgentScapeError('INVALID_MANIFEST', message, details),
  invalidToolCall: (name, details) => new AgentScapeError('INVALID_TOOL_CALL', `Invalid tool call: ${name}`, details)
};
