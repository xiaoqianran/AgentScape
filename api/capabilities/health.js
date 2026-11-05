import { sendCapabilityHealth } from '../../apps/server/CapabilityAdapterRegistry.js';
export default function handler(req, res) { return sendCapabilityHealth(req, res); }
