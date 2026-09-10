import { AgentScapeError } from '../../foundation/errors.js';

export const Errors = {
  assetNotFound: (id) => new AgentScapeError('ASSET_NOT_FOUND', 'Unknown asset: ' + id, { id }),
  invalidManifest: (message, details) => new AgentScapeError('INVALID_MANIFEST', message, details)
};
