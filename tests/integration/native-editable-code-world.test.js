import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {openCodeProject,parseCodeProject} from '../../application/native-scene/CodeProject.js';
import {StudioCodeProjects} from '../../apps/studio/code-project/StudioCodeProjects.js';
import {AuthoringWorldStore} from '../../apps/studio/persistence/AuthoringWorldStore.js';

const editableProject = {
  schema:'agentscape.code-project',schemaVersion:1,id:'editable_world',name:'Visual Code World',
  source:`export function createProject({THREE}) {
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
    const tower=new THREE.Group();tower.name='tower';scene.add(tower);
    const renderer={render(){},extensions:{has:()=>false}};
    return {scene,camera,renderer,setup({scene:api}){
      api.registerEntity({id:'tower',object:tower,read:()=>({label:'tower'})});
      api.registerEditable({id:'tower',object:tower,label:'Tower',properties:['position','visible']});
    }};
  }`,
  resources:{}
};
const open=options=>openCodeProject({...options,autoStart:false});

describe('Free Three.js code + Studio visual editing',()=>{
  it('edits the original Object3D through scene.apply and persists a separate editable delta',async()=>{
    const host=await open({project:editableProject,authorized:true});
    let reopened;
    try {
      const native=host.scene.native.scene.getObjectByName('tower');
      expect(native).toBeInstanceOf(THREE.Group);
      expect(host.scene.observe().nativeEditables.objects.map(item=>item.id)).toEqual(['tower']);
      const before=host.scene.observe().revision;
      const changed=await host.scene.apply({expectedRevision:before,operations:[
        {type:'editNative',id:'tower',changes:{position:[3,7,4],visible:false}}
      ]});
      expect(changed.status).toBe('succeeded');
      expect(native.position.toArray()).toEqual([3,7,4]);
      expect(native.visible).toBe(false);
      expect(host.scene.native.scene.getObjectByName('tower')).toBe(native);
      expect(host.scene.observe().revision).toBeGreaterThan(before);
      expect(host.scene.inspect('tower').state.label).toBe('tower');
      await expect(host.scene.apply({expectedRevision:before,operations:[
        {type:'editNative',id:'tower',changes:{position:[1,1,1]}}
      ]})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
      expect((await host.scene.apply({operations:[
        {type:'editNative',id:'tower',changes:{scale:[2,2,2]}}
      ]})).status).toBe('failed');
      expect(native.scale.toArray()).toEqual([1,1,1]);
      const asset=await host.scene.addModel({id:'added_box',asset:{
        schema:'agentscape.asset-recipe',schemaVersion:1,id:'visual/box',
        parts:[{id:'body',geometry:{type:'box',size:[2,2,2]}}]
      },position:[8,0,0]});
      expect(asset.status).toBe('succeeded');
      const saved=(await host.scene.save()).value;
      expect(saved.edits.overrides.tower).toEqual({position:[3,7,4],visible:false});
      expect(saved.runtime).toBeDefined();
      reopened=await open({project:JSON.stringify(saved),authorized:true});
      expect(reopened.scene.native.scene.getObjectByName('tower').position.toArray()).toEqual([3,7,4]);
      expect(reopened.scene.native.scene.getObjectByName('tower').visible).toBe(false);
      expect(reopened.scene.observe().objects.map(x=>x.id)).toContain('added_box');
    }finally{host.close();reopened?.close();}
  },30000);

  it('keeps editor overrides while Studio changes and reruns the source code',async()=>{
    const base=await open({project:{...editableProject,id:'base'},authorized:true});
    const controller=new StudioCodeProjects({baseWorld:base.world,baseScene:base.scene,
      store:new AuthoringWorldStore({indexedDBImpl:null}),open});
    let reopened;
    try{
      await controller.write({create:true,project:editableProject});
      await controller.run({expectedRevision:1});
      expect((await controller.scene.apply({operations:[
        {type:'editNative',id:'tower',changes:{position:[4,2,3]}}
      ]})).status).toBe('succeeded');
      await controller.scene.addModel({id:'studio_box',asset:{
        schema:'agentscape.asset-recipe',schemaVersion:1,id:'visual/fixture',
        parts:[{id:'body',geometry:{type:'box',size:[1,1,1]}}]
      },position:[6,0,2]});
      await controller.write({expectedRevision:1,source:editableProject.source.replace("tower.name='tower';","tower.name='tower';tower.userData.marker='rerun';")});
      await controller.run({expectedRevision:2});
      expect(controller.scene.native.scene.getObjectByName('tower').userData.marker).toBe('rerun');
      expect(controller.scene.native.scene.getObjectByName('tower').position.toArray()).toEqual([4,2,3]);
      expect(controller.scene.observe().objects.map(x=>x.id)).toContain('studio_box');
      const saved=(await controller.save()).value;
      expect(saved.edits.overrides.tower.position).toEqual([4,2,3]);
      await controller.close();
      reopened=await open({project:await parseCodeProject(saved),authorized:true});
      expect(reopened.scene.native.scene.getObjectByName('tower').position.toArray()).toEqual([4,2,3]);
      expect(reopened.scene.observe().objects.map(x=>x.id)).toContain('studio_box');
    }finally{controller.dispose();base.close();reopened?.close();}
  },30000);

  it('rejects a stable ID that points to a different code-owned object',async()=>{
    const host=await open({project:editableProject,authorized:true});
    try{
      const extra=new THREE.Group();host.scene.native.scene.add(extra);
      host.scene.registerEntity({id:'registered_elsewhere',object:extra,read:()=>({})});
      const another=new THREE.Group();host.scene.native.scene.add(another);
      expect(()=>host.scene.registerEditable({id:'registered_elsewhere',object:another}))
        .toThrow('NATIVE_EDIT_ID_CONFLICT');
      expect(host.scene.nativeEditables().objects.map(item=>item.id)).toEqual(['tower']);
    }finally{host.close();}
  });

  it('reapplies unresolved editor overrides when asynchronously mounted code objects register',async()=>{
    const host=await open({project:editableProject,authorized:true});
    try{
      host.scene.restoreNativeEdits({schema:'agentscape.native-edits',schemaVersion:1,
        overrides:{late_model:{position:[6,7,8]}}});
      expect(host.scene.nativeEditables().unresolved).toEqual(['late_model']);
      const codeObject=new THREE.Group();
      host.scene.native.scene.add(codeObject);
      const dispose=host.scene.registerEditable({id:'late_model',object:codeObject,properties:['position']});
      expect(codeObject.position.toArray()).toEqual([6,7,8]);
      expect(host.scene.nativeEditables().unresolved).toEqual([]);
      dispose();
      expect(host.scene.nativeEditables().unresolved).toEqual(['late_model']);
      expect(host.scene.exportNativeEdits().overrides.late_model).toEqual({position:[6,7,8]});
    }finally{host.close();}
  });

  it('keeps independently attached code scenes isolated by their per-world registries',async()=>{
    const left=await open({project:{...editableProject,id:'left_world'},authorized:true});
    const right=await open({project:{...editableProject,id:'right_world'},authorized:true});
    try{
      expect(left.scene.native.editables.getObject('tower')).not.toBe(right.scene.native.editables.getObject('tower'));
      await left.scene.apply({operations:[{type:'editNative',id:'tower',changes:{position:[11,1,4]}}]});
      expect(left.scene.native.scene.getObjectByName('tower').position.x).toBe(11);
      expect(right.scene.native.scene.getObjectByName('tower').position.x).toBe(0);
      expect(right.scene.exportNativeEdits()).toBeNull();
    }finally{left.close();right.close();}
  });

  it('retains unresolved IDs when code changes and rejects editing revoked properties',async()=>{
    const host=await open({project:editableProject,authorized:true});
    try{
      const delta={schema:'agentscape.native-edits',schemaVersion:1,overrides:{
        tower:{position:[3,3,3]},previous_tower:{visible:false}
      }};
      const output=host.scene.restoreNativeEdits(delta);
      expect(output.unresolved).toEqual(['previous_tower']);
      expect(host.scene.exportNativeEdits()).toEqual(delta);
      expect(()=>host.scene.restoreNativeEdits({schema:'agentscape.native-edits',schemaVersion:1,
        overrides:{tower:{scale:[3,3,3]}}})).toThrow('NATIVE_EDIT_PROPERTY_REVOKED');
      expect(host.scene.native.scene.getObjectByName('tower').position.toArray()).toEqual([3,3,3]);
    }finally{host.close();}
  });
});
