import { attach } from './core.js';
export { attach } from './core.js';

/** The default package only extends a host-owned Three.js scene. */
export const AgentScape = Object.freeze({ attach, extend: attach });
