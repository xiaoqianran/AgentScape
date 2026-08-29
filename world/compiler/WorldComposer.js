import { assetIdFromRef } from '../../asset/AssetRef.js';

const rootColliderExtent = (spec) => {
  const t=spec.translation || [0,0,0];
  if (spec.shape==='box' && spec.halfExtents?.length===3) {
    const [hx,hy,hz]=spec.halfExtents;
    return {radius:Math.hypot(t[0],t[2])+Math.hypot(hx,hz),minY:t[1]-hy};
  }
  if (spec.shape==='cylinder' && Number.isFinite(spec.radius) && Number.isFinite(spec.halfHeight)) {
    return {radius:Math.hypot(t[0],t[2])+spec.radius,minY:t[1]-spec.halfHeight};
  }
  if (spec.shape==='capsule' && Number.isFinite(spec.radius) && Number.isFinite(spec.halfHeight)) {
    return {radius:Math.hypot(t[0],t[2])+spec.radius,minY:t[1]-(spec.halfHeight+spec.radius)};
  }
  if (spec.shape==='convexHull' && Array.isArray(spec.vertices)) {
    let radius=0,minY=Infinity;
    for(let i=0;i+2<spec.vertices.length;i+=3) {
      radius=Math.max(radius,Math.hypot(t[0]+spec.vertices[i],t[2]+spec.vertices[i+2]));
      minY=Math.min(minY,t[1]+spec.vertices[i+1]);
    }
    if (Number.isFinite(minY)) return {radius,minY};
  }
  return null;
};

export function manifestFootprint(manifest) {
  const colliders=manifest?.physics?.colliders || [];
  if (!colliders.length) return {checked:false,reason:'ROOT_COLLIDER_UNAVAILABLE'};
  let radius=.01,minY=Infinity;
  for(const collider of colliders) {
    const extent=rootColliderExtent(collider);
    if (!extent) return {checked:false,reason:'ROOT_COLLIDER_UNSUPPORTED',shape:collider.shape || null};
    radius=Math.max(radius,extent.radius);
    minY=Math.min(minY,extent.minY);
  }
  return {
    checked:true,radius,minY,
    coverage:Object.values(manifest.parts || {}).some((part)=>part.physics?.colliders?.length)?'root-only':'full-root'
  };
}

const candidatePoints = ({minX,maxX,minZ,maxZ,step=1}) => {
  const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;
  const nx=Math.max(0,Math.floor((maxX-minX)/(2*step)));
  const nz=Math.max(0,Math.floor((maxZ-minZ)/(2*step)));
  const values=[];
  for(let ix=-nx;ix<=nx;ix++) for(let iz=-nz;iz<=nz;iz++) {
    const x=cx+ix*step,z=cz+iz*step;
    if(x<minX-1e-9||x>maxX+1e-9||z<minZ-1e-9||z>maxZ+1e-9) continue;
    values.push({x,z,d2:(x-cx)**2+(z-cz)**2});
  }
  return values.sort((a,b)=>a.d2-b.d2 || a.z-b.z || a.x-b.x);
};

const circlesOverlap=(a,b,clearance)=>Math.hypot(a.x-b.x,a.z-b.z)<a.radius+b.radius+clearance-1e-9;

const normalizeLayout=(layout)=>{
  if(!layout?.bounds || !Number.isFinite(layout.groundY)) return {checked:false,reason:'WORLD_LAYOUT_UNAVAILABLE'};
  const [minX,minZ]=layout.bounds.min || [],[maxX,maxZ]=layout.bounds.max || [];
  if(![minX,minZ,maxX,maxZ].every(Number.isFinite) || minX>=maxX || minZ>=maxZ) return {checked:false,reason:'WORLD_LAYOUT_INVALID'};
  return {checked:true,minX,minZ,maxX,maxZ,groundY:layout.groundY,margin:Number.isFinite(layout.margin)?Math.max(0,layout.margin):.5};
};

const checkPosition=(manifest,footprint,position,{layout,reserved=[],poseClear,clearance=.35}={})=>{
  const circle={x:position[0],z:position[2],radius:footprint.radius};
  if(circle.x-footprint.radius<layout.minX+layout.margin || circle.x+footprint.radius>layout.maxX-layout.margin || circle.z-footprint.radius<layout.minZ+layout.margin || circle.z+footprint.radius>layout.maxZ-layout.margin) return {checked:true,clear:false,reason:'OUTSIDE_LAYOUT_BOUNDS',circle};
  if(reserved.some((other)=>circlesOverlap(circle,other,clearance))) return {checked:true,clear:false,reason:'BATCH_FOOTPRINT_OVERLAP',circle};
  const physics=poseClear?.(manifest,position);
  if(!physics?.checked) return {checked:false,clear:false,reason:physics?.reason || 'LAYOUT_PHYSICS_UNAVAILABLE',circle,physics};
  if(!physics.clear) return {checked:true,clear:false,reason:'WORLD_POSE_BLOCKED',blockedBy:physics.blockedBy || [],circle,physics};
  return {checked:true,clear:true,circle,physics};
};

export function preflightWorldPosition(manifest,position,{layout,poseClear,occupied=[],clearance=.35}={}){
  const normalized=normalizeLayout(layout);
  if(!normalized.checked) return normalized;
  if(!Array.isArray(position) || position.length!==3 || !position.every(Number.isFinite)) return {checked:false,reason:'WORLD_POSITION_INVALID'};
  const footprint=manifestFootprint(manifest);
  if(!footprint.checked) return footprint;
  const reserved=[];
  for(const item of occupied){
    if(!item?.manifest || !Array.isArray(item.position) || item.position.length!==3) return {checked:false,reason:'OCCUPIED_POSITION_INVALID'};
    const other=manifestFootprint(item.manifest);
    if(!other.checked) return {checked:false,reason:other.reason,occupiedId:item.id || null};
    reserved.push({x:item.position[0],z:item.position[2],radius:other.radius});
  }
  const verdict=checkPosition(manifest,footprint,position,{layout:normalized,reserved,poseClear,clearance});
  return {...verdict,coverage:footprint.coverage,status:verdict.clear?(footprint.coverage==='root-only'?'provisional':'ready'):'rejected'};
}

export function composeWorldLayout(requests,{getManifest,poseClear,layout,clearance=.35}={}) {
  const normalized=normalizeLayout(layout);
  if(!normalized.checked) return {status:'rejected',reason:normalized.reason,placements:[],issues:[]};
  const {minX,minZ,maxX,maxZ,groundY,margin}=normalized;
  const reserved=[]; const placements=[]; const issues=[];
  let provisional=false;

  for(const request of requests) {
    const assetId=assetIdFromRef(request.assetRef);
    if (!assetId) continue;
    const manifest=getManifest(assetId);
    const footprint=manifestFootprint(manifest);
    if (!footprint.checked) return {status:'rejected',reason:footprint.reason,placements,issues:[...issues,{id:request.id || null,assetId,reason:footprint.reason}]};
    if (footprint.coverage==='root-only') { provisional=true; issues.push({id:request.id || null,assetId,reason:'ARTICULATED_LAYOUT_ROOT_ONLY'}); }
    const groundPositionY=groundY-footprint.minY+.01;
    const test=(position)=>{
      const verdict=checkPosition(manifest,footprint,position,{layout:normalized,reserved,poseClear,clearance});
      return verdict.clear?{ok:true,circle:verdict.circle,physics:verdict.physics}:{ok:false,reason:verdict.reason,blockedBy:verdict.blockedBy || []};
    };

    let position=request.position ? [...request.position] : null;
    let mode='explicit';
    const explicitGroundY=groundY-footprint.minY;
    if(position && Math.abs(position[1]-explicitGroundY)<=.03) {
      position[1]=Number(groundPositionY.toFixed(4));
      mode='explicit-grounded';
    }
    let verdict=position ? test(position) : null;
    if (!position) {
      mode='auto';
      const autoY=groundPositionY;
      const step=Math.max(.5,Math.min(2,footprint.radius));
      for(const point of candidatePoints({minX:minX+margin+footprint.radius,maxX:maxX-margin-footprint.radius,minZ:minZ+margin+footprint.radius,maxZ:maxZ-margin-footprint.radius,step})) {
        const candidate=[Number(point.x.toFixed(4)),Number(autoY.toFixed(4)),Number(point.z.toFixed(4))];
        const result=test(candidate);
        if (result.ok) { position=candidate; verdict=result; break; }
      }
    }
    if (!position || !verdict?.ok) return {status:'rejected',reason:verdict?.reason || 'NO_LAYOUT_POSITION',placements,issues:[...issues,{id:request.id || null,assetId,reason:verdict?.reason || 'NO_LAYOUT_POSITION',blockedBy:verdict?.blockedBy || []}]};
    reserved.push(verdict.circle);
    placements.push({id:request.id || null,assetId,position,mode,radius:Number(footprint.radius.toFixed(4)),coverage:footprint.coverage});
  }
  return {status:provisional?'provisional':'ready',reason:provisional?'ARTICULATED_LAYOUT_ROOT_ONLY':null,placements,issues};
}


export function composeNearPlacement(subjectManifest,targetManifest,targetPosition,{subjectY=0,distance=null,poseClear,clearance=.35}={}) {
  const subject=manifestFootprint(subjectManifest),target=manifestFootprint(targetManifest);
  if (!subject.checked) return {checked:false,reason:subject.reason,source:'subject-footprint'};
  if (!target.checked) return {checked:false,reason:target.reason,source:'target-footprint'};
  const minimum=subject.radius+target.radius+clearance;
  const spacing=distance == null ? minimum : Number(distance);
  if (!Number.isFinite(spacing) || spacing<=0) return {checked:false,reason:'NEAR_DISTANCE_INVALID'};
  if (spacing+1e-9<minimum) return {checked:false,reason:'NEAR_DISTANCE_TOO_SMALL',minimumDistance:minimum,requestedDistance:spacing};
  const [x,,z]=targetPosition;
  const candidates=[[x+spacing,subjectY,z],[x-spacing,subjectY,z],[x,subjectY,z+spacing],[x,subjectY,z-spacing]];
  const blocked=[];
  for (const position of candidates) {
    const result=poseClear(subjectManifest,position);
    if (result?.checked && result.clear) return {
      checked:true,position:position.map((v)=>Number(v.toFixed(4))),distance:Number(spacing.toFixed(4)),
      mode:distance == null?'runtime-derived':'explicit',coverage:subject.coverage
    };
    blocked.push({position,reason:result?.reason || (result?.checked?'WORLD_POSE_BLOCKED':'LAYOUT_PHYSICS_UNAVAILABLE'),blockedBy:result?.blockedBy || []});
  }
  return {checked:false,reason:'NEAR_NO_CLEAR_POSE',distance:spacing,blocked};
}
