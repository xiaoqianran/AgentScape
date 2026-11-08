import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { SpatialSystem } from '../../modules/world/runtime/systems/SpatialSystem.js';
import { SceneGraph } from '../../modules/world/runtime/graph/SceneGraph.js';

function insert(store, id, position, { size=[1,1,1], surfaces=[], receptacles=[] }={}) {
  const object=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial());
  object.position.set(...position);
  store.add(id,{ id, assetId:'box', object,
    manifest:{ actions:[], surfaces, receptacles } });
}

describe('SceneGraph broad-phase',()=>{
  it('skips expensive exact containment tests for distant objects',()=>{
    const store=new ObjectStore();
    for(let index=0;index<100;index++)insert(store,'box_'+index,[index*10,0.5,0]);
    const spatial=new SpatialSystem({store});
    const containment=vi.spyOn(spatial,'containmentGeometry');
    const graph=new SceneGraph({store,spatial});
    graph.update();
    expect(graph.list()).toHaveLength(0);
    expect(containment).not.toHaveBeenCalled();
    // A subsequent move must still recompute new nearby relations.
    store.get('box_1').object.position.set(1,0.5,0);
    graph.changed();
    expect(graph.list({subject:'box_0',predicate:'NEAR',object:'box_1'})).toHaveLength(1);
  });

  it('preserves containment in a receptacle outside its parent visual bounds',()=>{
    const store=new ObjectStore();
    insert(store,'cabinet',[0,0.5,0],{receptacles:[
      {id:'external_bin',localPosition:[8,0,0],size:[2,2,2]}
    ]});
    insert(store,'item',[8,0.5,0],{size:[0.2,0.2,0.2]});
    const graph=new SceneGraph({store,spatial:new SpatialSystem({store})});
    graph.update();
    expect(graph.list({subject:'item',predicate:'INSIDE',object:'cabinet'}))
      .toEqual([expect.objectContaining({meta:expect.objectContaining({receptacleId:'external_bin'})})]);
  });

  it('preserves support on an offset surface outside its parent mesh',()=>{
    const store=new ObjectStore();
    insert(store,'support',[0,0.5,0],{size:[0.2,0.2,0.2],surfaces:[
      {id:'external_top',localPosition:[8,0.1,0],size:[2,2]}
    ]});
    insert(store,'item',[8,0.75,0],{size:[0.2,0.2,0.2]});
    const graph=new SceneGraph({store,spatial:new SpatialSystem({store})});
    graph.update();
    expect(graph.list({subject:'item',predicate:'ON',object:'support'})).toHaveLength(1);
  });
});
