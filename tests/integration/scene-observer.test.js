import {describe,it,expect,vi} from 'vitest';
import * as T from 'three';
import {createSceneObserver} from '../../application/native-scene/SceneObserver.js';
import {withNativeIsolation} from '../../application/native-scene/NativeSceneReview.js';

function fixture(){
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(45,1,.1,100);
  camera.position.z=8;camera.lookAt(0,0,0);
  const first=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());first.name='Subject';
  const second=first.clone();second.name='Neighbor';second.position.x=3;
  scene.add(first,second);
  return {scene,camera,first,second,observer:createSceneObserver({scene,camera})};
}
describe('standalone scene observer identity',()=>{
  it('rejects an initializing 1px canvas and accepts a usable frame without advancing time',()=>{
    const {scene,camera}=fixture();
    const canvas={width:1,height:1};
    const redraw=vi.fn();
    const drawImage=vi.fn();
    vi.stubGlobal('document',{createElement:()=>({getContext:()=>({drawImage}),toDataURL:()=> 'data:image/jpeg;base64,ZmFrZQ=='})});
    try{
      const observer=createSceneObserver({scene,camera,renderer:{domElement:canvas}},{renderCurrent:redraw});
      expect(()=>observer.capture()).toThrow('VISUAL_CANVAS_NOT_READY');
      expect(redraw).not.toHaveBeenCalled();
      canvas.width=640;canvas.height=360;
      expect(observer.capture()).toMatchObject({status:'captured',width:640,height:360});
      expect(redraw).toHaveBeenCalledOnce();
      expect(drawImage).toHaveBeenCalledWith(canvas,0,0,640,360);
      canvas.width=1024;canvas.height=32;
      expect(()=>observer.capture({maxWidth:128,maxHeight:128})).toThrow('VISUAL_CAPTURE_DIMENSIONS_INVALID');
    }finally{vi.unstubAllGlobals();}
  });
  it('exposes object references and observes host-owned geometry without a Runtime',()=>{
    const {observer,first,scene,camera}=fixture();
    const result=observer.search({query:'Subject'});
    expect(result.items[0]).toMatchObject({nodePath:'0',objectUuid:first.uuid,name:'Subject'});
    expect(observer.inspect().children[0]).toMatchObject({nodePath:'0',objectUuid:first.uuid});
    expect(observer.inspect(result.items[0]).node.objectUuid).toBe(first.uuid);
    const views=observer.suggestViews({nodePath:'0',objectUuid:first.uuid,candidateLimit:2});
    expect(views.best.view).toMatchObject({nodePath:'0',objectUuid:first.uuid});
    expect(scene.children[0]).toBe(first);expect(camera.position.z).toBe(8);
  });
  it('rejects stale paths after native reordering even with no Runtime revision',()=>{
    const {observer,first,second,scene}=fixture();
    const {nodePath,objectUuid}=observer.search({query:'Subject'}).items[0];
    scene.remove(first);scene.add(first);
    expect(scene.children[0]).toBe(second);
    expect(()=>observer.inspect({nodePath,objectUuid})).toThrow('NATIVE_INSPECT_OBJECT_CONFLICT');
    expect(()=>observer.suggestViews({nodePath,objectUuid,candidateLimit:2})).toThrow('NATIVE_INSPECT_OBJECT_CONFLICT');
    expect(observer.inspectBatch({nodePaths:[nodePath,'1'],objectUuids:[objectUuid,first.uuid]}).results).toMatchObject([
      {status:'error',code:'NATIVE_INSPECT_OBJECT_CONFLICT'},{status:'inspected',node:{objectUuid:first.uuid}}
    ]);
    expect(()=>withNativeIsolation(scene,nodePath,()=>{throw Error('must not render')},objectUuid)).toThrow('NATIVE_INSPECT_OBJECT_CONFLICT');
    expect(observer.search({query:'Subject'}).items[0]).toMatchObject({nodePath:'1',objectUuid:first.uuid});
  });
});
