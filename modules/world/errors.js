import { AgentScapeError } from '../../foundation/errors.js';

export const Errors = {
  objectNotFound: (id) => new AgentScapeError('OBJECT_NOT_FOUND', 'Object not found: ' + id, { id }),
  actionUnsupported: (id, action) => new AgentScapeError('ACTION_UNSUPPORTED', id + ' does not support ' + action, { id, action }),
  interactionUnavailable: (actorId, targetId, reason, details = {}) => new AgentScapeError('INTERACTION_UNAVAILABLE', actorId + ' cannot interact with ' + targetId + ': ' + reason, { actorId, targetId, reason, ...details }),
  carryUnavailable: (actorId, targetId, reason, details = {}) => new AgentScapeError('CARRY_UNAVAILABLE', actorId + ' cannot carry ' + targetId + ': ' + reason, { actorId, targetId, reason, ...details }),
  placeUnavailable: (actorId, targetId, reason, details = {}) => new AgentScapeError('PLACE_UNAVAILABLE', actorId + ' cannot place on ' + targetId + ': ' + reason, { actorId, targetId, reason, ...details })
};
