import { CAPABILITIES, invokeCapability } from '../_server/CapabilityAdapterRegistry.js';
export default function handler(req, res) { return invokeCapability(req, res, CAPABILITIES.AGENT); }
