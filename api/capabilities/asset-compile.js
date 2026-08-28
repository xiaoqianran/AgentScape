import { CAPABILITIES, invokeCapability } from '../../server/CapabilityAdapterRegistry.js';
export default function handler(req, res) { return invokeCapability(req, res, CAPABILITIES.ASSET_COMPILE); }
