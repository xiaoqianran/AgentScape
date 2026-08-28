import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { NavigationBackend } from '../../src/runtime/navigation/NavigationBackend.js';
import { NavigationSystem } from '../../src/runtime/systems/NavigationSystem.js';
import { ObjectStore } from '../../src/runtime/ObjectStore.js';

const key=(x,z)=>`${x}:${z}`;
const parseKey=(value)=>value.split(':').map(Number);
const pathCost=(path)=>path.slice(1).reduce((sum,p,index)=>sum+Math.hypot(p.x-path[index].x,p.z-path[index].z),0);

class GridNavigationBackend extends NavigationBackend {
  constructor({cellSize=.25}={}){
    super('grid-a-star-experiment',{capabilities:['static-routing','route-query','dynamic-obstacles','obstacle-suppression','debug-geometry']});
    this.cellSize=cellSize;
    this.ready=false;
    this.bounds=null;
    this.obstacles=[];
    this.positions=[];
  }

  isReady(){ return this.ready; }

  async build(staticGeometry){
    const values=[];
    for(const geometry of staticGeometry||[]) for(let i=0;i<geometry.positions.length;i+=3) values.push([geometry.positions[i],geometry.positions[i+1],geometry.positions[i+2]]);
    if(!values.length){ this.clear(); return {success:false,code:'GRID_GEOMETRY_EMPTY'}; }
    this.bounds={
      minX:Math.min(...values.map(([x])=>x)),maxX:Math.max(...values.map(([x])=>x)),
      minZ:Math.min(...values.map(([, ,z])=>z)),maxZ:Math.max(...values.map(([, ,z])=>z))
    };
    this.positions=values.flat();
    this.ready=true;
    return {success:true};
  }

  clear(){ this.ready=false; this.bounds=null; this.obstacles=[]; this.positions=[]; }
  debugGeometry(){ return [...this.positions]; }

  syncObstacles(descriptors=[]){
    const previous=JSON.stringify(this.obstacles);
    this.obstacles=structuredClone(descriptors);
    return {success:true,tracked:this.obstacles.length,changed:previous===JSON.stringify(this.obstacles)?0:1,operations:this.obstacles.length,updates:0,descriptors:structuredClone(this.obstacles)};
  }

  cellFor(point){
    if(!this.bounds) return null;
    const x=Math.round((point[0]-this.bounds.minX)/this.cellSize);
    const z=Math.round((point[2]-this.bounds.minZ)/this.cellSize);
    const world={x:this.bounds.minX+x*this.cellSize,y:point[1],z:this.bounds.minZ+z*this.cellSize};
    if(world.x<this.bounds.minX-.001||world.x>this.bounds.maxX+.001||world.z<this.bounds.minZ-.001||world.z>this.bounds.maxZ+.001) return null;
    return {x,z,world};
  }

  blocked(world,suppressed){
    for(const obstacle of this.obstacles){
      if(suppressed.has(obstacle.id)) continue;
      const dx=world.x-obstacle.position[0],dz=world.z-obstacle.position[2];
      if(obstacle.shape==='cylinder'){
        if(Math.hypot(dx,dz)<=obstacle.radius+this.cellSize*.45) return true;
        continue;
      }
      const angle=-(obstacle.angle||0),c=Math.cos(angle),s=Math.sin(angle);
      const localX=c*dx-s*dz,localZ=s*dx+c*dz;
      if(Math.abs(localX)<=obstacle.halfExtents[0]+this.cellSize*.45&&Math.abs(localZ)<=obstacle.halfExtents[2]+this.cellSize*.45) return true;
    }
    return false;
  }

  queryRoute(start,end,{suppressedObstacleIds=[]}={}){
    if(!this.ready) return {success:false,code:'NAVIGATION_BACKEND_UNAVAILABLE'};
    const startCell=this.cellFor(start),endCell=this.cellFor(end);
    if(!startCell) return {success:true,start:{success:false}};
    if(!endCell) return {success:true,start:{success:true,point:startCell.world},end:{success:false}};
    const suppressed=new Set(suppressedObstacleIds);
    const open=[{x:startCell.x,z:startCell.z,g:0,f:0}];
    const cameFrom=new Map(),gScore=new Map([[key(startCell.x,startCell.z),0]]),closed=new Set();
    const heuristic=(x,z)=>Math.hypot(x-endCell.x,z-endCell.z);
    const neighbors=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    let found=null;
    while(open.length){
      open.sort((a,b)=>a.f-b.f);
      const current=open.shift(),currentKey=key(current.x,current.z);
      if(closed.has(currentKey)) continue;
      closed.add(currentKey);
      if(current.x===endCell.x&&current.z===endCell.z){ found=current; break; }
      for(const [dx,dz] of neighbors){
        const nx=current.x+dx,nz=current.z+dz;
        const world={x:this.bounds.minX+nx*this.cellSize,y:start[1],z:this.bounds.minZ+nz*this.cellSize};
        if(world.x<this.bounds.minX||world.x>this.bounds.maxX||world.z<this.bounds.minZ||world.z>this.bounds.maxZ||this.blocked(world,suppressed)) continue;
        const step=Math.hypot(dx,dz),tentative=current.g+step,nk=key(nx,nz);
        if(tentative>=(gScore.get(nk)??Infinity)) continue;
        cameFrom.set(nk,currentKey); gScore.set(nk,tentative);
        open.push({x:nx,z:nz,g:tentative,f:tentative+heuristic(nx,nz)});
      }
    }
    if(!found) return {success:true,start:{success:true,point:startCell.world},end:{success:true,point:endCell.world},computed:{success:false,path:[],error:'NO_GRID_PATH'}};
    const cells=[];
    let cursor=key(found.x,found.z);
    while(cursor){ cells.push(parseKey(cursor)); cursor=cameFrom.get(cursor); }
    cells.reverse();
    const path=cells.map(([x,z])=>({x:this.bounds.minX+x*this.cellSize,y:start[1],z:this.bounds.minZ+z*this.cellSize}));
    return {success:true,start:{success:true,point:startCell.world},end:{success:true,point:endCell.world},computed:{success:true,path,error:null}};
  }
}

const timings={};
const timed=async(name,fn)=>{const started=performance.now();try{return await fn();}finally{timings[name]=Number((performance.now()-started).toFixed(3));}};

const floor=new THREE.Mesh(new THREE.PlaneGeometry(6,4));
floor.rotation.x=-Math.PI/2;
floor.updateMatrixWorld(true);
const physics={
  profile:()=>({identity:'experiment-physics'}),
  navigationObstacles:()=>({items:[{id:'wall',shape:'box',sourceShape:'box',quality:'exact',position:[0,0,0],halfExtents:[.3,1,1.25],angle:0}],skipped:[]})
};
const backend=new GridNavigationBackend({cellSize:.25});
const navigation=new NavigationSystem({store:new ObjectStore(),physics,environmentRoots:[floor],backend});
try {
  const routed=await timed('routeWithObstacleMs',()=>navigation.findPath([-2,0,0],[2,0,0]));
  const suppressed=await timed('suppressedRouteMs',async()=>{
    const raw=backend.queryRoute([-2,0,0],[2,0,0],{suppressedObstacleIds:['wall']});
    return {raw,cost:raw.computed?.path?.length?pathCost(raw.computed.path):Infinity};
  });
  const routedCost=routed.path.length?routed.path.slice(1).reduce((sum,p,index)=>sum+Math.hypot(p[0]-routed.path[index][0],p[2]-routed.path[index][2]),0):Infinity;
  const checks={
    providerIsNotRecast:backend.identity==='grid-a-star-experiment',
    routeReachable:routed.reachable===true,
    dynamicObstacleTracked:navigation.status().dynamicObstacles.tracked===1,
    detourCostsMore:routedCost>suppressed.cost+.2,
    suppressionShortensRoute:suppressed.raw.computed?.success===true,
    providerNeutralCapabilities:navigation.profile().backendCapabilities.includes('static-routing')&&!navigation.profile().backendCapabilities.some((value)=>value.includes('navmesh')),
    runtimeCounterfactualCapability:navigation.profile().runtimeCapabilities.includes('counterfactual-routing')
  };
  console.log(JSON.stringify({experiment:'grid-navigation-backend',checks,timings,routedCost:Number(routedCost.toFixed(3)),suppressedCost:Number(suppressed.cost.toFixed(3)),pathPoints:routed.path.length,suppressedPathPoints:suppressed.raw.computed.path.length},null,2));
  if(Object.values(checks).some((value)=>value!==true)) process.exitCode=1;
} finally {
  navigation.dispose();
  floor.geometry.dispose();
}
