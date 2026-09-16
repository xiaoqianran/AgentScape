import { JoltPhysicsBackend } from '../../modules/physics/JoltPhysicsBackend.js';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';

export const createJoltPhysicsSystem=()=>new PhysicsSystem({backend:new JoltPhysicsBackend()});
