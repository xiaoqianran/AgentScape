import { RapierPhysicsBackend } from '../../world/runtime/physics/RapierPhysicsBackend.js';
import { PhysicsSystem } from '../../world/runtime/systems/PhysicsSystem.js';

export const createRapierPhysicsSystem = () => new PhysicsSystem({ backend:new RapierPhysicsBackend() });
