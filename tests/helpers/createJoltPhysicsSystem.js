import { JoltPhysicsBackend } from '../../world/runtime/physics/JoltPhysicsBackend.js';
import { PhysicsSystem } from '../../world/runtime/systems/PhysicsSystem.js';

export const createJoltPhysicsSystem=()=>new PhysicsSystem({backend:new JoltPhysicsBackend()});
