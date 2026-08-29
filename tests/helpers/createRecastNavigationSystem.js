import { RecastNavigationBackend } from '../../world/runtime/navigation/RecastNavigationBackend.js';
import { NavigationSystem } from '../../world/runtime/systems/NavigationSystem.js';

export const createRecastNavigationSystem=({backendOptions={},...options}={})=>new NavigationSystem({...options,backend:new RecastNavigationBackend(backendOptions)});
