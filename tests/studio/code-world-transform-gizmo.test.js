import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {CodeWorldTransformGizmo} from '../../apps/studio/editor/CodeWorldTransformGizmo.js';

beforeEach(()=>{
  vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()});
});
afterEach(()=>vi.unstubAllGlobals());

const fixture=({source='code',properties=['position','quaternion','scale'],parent=null}={})=>{
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(55,1,0.1,1000);
  camera.position.set(12,9,14);camera.lookAt(0,0,0);
  const owner=parent||scene;
  if(parent)scene.add(parent);
  const target=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial());
  owner.add(target);
  const element={style:{},addEventListener:vi.fn(),removeEventListener:vi.fn()};
  let revision=4;
  const calls=[],completed=[],previews=[];
  const gizmo=new CodeWorldTransformGizmo({
    scene,camera,element,getObject:id=>id==='tower'?target:null,
    getRevision:()=>revision,
    onCommit:async request=>{
      calls.push(request);
      const {operation,expectedRevision}=request;
      if(expectedRevision!==revision)throw Error('REVISION_CONFLICT');
      if(operation.type==='editNative'){
        if(operation.changes.position)target.position.fromArray(operation.changes.position);
        if(operation.changes.quaternion)target.quaternion.fromArray(operation.changes.quaternion);
        if(operation.changes.scale)target.scale.fromArray(operation.changes.scale);
      }else{
        target.position.fromArray(operation.transform.position);
        target.quaternion.fromArray(operation.transform.quaternion);
        target.scale.setScalar(operation.transform.scale);
      }
      revision++;
    },
    onPreview:event=>previews.push(event),onFinish:event=>completed.push(event)
  });
  gizmo.select({id:'tower',source,properties});
  const start=()=>{
    gizmo.control.dragging=true;
    expect(gizmo.dragging).toBe(true);
    expect(gizmo.drag.revision).toBe(revision);
  };
  const finish=async()=>{
    gizmo.control.dragging=false;
    await vi.waitFor(()=>expect(gizmo.pending).toBe(false));
  };
  return {scene,camera,target,gizmo,calls,completed,previews,start,finish,close:()=>gizmo.dispose(),incrementRevision:()=>revision++};
};

describe('code world TransformControls uses a preview pivot and a single Scene write',()=>{
  it('never changes the native Object3D until release, then submits one revision-protected editNative',async()=>{
    const f=fixture();
    try{
      expect(f.gizmo.pivot).not.toBe(f.target);
      expect(f.gizmo.helper.parent).toBe(f.scene);
      f.start();
      f.gizmo.pivot.position.x+=3.5;
      f.gizmo.control.dispatchEvent({type:'objectChange'});
      expect(f.target.position.x).toBe(0);
      expect(f.gizmo.outline.matrix.elements[12]).toBeCloseTo(3.5);
      await f.finish();
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]).toMatchObject({expectedRevision:4,
        operation:{type:'editNative',id:'tower',changes:{position:[3.5,0,0]}}});
      expect(f.target.position.x).toBeCloseTo(3.5);
      expect(f.completed.at(-1).committed).toBe(true);
      expect(f.gizmo.dragging).toBe(false);
    }finally{f.close();}
  });

  it('respects edit permissions and rotates code objects without overwriting their other properties',async()=>{
    const f=fixture({properties:['quaternion']});
    try{
      expect(f.gizmo.mode).toBe('rotate');
      expect(f.gizmo.setMode('translate')).toBe(false);
      f.start();
      f.gizmo.pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2);
      await f.finish();
      expect(f.calls[0].operation.changes).toEqual({
        quaternion:expect.arrayContaining([expect.any(Number),expect.any(Number)])
      });
      expect(Object.keys(f.calls[0].operation.changes)).toEqual(['quaternion']);
      expect(f.target.position.toArray()).toEqual([0,0,0]);
      expect(f.target.quaternion.y).toBeCloseTo(Math.sin(Math.PI/4));
    }finally{f.close();}
  });

  it('updates managed models via setTransform, preserving local transform with a rotated parent',async()=>{
    const parent=new THREE.Group();
    parent.position.set(5,0,2);
    parent.rotation.y=Math.PI/2;
    const f=fixture({source:'editor',parent});
    try{
      f.start();
      f.gizmo.pivot.position.x+=2;
      await f.finish();
      expect(f.calls[0].operation.type).toBe('setTransform');
      expect(f.calls[0].operation.transform.position[2]).toBeCloseTo(2);
      expect(f.target.position.z).toBeCloseTo(2);
      expect(f.target.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(7);
    }finally{f.close();}
  });

  it('applies uniform scale to managed models and disallows nonuniform scale',async()=>{
    const f=fixture({source:'editor'});
    try{
      f.gizmo.setMode('scale');
      f.start();
      f.gizmo.pivot.scale.set(1.8,1.8,1.8);
      await f.finish();
      expect(f.calls[0].operation).toMatchObject({type:'setTransform',transform:{scale:1.8}});
      f.gizmo.setMode('scale');
      f.start();
      f.gizmo.pivot.scale.set(1.3,1,1);
      await f.finish();
      expect(f.calls).toHaveLength(1);
      expect(f.completed.at(-1).error.code).toBe('CODE_GIZMO_UNIFORM_SCALE_REQUIRED');
      expect(f.target.scale.toArray()).toEqual([1.8,1.8,1.8]);
    }finally{f.close();}
  });

  it('rejects an overlapping MCP revision and does not mutate the actual object',async()=>{
    const f=fixture();
    try{
      f.start();
      f.gizmo.pivot.position.x+=5;
      f.incrementRevision();
      await f.finish();
      expect(f.calls).toHaveLength(1);
      expect(f.completed.at(-1).error.message).toBe('REVISION_CONFLICT');
      expect(f.target.position.x).toBe(0);
    }finally{f.close();}
  });

  it('cancels an in-progress drag without Scene writes and removes all visualization objects on disposal',async()=>{
    const f=fixture();
    f.start();
    f.gizmo.pivot.position.x+=6;
    f.gizmo.cancelDrag();
    await vi.waitFor(()=>expect(f.gizmo.dragging).toBe(false));
    expect(f.calls).toHaveLength(0);
    expect(f.target.position.x).toBe(0);
    expect(f.completed.at(-1).cancelled).toBe(true);
    f.close();
    expect(f.gizmo.helper.parent).toBeNull();
    expect(f.scene.getObjectByName('AgentScapeCodeWorldEditPivot')).toBeUndefined();
    expect(f.scene.getObjectByName('AgentScapeCodeWorldEditOutline')).toBeUndefined();
  });
});
