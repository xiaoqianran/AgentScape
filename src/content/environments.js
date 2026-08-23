export const ENVIRONMENTS = Object.freeze([
  Object.freeze({
    id:'monument-hall', number:'WORLD 01', title:'Monument Hall', headline:'Space for intelligence.',
    description:'A monumental 32 × 24 m world where physics, navigation and agent actions share the same reality.',
    facts:['RAPIER PHYSICS','RECAST / DETOUR','AGENT-READY ASSETS'],
    load:()=>import('./monumentHall.js').then((module)=>module.createMonumentHall),
    bootstrap:{agent:[0,0,9],table:[5.2,0,4.2],cabinet:[-5.2,0,3.9],cup:[5.55,1.4,4.2]},
    coffeeCorner:{table:[4.8,0,4.2],cabinet:[2.4,0,4.2]}
  }),
  Object.freeze({
    id:'ruined-courtyard', number:'WORLD 02', title:'Ruined Courtyard', headline:'Paths through memory.',
    description:'An open-air 36 × 30 m ruin of broken arcades, split-level terraces and reclaimed stone.',
    facts:['SPLIT-LEVEL NAVMESH','PHYSICAL RUINS','CC0 MATERIALS'],
    load:()=>import('./ruinedCourtyard.js').then((module)=>module.createRuinedCourtyard),
    bootstrap:{agent:[0,0,12],table:[11.8,1.2,5.1],cabinet:[-11.6,.8,-5.8],cup:[12.1,2.6,5.1]},
    coffeeCorner:{table:[10.5,1.2,3.5],cabinet:[8.4,1.2,3.5]}
  }),
  Object.freeze({
    id:'grand-urban-block', number:'WORLD 03', title:'Grand Urban Block', headline:'A city block with consequences.',
    description:'A 96 × 72 m modular district of boulevards, raised city blocks, civic plaza and long-range navigation.',
    facts:['96 × 72M WORLD','INSTANCED STREET LIFE','TILED NAVIGATION'],
    load:()=>import('./grandUrbanBlock.js').then((module)=>module.createGrandUrbanBlock),
    bootstrap:{agent:[0,0,-30],table:[6,.16,5],cabinet:[-6,.16,5],cup:[6.35,1.56,5]},
    coffeeCorner:{table:[6,.16,5],cabinet:[3.4,.16,5]}
  })
]);

const byId=new Map(ENVIRONMENTS.map((value)=>[value.id,value]));
export const DEFAULT_ENVIRONMENT=ENVIRONMENTS[0];
export const resolveEnvironment=(id)=>byId.get(id)||DEFAULT_ENVIRONMENT;
