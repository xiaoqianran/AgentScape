import { JoltPhysicsBackend } from '../../src/runtime/physics/JoltPhysicsBackend.js';
import { PhysicsSystem } from '../../src/runtime/systems/PhysicsSystem.js';

export const createJoltPhysicsSystem=()=>new PhysicsSystem({backend:new JoltPhysicsBackend()});
