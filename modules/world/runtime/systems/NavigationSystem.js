import * as THREE from 'three';
import {nativeColliderNavigationInputs,nativeFixedNavigationInputs,validateNativeNavigationInputs} from '../NativeNavigationGeometry.js';
const DEFAULT_CONFIG = Object.freeze({
  agentRadius: 0.3,
  agentHeight: 1.7,
  maxClimb: 0.3,
  maxSlope: 45,
  maxSnapDistance: 0.75,
  endTolerance: 0.3
});

const round = (value) => Number(value.toFixed(3));
const roundPoint = (point) => [round(point.x), round(point.y), round(point.z)];
const point = (value) => ({ x: value[0], y: value[1], z: value[2] });
const finitePoint = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pathCost = (path) => path.slice(1).reduce((sum, current, index) => sum + distance(path[index], current), 0);

const geometryInputs=(meshes)=>{
  const vertex=new THREE.Vector3();
  const inputs=[];
  for(const mesh of meshes){
    mesh.updateWorldMatrix(true,false);
    const attribute=mesh.geometry.getAttribute('position');
    if(!attribute||attribute.itemSize!==3) continue;
    const positions=new Float32Array(attribute.count*3);
    for(let i=0;i<attribute.count;i++) vertex.fromBufferAttribute(attribute,i).applyMatrix4(mesh.matrixWorld).toArray(positions,i*3);
    const sourceIndices=mesh.geometry.getIndex();
    const indices=sourceIndices?.array||Uint32Array.from({length:attribute.count},(_,i)=>i);
    inputs.push({positions,indices});
  }
  return inputs;
};

const obstacleDistanceXZ = (position, descriptor) => {
  const dx = position[0] - descriptor.position[0];
  const dz = position[2] - descriptor.position[2];
  if (descriptor.shape === 'cylinder') return Math.max(0, Math.hypot(dx, dz) - descriptor.radius);
  const angle = -(descriptor.angle || 0);
  const localX = Math.cos(angle) * dx - Math.sin(angle) * dz;
  const localZ = Math.sin(angle) * dx + Math.cos(angle) * dz;
  const outsideX = Math.max(0, Math.abs(localX) - descriptor.halfExtents[0]);
  const outsideZ = Math.max(0, Math.abs(localZ) - descriptor.halfExtents[2]);
  return Math.hypot(outsideX, outsideZ);
};

// Compare the same projected endpoints. A longer path alone is not progress:
// the hypothetical route must advance materially toward the original goal.
function partialRouteProgress(current,route,minimumGain){
  if(current.reason!=='PARTIAL_PATH'||route.reason!=='PARTIAL_PATH'||
    !current.path.length||!route.path.length||!current.start?.snapped||!route.start?.snapped||
    !current.end?.snapped||!route.end?.snapped)return null;
  const delta=(a,b)=>distance(point(a),point(b));
  if(delta(current.start.snapped,route.start.snapped)>.1||delta(current.end.snapped,route.end.snapped)>.1)return null;
  const before=current.path.at(-1),after=route.path.at(-1),goal=current.end.snapped;
  const remainingBefore=delta(before,goal),remainingAfter=delta(after,goal),gain=remainingBefore-remainingAfter;
  if(!Number.isFinite(gain)||gain<minimumGain||delta(before,after)<minimumGain)return null;
  return {kind:'partial-route-progress',endpointBefore:[...before],endpointAfter:[...after],
    remainingBefore:round(remainingBefore),remainingAfter:round(remainingAfter),gain:round(gain),minimumGain:round(minimumGain)};
}
export const navigationRecoveryCandidate=c=>Boolean(c.eligibility.eligible&&!c.alreadyRequested&&
  (c.counterfactual.reachable||c.counterfactual.progress?.kind==='partial-route-progress'));
const routePriority=c=>c.counterfactual.reachable?2:c.counterfactual.progress?1:0;

const articulationEligibility = (record, partName, action) => {
  const part = record?.manifest?.parts?.[partName];
  if (!part?.actions?.includes(action) || !Number.isFinite(part.targets?.[action]) || !part.physics || !part.joint) {
    return { eligible:false, status:'not-executable', reason:'ACTION_NOT_EXECUTABLE' };
  }
  if (record.manifest.source?.kind !== 'compiled') {
    return { eligible:true, status:'declared-executable', evidence:'manifest' };
  }
  const verification = record.manifest.verification?.articulation;
  const partReport = verification?.parts?.find((item) => item.part === partName);
  const actionReport = partReport?.actions?.find((item) => item.action === action);
  if (verification?.ok && partReport?.ok && actionReport?.ok) {
    return { eligible:true, status:'runtime-verified', evidence:'verification.articulation' };
  }
  return { eligible:false, status:'unverified', reason:'ARTICULATION_UNVERIFIED' };
};

export class NavigationSystem {
  constructor({ store, physics = null, environmentRoots = [], nativeEnvironmentColliders = null, config = {}, backend } = {}) {
    if (!backend) throw new TypeError('NavigationSystem requires a navigation backend');
    this.store = store;
    this.physics = physics;
    this.environmentRoots = [...environmentRoots];
    this.nativeEnvironmentColliders=nativeEnvironmentColliders;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.backend = backend;
    this.obstacles = new Map();
    this.obstacleSyncVersion = 0;
    this.lastObstacleSync = null;
    this.dirty = true;
    this.revision = 0;
    this.buildVersion = 0;
    this.buildPromise = null;
    this.lastInvalidation = 'initial';
    this.lastBuild = null;
    this.disposed = false;
  }

  isStaticRecord(record) { return record?.manifest?.physics?.body === 'fixed'; }

  invalidate(reason = 'world-changed') {
    this.dirty = true;
    this.revision += 1;
    this.lastInvalidation = reason;
  }

  invalidateIfStatic(record, reason) {
    if (!this.isStaticRecord(record)) return false;
    this.invalidate(reason);
    return true;
  }

  runtimeCapabilities() {
    const capabilities=['action-aware-diagnostics'];
    const hasObstacleSource=typeof this.physics?.getNavigationObstacles==='function';
    if(hasObstacleSource&&this.backend.hasCapability?.('dynamic-obstacles')&&this.backend.hasCapability?.('obstacle-suppression')) capabilities.push('counterfactual-routing');
    return capabilities;
  }

  profile() {
    const backendProfile=this.backend.profile?.()||{identity:'unknown',capabilities:[]};
    const backendCapabilities=[...(backendProfile.capabilities||[])];
    const runtimeCapabilities=this.runtimeCapabilities();
    return {
      identity:backendProfile.identity,
      backendCapabilities,
      runtimeCapabilities,
      capabilities:[...new Set([...backendCapabilities,...runtimeCapabilities])]
    };
  }

  status() {
    const backendProfile=this.profile();
    const backendReady=this.backend.isReady?.()===true;
    const hasObstacleSource=typeof this.physics?.getNavigationObstacles==='function'||this.physics?.hasCapability?.('collision')===true;
    const dynamicObstacles=this.backend.hasCapability?.('dynamic-obstacles')===true&&hasObstacleSource;
    return {
      state: !backendReady ? (this.lastBuild?.success === false ? 'failed' : 'unbuilt') : this.dirty ? 'dirty' : 'ready',
      dirty: this.dirty,
      buildVersion: this.buildVersion,
      lastInvalidation: this.lastInvalidation,
      config: { ...this.config },
      backend:backendProfile,
      capabilities: {
        staticRouting:this.backend.hasCapability?.('static-routing')===true,
        dynamicObstacles,
        routeQuery:this.backend.hasCapability?.('route-query')===true,
        obstacleSuppression:this.backend.hasCapability?.('obstacle-suppression')===true,
        obstacleSource:dynamicObstacles
          ? `physics:${this.physics?.profile?.().identity || 'unknown'}:colliders`
          : 'none',
        synchronization:'query-time',
        actionAwareDiagnostics:this.runtimeCapabilities().includes('action-aware-diagnostics'),
        counterfactual:this.runtimeCapabilities().includes('counterfactual-routing')?'single-obstacle-suppression':'none'
      },
      dynamicObstacles:{ tracked:this.obstacles.size, syncVersion:this.obstacleSyncVersion, lastSync:this.lastObstacleSync ? structuredClone(this.lastObstacleSync) : null },
      lastBuild: this.lastBuild ? structuredClone(this.lastBuild) : null
    };
  }

  collectStaticMeshes() {
    const meshes = [];
    const skipped = [];
    const seen = new Set();
    const collect = (root, source, excludedPartNodes = new Set()) => {
      root.updateWorldMatrix?.(true, true);
      root.traverse?.((node) => {
        if (!node.isMesh || seen.has(node) || node.userData?.navigationIgnore) return;
        seen.add(node);
        for (let current = node; current && current !== root.parent; current = current.parent) {
          if (excludedPartNodes.has(current.name)) {
            skipped.push({ source, node:node.name || null, reason:'dynamic-part' });
            return;
          }
          if (current === root) break;
        }
        if (!node.visible || node.isSkinnedMesh || node.isInstancedMesh || !node.geometry?.getAttribute?.('position')) {
          skipped.push({ source, node: node.name || null, reason: node.isSkinnedMesh ? 'skinned' : node.isInstancedMesh ? 'instanced' : 'unsupported' });
          return;
        }
        meshes.push(node);
      });
    };

    this.environmentRoots.forEach((root, index) => collect(root, `environment:${index}`));
    for (const [id, record] of this.store?.entries?.() || []) {
      if (!this.isStaticRecord(record)) continue;
      const excludedPartNodes = new Set(
        Object.values(record.manifest.parts || {})
          .filter((part) => part?.joint || (part?.physics?.body && part.physics.body !== 'fixed'))
          .map((part) => part.node)
          .filter(Boolean)
      );
      collect(record.object, id, excludedPartNodes);
    }
    return { meshes, skipped };
  }

  async rebuild() {
    if (this.disposed) return { success:false, code:'NAVIGATION_DISPOSED' };
    const revision=this.revision;
    const startedAt=Date.now();
    const {meshes,skipped}=this.collectStaticMeshes();
    let inputs,nativeInputCount=0;
    try{
      const budget={triangles:0,vertices:0,colliders:0};
      const nativeInputs=[...nativeColliderNavigationInputs(this.nativeEnvironmentColliders||[],undefined,budget),...nativeFixedNavigationInputs(this.physics,budget)];
      nativeInputCount=nativeInputs.length;
      inputs=[...geometryInputs(meshes),...nativeInputs];
      if(this.nativeEnvironmentColliders!==null||nativeInputCount)validateNativeNavigationInputs(inputs);
    }catch(error){
      this.backend.clear?.();this.obstacles.clear();
      this.lastBuild={success:false,code:error.code||'NATIVE_NAVIGATION_GEOMETRY_INVALID',meshCount:meshes.length,skipped,at:new Date().toISOString()};
      return this.lastBuild;
    }
    if(!inputs.length){
      this.backend.clear?.();
      this.obstacles.clear();
      this.lastBuild={success:false,code:'NAVMESH_EMPTY',meshCount:0,skipped,at:new Date().toISOString()};
      return this.lastBuild;
    }

    const result=await this.backend.build(inputs,this.config);
    if(this.disposed||revision!==this.revision){
      this.backend.clear?.();
      this.obstacles.clear();
      return {success:false,code:'NAVMESH_CHANGED_DURING_BUILD'};
    }
    if(!result?.success){
      this.obstacles.clear();
      this.lastBuild={
        success:false,
        code:result?.code||'NAVMESH_BUILD_FAILED',
        ...(result?.error?{error:result.error}:{}),
        meshCount:meshes.length+nativeInputCount,...(nativeInputCount?{nativeColliderCount:nativeInputCount}:{}),skipped,at:new Date().toISOString()
      };
      return this.lastBuild;
    }

    this.obstacles.clear();
    this.dirty=false;
    this.buildVersion+=1;
    this.lastBuild={
      success:true,
      buildVersion:this.buildVersion,
      meshCount:meshes.length+nativeInputCount,
      ...(nativeInputCount?{nativeColliderCount:nativeInputCount}:{}),
      skipped,
      durationMs:Date.now()-startedAt,
      at:new Date().toISOString()
    };
    return this.lastBuild;
  }

  async ensureBuilt() {
    if(this.disposed) return {success:false,code:'NAVIGATION_DISPOSED'};
    if(!this.dirty&&this.backend.isReady?.()) return this.lastBuild;
    if(!this.buildPromise) this.buildPromise=this.rebuild().finally(()=>{this.buildPromise=null;});
    return this.buildPromise;
  }

  reconcileDynamicObstacles() {
    if(!this.backend.hasCapability?.('dynamic-obstacles')||typeof this.physics?.getNavigationObstacles!=='function'){
      if(this.backend.isReady?.()) this.backend.syncObstacles?.([]);
      this.obstacles.clear();
      const result={success:true,coverage:'none',tracked:0,skipped:[],changed:0,operations:0,updates:0,syncVersion:this.obstacleSyncVersion};
      this.lastObstacleSync=result;
      return result;
    }

    const snapshot=this.physics.getNavigationObstacles();
    const synced=this.backend.syncObstacles(snapshot.items||[]);
    this.obstacles=new Map((synced.descriptors||[]).map((descriptor)=>[descriptor.id,structuredClone(descriptor)]));
    if(!synced.success) return this.obstacleSyncFailure(synced.code,snapshot,synced.changed||0,synced.operations||0,synced.updates||0);
    if(synced.changed) this.obstacleSyncVersion+=1;
    const result={
      success:true,
      coverage:snapshot.skipped?.length?'partial':'complete',
      tracked:this.obstacles.size,
      skipped:structuredClone(snapshot.skipped||[]),
      changed:synced.changed||0,
      operations:synced.operations||0,
      updates:synced.updates||0,
      syncVersion:this.obstacleSyncVersion
    };
    this.lastObstacleSync=result;
    return result;
  }

  obstacleSyncFailure(code, snapshot, changed, operations, updates) {
    const result = { success:false, code, coverage:'partial', tracked:this.obstacles.size, skipped:structuredClone(snapshot.skipped || []), changed, operations, updates, syncVersion:this.obstacleSyncVersion };
    this.lastObstacleSync = result;
    return result;
  }

  async ensureCurrent() {
    const build=await this.ensureBuilt();
    if(!build?.success||!this.backend.isReady?.()) return {success:false,code:build?.code||'NAVMESH_UNAVAILABLE',build};
    const obstacles=this.reconcileDynamicObstacles();
    if(!obstacles.success) return {success:false,code:obstacles.code,build,obstacles};
    return {success:true,build,obstacles};
  }

  queryHalfExtents(maxSnapDistance) {
    const horizontal=Math.max(maxSnapDistance,this.config.agentRadius*2);
    return {x:horizontal,y:Math.max(this.config.agentHeight,maxSnapDistance),z:horizontal};
  }

  queryReadyPath(start,end,{maxSnapDistance,endTolerance,scope,build,dynamicObstacles,suppressedObstacleIds=[],replacementObstacles=null}) {
    const raw=this.backend.queryPath(start,end,{halfExtents:this.queryHalfExtents(maxSnapDistance),suppressedObstacleIds,...(replacementObstacles?{replacementObstacles}:{})});
    if(!raw?.success){
      return {reachable:false,scope,reason:raw?.code||'NAVIGATION_QUERY_FAILED',sameIsland:null,path:[],cost:null,buildVersion:build?.buildVersion||this.buildVersion,dynamicObstacles};
    }
    const project=(input,result)=>{
      if(!result?.success) return {success:false,input:point(input),reason:'NAVMESH_QUERY_FAILED'};
      const inputPoint=point(input);
      const snapDistance=distance(inputPoint,result.point);
      if(snapDistance>maxSnapDistance) return {success:false,reason:'OFF_NAVMESH',input:inputPoint,point:result.point,snapDistance};
      return {success:true,input:inputPoint,point:result.point,snapDistance};
    };
    const projectedStart=project(start,raw.start);
    if(!projectedStart.success) return this.offMeshResult('START_OFF_NAVMESH',projectedStart,build,scope,dynamicObstacles);
    const projectedEnd=project(end,raw.end);
    if(!projectedEnd.success) return this.offMeshResult('END_OFF_NAVMESH',projectedEnd,build,scope,dynamicObstacles);

    const computed=raw.computed||{success:false,path:[]};
    const rawPath=computed.path||[];
    const finalDistance=rawPath.length?distance(rawPath.at(-1),projectedEnd.point):Infinity;
    const reachable=computed.success&&rawPath.length>0&&finalDistance<=endTolerance;
    const reason=reachable?null:computed.success&&rawPath.length?'PARTIAL_PATH':'NO_PATH';
    return {
      reachable,
      scope,
      reason,
      sameIsland:reachable?true:reason==='PARTIAL_PATH'?false:null,
      start:{input:[...start],snapped:roundPoint(projectedStart.point),snapDistance:round(projectedStart.snapDistance)},
      end:{input:[...end],snapped:roundPoint(projectedEnd.point),snapDistance:round(projectedEnd.snapDistance)},
      path:rawPath.map(roundPoint),
      cost:rawPath.length?round(pathCost(rawPath)):null,
      finalDistance:Number.isFinite(finalDistance)?round(finalDistance):null,
      buildVersion:this.buildVersion,
      dynamicObstacles,
      ...(computed.error?{error:computed.error}: {})
    };
  }

  async findPath(start, end, { maxSnapDistance = this.config.maxSnapDistance, endTolerance = this.config.endTolerance } = {}) {
    const scope = this.physics?.getNavigationObstacles ? 'current' : 'static';
    if (!finitePoint(start) || !finitePoint(end) || !Number.isFinite(maxSnapDistance) || maxSnapDistance < 0) {
      return { reachable:false, scope, reason:'INVALID_INPUT', path:[], cost:null, sameIsland:null };
    }
    const current = await this.ensureCurrent();
    if (!current.success || !this.backend.isReady?.()) return { reachable:false, scope, reason:current.code, path:[], cost:null, sameIsland:null, build:current.build, dynamicObstacles:current.obstacles || null };
    return this.queryReadyPath(start, end, { maxSnapDistance, endTolerance, scope, build:current.build, dynamicObstacles:current.obstacles });
  }

  actionableObstacleGroups() {
    const groups = new Map();
    for (const [obstacleId, descriptor] of this.obstacles) {
      if (!descriptor?.objectId || !descriptor?.part || descriptor.part === '$root') continue;
      const record=this.store?.has?.(descriptor.objectId)?this.store.get(descriptor.objectId):null;
      const nativeEntry=this.physics?.entries?.get(descriptor.objectId);
      const nativePart=nativeEntry?.nativeArticulation?nativeEntry.parts.get(descriptor.part):null;
      const part=record?.manifest.parts?.[descriptor.part];
      if(!nativePart&&(!part?.actions?.includes('open')||!Number.isFinite(part.targets?.open)))continue;
      if(nativePart&&!this.backend.hasCapability?.('obstacle-replacement'))continue;
      const key = `${descriptor.objectId}:${descriptor.part}`;
      if (!groups.has(key)) groups.set(key, { objectId:descriptor.objectId, partName:descriptor.part, record, nativePart, obstacleIds:[], descriptors:[] });
      const group = groups.get(key);
      group.obstacleIds.push(obstacleId);
      group.descriptors.push(descriptor);
    }
    return [...groups.values()];
  }

  counterfactualWithout(group,start,end,options,build) {
    return {
      ...this.queryReadyPath(start,end,{
        ...options,
        scope:'counterfactual',
        build,
        suppressedObstacleIds:group.obstacleIds,
        dynamicObstacles:{assumption:'obstacle-suppressed',suppressed:[...group.obstacleIds],provisional:true}
      }),
      provisional:true,
      assumption:'obstacle-suppressed'
    };
  }

  nativeJointCandidates(group,start,end,options,current){
    const state=this.physics.getArticulationState(group.objectId,group.partName);
    if(!state?.limits)return [];
    const action=state.jointType==='prismatic'?'slide':'rotateJoint';
    const candidates=[];
    for(const target of state.limits){
      if(this.dirty)break;
      if(Math.abs(target-state.coordinate)<=state.tolerance*1.5)continue;
      const base={objectId:group.objectId,partName:group.partName,source:'native-physics',action,target,
        currentCoordinate:round(state.coordinate),obstacleIds:[...group.obstacleIds],distanceToPartialEndpoint:round(group.distance)};
      const rejected=(reason,counterfactual={})=>({...base,eligibility:{eligible:false,reason},alreadyRequested:false,
        counterfactual:{provisional:true,assumption:'joint-target-pose',reachable:false,...counterfactual}});
      const pose=this.physics.nativeNavigationJointPose(group.objectId,group.partName,target);
      if(!pose.checked||pose.descriptors.length!==group.obstacleIds.length||
        pose.descriptors.some(item=>!group.obstacleIds.includes(item.id))){
        candidates.push(rejected(pose.reason||'NATIVE_NAVIGATION_OBSTACLE_COVERAGE_INCOMPLETE'));continue;
      }
      let route;
      try{
        route=this.queryReadyPath(start,end,{...options,scope:'counterfactual',build:this.lastBuild,
          replacementObstacles:pose.descriptors,dynamicObstacles:{assumption:'joint-target-pose',provisional:true}});
      }catch(error){
        const restored=this.reconcileDynamicObstacles();
        if(!restored.success)this.invalidate('counterfactual-restore-failed');
        candidates.push(rejected(error.message));continue;
      }
      const progress=route.reachable?null:partialRouteProgress(current,route,Math.max(.5,2*this.config.agentRadius,2*options.endTolerance));
      const counterfactual={provisional:true,assumption:'joint-target-pose',reachable:route.reachable,reason:route.reason,
        cost:route.cost,waypointCount:route.path.length,finalDistance:route.finalDistance??null,
        ...(progress?{progress}:{})};
      if(!route.reachable&&!progress){candidates.push(rejected('TARGET_POSE_DOES_NOT_UNLOCK_ROUTE',counterfactual));continue;}
      const sweep=this.physics.articulationWorldCounterfactual(group.objectId,group.partName,target);
      const eligible=sweep.checked&&sweep.actionIntroducesNoCollision===true;
      candidates.push({...base,eligibility:{eligible:Boolean(eligible),status:eligible?'declared-numeric-joint':'ineligible',
        ...(!eligible?{reason:sweep.reason||'JOINT_SWEEP_INTRODUCES_COLLISION'}:{})},
        alreadyRequested:false,counterfactual,
        sweep:{checked:sweep.checked,samples:sweep.samples,actionIntroducesNoCollision:sweep.actionIntroducesNoCollision,
          blockers:sweep.actionEnvelope?.introducedBlockers?.slice(0,8)||[]}});
    }
    return candidates.sort((a,b)=>Number(b.eligibility.eligible)-Number(a.eligibility.eligible)||
      Math.abs(a.target-state.coordinate)-Math.abs(b.target-state.coordinate));
  }

  async suggestActions(start, end, { maxSnapDistance = this.config.maxSnapDistance, maxCandidates = 6 } = {}) {
    const endTolerance = this.config.endTolerance;
    const current = await this.findPath(start, end, { maxSnapDistance, endTolerance });
    if (current.reachable) return { status:'reachable', current, candidates:[], recommendation:null };
    if (!['PARTIAL_PATH','NO_PATH'].includes(current.reason)) return { status:'unresolved', current, candidates:[], recommendation:null };

    const anchor = current.path.at(-1) || start;
    const groups = this.actionableObstacleGroups().map((group) => ({
      ...group,
      distance:Math.min(...group.descriptors.map((descriptor) => obstacleDistanceXZ(anchor, descriptor)))
    })).sort((a, b) => a.distance - b.distance).slice(0, Math.max(1, Math.min(8, maxCandidates)));

    const candidates = [];
    for (const group of groups) {
      if(this.dirty)break;
      if(group.nativePart){
        candidates.push(...this.nativeJointCandidates(group,start,end,{maxSnapDistance,endTolerance},current));
        continue;
      }
      const eligibility = articulationEligibility(group.record, group.partName, 'open');
      const requested = group.record.state?.partTargets?.[group.partName] === 'open' || group.record.state?.parts?.[group.partName] === 'open';
      let counterfactual;
      try {
        counterfactual = this.counterfactualWithout(group, start, end, { maxSnapDistance, endTolerance }, current.build || this.lastBuild);
      } catch (error) {
        const recovery = this.reconcileDynamicObstacles();
        counterfactual = {
          reachable:false,
          provisional:true,
          assumption:'obstacle-suppressed',
          reason:error.message,
          recovery:recovery.success ? 'restored-current-world' : recovery.code
        };
      }
      candidates.push({
        objectId:group.objectId,
        partName:group.partName,
        action:'open',
        obstacleIds:[...group.obstacleIds],
        distanceToPartialEndpoint:round(group.distance),
        eligibility,
        alreadyRequested:requested,
        counterfactual:{
          provisional:true,
          assumption:'obstacle-suppressed',
          reachable:Boolean(counterfactual.reachable),
          reason:counterfactual.reason || null,
          cost:counterfactual.cost ?? null,
          waypointCount:counterfactual.path?.length ?? 0
        }
      });
    }

    if(this.dirty)return {status:'unresolved',current,candidates:[],recommendation:null,reason:'NAVIGATION_COUNTERFACTUAL_RESTORE_FAILED'};
    // Full unlocks outrank partial progress; among partials prefer the larger
    // measured gain. Stable ties retain the existing nearest-obstacle ordering.
    candidates.sort((a,b)=>Number(navigationRecoveryCandidate(b))-Number(navigationRecoveryCandidate(a))||
      routePriority(b)-routePriority(a)||(b.counterfactual.progress?.gain||0)-(a.counterfactual.progress?.gain||0));
    const recommended = candidates.find(navigationRecoveryCandidate) || null;
    const waiting = !recommended && candidates.find((candidate) => candidate.alreadyRequested && candidate.counterfactual.reachable);
    return {
      status:recommended ? 'action-candidate' : waiting ? 'waiting-for-world-update' : 'blocked',
      current,
      candidates,
      recommendation:recommended ? {
        ...(recommended.source==='native-physics'?{interaction:{action:'invoke',target:recommended.objectId,source:'native-physics',
          name:recommended.action,partName:recommended.partName,args:{target:recommended.target}}}:
          {call:{ name:'open', args:{ id:recommended.objectId, partName:recommended.partName } }}),
        ...(recommended.counterfactual.progress?{progress:recommended.counterfactual.progress}:{}),
        then:{ name:'findPath', args:{ start:[...start], end:[...end] }, condition:'after-world-state-changes' },
        provisional:true
      } : null
    };
  }

  offMeshResult(reason, projected, build, scope = 'static', dynamicObstacles = null) {
    return {
      reachable: false,
      scope,
      reason,
      sameIsland: null,
      path: [],
      cost: null,
      snapDistance: Number.isFinite(projected.snapDistance) ? round(projected.snapDistance) : null,
      snapped: projected.point ? roundPoint(projected.point) : null,
      buildVersion: build?.buildVersion || this.buildVersion,
      dynamicObstacles
    };
  }

  async canReach(start, end, options) {
    const result = await this.findPath(start, end, options);
    const { path, ...summary } = result;
    return { ...summary, waypointCount: path.length };
  }

  debugGeometry() { return this.backend.debugGeometry?.() || []; }

  debugSnapshot() {
    const mesh = this.backend.debugMesh?.() || { positions:this.debugGeometry(), indices:[] };
    return {
      schemaVersion: 1,
      source: "navigation",
      status: this.status(),
      navMesh: {
        positions: [...(mesh.positions || [])],
        indices: [...(mesh.indices || [])],
        vertexCount: Math.floor((mesh.positions?.length || 0) / 3),
        triangleCount: mesh.indices?.length
          ? Math.floor(mesh.indices.length / 3)
          : Math.floor((mesh.positions?.length || 0) / 9)
      },
      obstacles: [...this.obstacles.values()].map((descriptor) => structuredClone(descriptor))
    };
  }

  dispose() {
    this.disposed = true;
    this.revision += 1;
    this.backend.dispose?.();
    this.obstacles.clear();
    this.dirty = true;
    this.buildPromise = null;
  }
}
