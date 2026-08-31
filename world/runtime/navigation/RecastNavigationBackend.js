import { NavigationBackend } from './NavigationBackend.js';

const point=(value)=>Array.isArray(value)?{x:value[0],y:value[1],z:value[2]}:value;
const voxelCeil=(value,cell)=>Math.ceil(value/cell-1e-9);
const voxelFloor=(value,cell)=>Math.floor(value/cell+1e-9);
const near=(a,b,epsilon=.002)=>Math.abs(a-b)<=epsilon;
const sameArray=(a=[],b=[],epsilon)=>a.length===b.length&&a.every((value,index)=>near(value,b[index],epsilon));
const sameObstacle=(a,b)=>a?.shape===b?.shape&&a?.sourceShape===b?.sourceShape&&a?.quality===b?.quality&&sameArray(a?.position,b?.position,.002)&&(
  a?.shape==='box'
    ? sameArray(a?.halfExtents,b?.halfExtents,.002)&&near(a?.angle||0,b?.angle||0,.005)
    : near(a?.radius||0,b?.radius||0,.002)&&near(a?.height||0,b?.height||0,.002)
);

const DEFAULT_RECAST_TUNING=Object.freeze({cellSize:.15,cellHeight:.1,tileSize:32,maxObstacles:128});
const recastConfig=(semantic,tuning)=>({
  cs:tuning.cellSize,
  ch:tuning.cellHeight,
  walkableSlopeAngle:semantic.maxSlope,
  walkableHeight:Math.max(3,voxelCeil(semantic.agentHeight,tuning.cellHeight)),
  walkableClimb:Math.max(0,voxelFloor(semantic.maxClimb,tuning.cellHeight)),
  walkableRadius:Math.max(0,voxelCeil(semantic.agentRadius,tuning.cellSize)),
  tileSize:tuning.tileSize,
  maxObstacles:tuning.maxObstacles
});

export class RecastNavigationBackend extends NavigationBackend {
  constructor(tuning={}){
    super('recast-detour',{capabilities:['static-routing','route-query','dynamic-obstacles','obstacle-suppression','debug-geometry']});
    this.tuning={...DEFAULT_RECAST_TUNING,...tuning};
    this.navMesh=null;
    this.tileCache=null;
    this.query=null;
    this.obstacles=new Map();
    this.tileCachePending=false;
    this.libraryPromise=null;
    this.navMeshExtractor=null;
  }

  isReady(){ return Boolean(this.query); }

  async loadLibrary(){
    if(!this.libraryPromise){
      this.libraryPromise=Promise.all([
        import('@recast-navigation/core'),
        import('@recast-navigation/generators')
      ]).then(async([core,generators])=>{
        await core.init();
        return {
          NavMeshQuery:core.NavMeshQuery,
          getNavMeshPositionsAndIndices:core.getNavMeshPositionsAndIndices,
          generateTileCache:generators.generateTileCache,
          mergePositionsAndIndices:generators.mergePositionsAndIndices
        };
      });
    }
    return this.libraryPromise;
  }

  clear(){
    this.query?.destroy();
    this.tileCache?.destroy();
    this.navMesh?.destroy();
    this.query=null;
    this.tileCache=null;
    this.navMesh=null;
    this.obstacles.clear();
    this.tileCachePending=false;
  }

  async build(staticGeometry,config){
    if(!Array.isArray(staticGeometry)||!staticGeometry.length){
      this.clear();
      return {success:false,code:'NAVMESH_EMPTY'};
    }
    try{
      const {NavMeshQuery,getNavMeshPositionsAndIndices,generateTileCache,mergePositionsAndIndices}=await this.loadLibrary();
      const [positions,indices]=mergePositionsAndIndices(staticGeometry);
      const built=generateTileCache(positions,indices,recastConfig(config,this.tuning));
      if(!built.success){
        this.clear();
        return {success:false,code:'NAVMESH_BUILD_FAILED',error:built.error||'Navigation backend build failed'};
      }
      const [navPositions,navIndices]=getNavMeshPositionsAndIndices(built.navMesh);
      if(!navPositions?.length||!navIndices?.length){
        built.tileCache?.destroy?.();
        built.navMesh?.destroy?.();
        this.clear();
        return {success:false,code:'NAVMESH_EMPTY'};
      }
      const query=new NavMeshQuery(built.navMesh);
      this.clear();
      this.navMesh=built.navMesh;
      this.tileCache=built.tileCache;
      this.query=query;
      this.navMeshExtractor=getNavMeshPositionsAndIndices;
      return {success:true};
    }catch(error){
      this.clear();
      return {success:false,code:'NAVMESH_BUILD_FAILED',error:error.message};
    }
  }

  flushObstacleUpdates(){
    if(!this.tileCache||!this.navMesh||!this.tileCachePending) return {success:true,updates:0};
    for(let updates=1;updates<=128;updates++){
      const result=this.tileCache.update(this.navMesh);
      if(!result.success) return {success:false,code:'NAVIGATION_OBSTACLE_UPDATE_FAILED',updates};
      if(result.upToDate){ this.tileCachePending=false; return {success:true,updates}; }
    }
    return {success:false,code:'NAVIGATION_OBSTACLE_UPDATE_INCOMPLETE',updates:128};
  }

  queueObstacle(descriptor){
    if(!this.tileCache) return {success:false};
    return descriptor.shape==='cylinder'
      ? this.tileCache.addCylinderObstacle(point(descriptor.position),descriptor.radius,descriptor.height)
      : this.tileCache.addBoxObstacle(point(descriptor.position),point(descriptor.halfExtents),descriptor.angle||0);
  }

  syncObstacles(descriptors=[]){
    if(!this.tileCache) return {success:false,code:'NAVIGATION_BACKEND_UNAVAILABLE',tracked:0,changed:0,operations:0,updates:0,descriptors:[]};
    let updates=0;
    if(this.tileCachePending){
      const pending=this.flushObstacleUpdates();
      updates+=pending.updates||0;
      if(!pending.success) return this.obstacleSyncFailure(pending.code,0,0,updates);
    }
    const desired=new Map(descriptors.map((item)=>[item.id,item]));
    let requests=0;
    const changedIds=new Set();
    let operations=0;
    const flushIfNeeded=(force=false)=>{
      if(!requests||(!force&&requests<48)) return {success:true};
      const flushed=this.flushObstacleUpdates();
      updates+=flushed.updates||0;
      if(flushed.success) requests=0;
      return flushed;
    };
    const request=(operation)=>{
      let result=operation();
      if(!result.success){
        const flushed=flushIfNeeded(true);
        if(!flushed.success) return flushed;
        result=operation();
      }
      if(result.success){ requests+=1; this.tileCachePending=true; }
      return result;
    };

    for(const [id,current] of [...this.obstacles]){
      const next=desired.get(id);
      if(next&&sameObstacle(current.descriptor,next)) continue;
      const removed=request(()=>this.tileCache.removeObstacle(current.obstacle));
      if(!removed.success) return this.obstacleSyncFailure('NAVIGATION_REMOVE_OBSTACLE_FAILED',changedIds.size,operations,updates);
      this.obstacles.delete(id);
      changedIds.add(id); operations+=1;
      const flushed=flushIfNeeded();
      if(!flushed.success) return this.obstacleSyncFailure(flushed.code,changedIds.size,operations,updates);
    }

    for(const [id,descriptor] of desired){
      if(this.obstacles.has(id)) continue;
      const added=request(()=>this.queueObstacle(descriptor));
      if(!added.success||!added.obstacle) return this.obstacleSyncFailure('NAVIGATION_ADD_OBSTACLE_FAILED',changedIds.size,operations,updates);
      this.obstacles.set(id,{obstacle:added.obstacle,descriptor:structuredClone(descriptor)});
      changedIds.add(id); operations+=1;
      const flushed=flushIfNeeded();
      if(!flushed.success) return this.obstacleSyncFailure(flushed.code,changedIds.size,operations,updates);
    }

    const flushed=flushIfNeeded(true);
    if(!flushed.success) return this.obstacleSyncFailure(flushed.code,changedIds.size,operations,updates);
    return {
      success:true,
      tracked:this.obstacles.size,
      changed:changedIds.size,
      operations,
      updates,
      descriptors:[...this.obstacles.values()].map(({descriptor})=>structuredClone(descriptor))
    };
  }

  obstacleSyncFailure(code,changed,operations,updates){
    return {
      success:false,code,tracked:this.obstacles.size,changed,operations,updates,
      descriptors:[...this.obstacles.values()].map(({descriptor})=>structuredClone(descriptor))
    };
  }

  rawRoute(start,end,halfExtents){
    if(!this.query) return {success:false,code:'NAVIGATION_BACKEND_UNAVAILABLE'};
    const extents=point(halfExtents);
    const startProjection=this.query.findClosestPoint(point(start),{halfExtents:extents});
    if(!startProjection.success) return {success:true,start:{success:false}};
    const endProjection=this.query.findClosestPoint(point(end),{halfExtents:extents});
    if(!endProjection.success) return {success:true,start:{success:true,point:startProjection.point},end:{success:false}};
    const computed=this.query.computePath(startProjection.point,endProjection.point,{halfExtents:extents});
    return {
      success:true,
      start:{success:true,point:startProjection.point},
      end:{success:true,point:endProjection.point},
      computed:{success:computed.success,path:computed.path||[],error:computed.error?.name||null}
    };
  }

  queryRoute(start,end,{halfExtents,suppressedObstacleIds=[]}={}){
    if(!suppressedObstacleIds.length) return this.rawRoute(start,end,halfExtents);
    const removed=[];
    let restorationError=null;
    try{
      for(const obstacleId of suppressedObstacleIds){
        const current=this.obstacles.get(obstacleId);
        if(!current) continue;
        const result=this.tileCache.removeObstacle(current.obstacle);
        if(!result.success) throw new Error('NAVIGATION_COUNTERFACTUAL_REMOVE_FAILED');
        removed.push({obstacleId,descriptor:current.descriptor});
        this.obstacles.delete(obstacleId);
        this.tileCachePending=true;
      }
      const flushed=this.flushObstacleUpdates();
      if(!flushed.success) throw new Error(flushed.code);
      return this.rawRoute(start,end,halfExtents);
    }finally{
      for(const {obstacleId,descriptor} of removed){
        const added=this.queueObstacle(descriptor);
        if(!added.success||!added.obstacle){ restorationError=new Error('NAVIGATION_COUNTERFACTUAL_RESTORE_FAILED'); continue; }
        this.obstacles.set(obstacleId,{obstacle:added.obstacle,descriptor});
        this.tileCachePending=true;
      }
      const flushed=this.flushObstacleUpdates();
      if(!flushed.success) restorationError||=new Error(flushed.code);
      if(restorationError) throw restorationError;
    }
  }

  debugMesh(){
    if(!this.navMesh||typeof this.navMeshExtractor!=="function") return {positions:[],indices:[]};
    const [positions,indices]=this.navMeshExtractor(this.navMesh);
    return {positions:Array.from(positions||[]),indices:Array.from(indices||[])};
  }

  debugGeometry(){
    return this.debugMesh().positions;
  }
}
