import { RapierPhysicsBackend } from '../../modules/physics/RapierPhysicsBackend.js';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';

export const createRapierPhysicsSystem = () => new PhysicsSystem({ backend:new RapierPhysicsBackend() });
