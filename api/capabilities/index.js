import { sendCapabilityStatus } from '../../apps/server/CapabilityAdapterRegistry.js';
export default function handler(req, res) { return sendCapabilityStatus(req, res); }
