import { RecastNavigationBackend } from '../../src/runtime/navigation/RecastNavigationBackend.js';
import { NavigationSystem } from '../../src/runtime/systems/NavigationSystem.js';

export const createRecastNavigationSystem=({backendOptions={},...options}={})=>new NavigationSystem({...options,backend:new RecastNavigationBackend(backendOptions)});
