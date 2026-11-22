import {describe,it,expect} from 'vitest';
import {openCodeProject} from '../../application/native-scene/CodeProject.js';

const project={
  schema:'agentscape.code-project',schemaVersion:1,id:'history_code_world',name:'History code world',resources:{},
  source:`export function createProject({THREE}){
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),group=new THREE.Group();
    group.name='native_tower';group.position.set(2,0,0);scene.add(group);
    return {scene,camera,renderer:{render(){},extensions:{has:()=>false}},setup({scene:api}){
      api.registerEntity({id:'native_tower',object:group,read:()=>({})});
      api.registerEditable({id:'native_tower',object:group,properties:['position','visible']});
    }};
  }`
};
const open=()=>openCodeProject({project,authorized:true,autoStart:false});
const add={
  schema:'agentscape.asset-recipe',schemaVersion:1,id:'history/cube',
  parts:[{id:'body',geometry:{type:'box',size:[1,1,1]}}]
};

describe('unified managed + code object history through SceneFacade',()=>{
  it('interleaves native property edits and managed objects and restores overrides accurately',async()=>{
    const host=await open();
    try {
      const scene=host.scene;
      expect(scene.observe().history).toMatchObject({undo:0,redo:0});
      const first=await scene.apply({operations:[{type:'editNative',id:'native_tower',changes:{position:[5,0,0]}}]});
      expect(first.status).toBe('succeeded');
      expect(scene.observe().history).toMatchObject({undo:1,redo:0});
      const added=await scene.addModel({id:'managed_cube',asset:add,level:'visual',position:[0,0,0]});
      expect(added.status).toBe('succeeded');
      const transformed=await scene.apply({operations:[{type:'setTransform',id:'managed_cube',transform:{position:[3,0,0],scale:1}}]});
      expect(transformed.status).toBe('succeeded');
      expect(scene.observe().history).toMatchObject({undo:3,redo:0});
      let version=scene.observe().revision;
      await expect(scene.history({operation:'undo',expectedRevision:version-1})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
      expect((await scene.history({operation:'undo',expectedRevision:version})).value.applied).toBe(true);
      expect(scene.observe().objects.find(o=>o.id==='managed_cube').transform.position).toEqual([0,0,0]);
      await scene.history({operation:'undo'});
      expect(scene.observe().objects.some(o=>o.id==='managed_cube')).toBe(false);
      await scene.history({operation:'undo'});
      expect(scene.native.scene.getObjectByName('native_tower').position.x).toBe(2);
      expect(scene.exportNativeEdits()).toBeNull();
      expect(scene.observe().history).toMatchObject({undo:0,redo:3});
      await scene.history({operation:'redo'});
      expect(scene.native.scene.getObjectByName('native_tower').position.x).toBe(5);
      expect(scene.exportNativeEdits().overrides.native_tower.position).toEqual([5,0,0]);
      await scene.history({operation:'redo'});
      expect(scene.observe().objects.some(o=>o.id==='managed_cube')).toBe(true);
      await scene.history({operation:'redo'});
      expect(scene.observe().objects.find(o=>o.id==='managed_cube').transform.position).toEqual([3,0,0]);
      expect(scene.observe().history).toMatchObject({undo:3,redo:0});
    }finally{host.close();}
  },30000);

  it('records successive Native attribute edits separately and invalidates redo on a new edit',async()=>{
    const host=await open();
    try {
      const scene=host.scene;
      await scene.apply({operations:[{type:'editNative',id:'native_tower',changes:{visible:false}}]});
      await scene.apply({operations:[{type:'editNative',id:'native_tower',changes:{position:[7,2,1]}}]});
      await scene.history({operation:'undo'});
      expect(scene.native.scene.getObjectByName('native_tower').position.toArray()).toEqual([2,0,0]);
      expect(scene.native.scene.getObjectByName('native_tower').visible).toBe(false);
      expect(scene.exportNativeEdits().overrides.native_tower).toEqual({visible:false});
      await scene.apply({operations:[{type:'editNative',id:'native_tower',changes:{position:[3,1,1]}}]});
      expect(scene.observe().history).toMatchObject({redo:0,canRedo:false});
      await scene.history({operation:'undo'});
      await scene.history({operation:'undo'});
      expect(scene.native.scene.getObjectByName('native_tower').visible).toBe(true);
      expect(scene.exportNativeEdits()).toBeNull();
    }finally{host.close();}
  });

  it('never removes a failing native restore from the history stack',async()=>{
    const host=await open();
    try {
      await host.scene.apply({operations:[{type:'editNative',id:'native_tower',changes:{position:[8,0,0]}}]});
      host.scene.native.scene.getObjectByName('native_tower').removeFromParent();
      // An explicit unregister occurs when the owner disposes; reparent alone
      // is not sufficient. The runtime record must be removed.
      const edits=host.scene.nativeEditables();
      expect(edits.objects).toHaveLength(1);
      // Restore a disjoint snapshot to ensure mismatched permissions are rejected.
      expect(()=>host.scene.restoreNativeEdits({schema:'agentscape.native-edits',schemaVersion:1,
        overrides:{native_tower:{scale:[2,2,2]}}})).toThrow('NATIVE_EDIT_PROPERTY_REVOKED');
      expect(host.scene.observe().history.canUndo).toBe(true);
    }finally{host.close();}
  });
});
