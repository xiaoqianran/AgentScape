import { RecastNavigationBackend } from '../../src/runtime/navigation/RecastNavigationBackend.js';
import { NavigationSystem } from '../../src/runtime/systems/NavigationSystem.js';

export const createRecastNavigationSystem=(options={})=>new NavigationSystem({...options,backend:new RecastNavigationBackend()});
