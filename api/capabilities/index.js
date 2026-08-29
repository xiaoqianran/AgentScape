import { sendCapabilityStatus } from '../_server/CapabilityAdapterRegistry.js';
export default function handler(req, res) { return sendCapabilityStatus(req, res); }
