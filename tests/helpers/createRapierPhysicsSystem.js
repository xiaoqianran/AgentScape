import { RapierPhysicsBackend } from '../../src/runtime/physics/RapierPhysicsBackend.js';
import { PhysicsSystem } from '../../src/runtime/systems/PhysicsSystem.js';

export const createRapierPhysicsSystem = () => new PhysicsSystem({ backend:new RapierPhysicsBackend() });
