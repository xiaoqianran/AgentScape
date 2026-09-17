import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { InteractionSystem } from '../../modules/world/runtime/systems/InteractionSystem.js';

const record = (id, manifest = {}) => ({
  id,
  assetId:id,
  object:new THREE.Group(),
  manifest:{ actions:[], physics:{body:'fixed'}, ...manifest },
  state:{}
});

describe('Interaction → WorldRuntime navigation boundary', () => {
  it('reports transform mutation through the injected runtime callback without relying on interaction events', () => {
    const store=new ObjectStore();
    store.add('wall',record('wall',{actions:['move']}));
    const physics={setPosition:vi.fn()};
    const events={emit:vi.fn()};
    const onObjectTransform=vi.fn();
    const interaction=new InteractionSystem({store,physics,spatial:{},events,onObjectTransform});

    interaction.move('wall',[2,0,3],{silent:true});

    expect(onObjectTransform).toHaveBeenCalledWith('wall','interaction.move');
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('reports place-inside transform mutation, which the old move/place event filter missed', () => {
    const store=new ObjectStore();
    store.add('cup',record('cup'));
    store.add('cabinet',record('cabinet',{receptacles:[{id:'interior'}]}));
    const position=new THREE.Vector3(0,.4,0);
    const physics={setPosition:vi.fn(),checkManifestPose:vi.fn(()=>({clear:true}))};
    const spatial={
      findFreeSpaceInside:vi.fn(()=>position.clone()),
      containmentGeometry:vi.fn(()=>({inside:true,receptacleId:'interior'}))
    };
    const onObjectTransform=vi.fn();
    const interaction=new InteractionSystem({store,physics,spatial,events:{emit:vi.fn()},onObjectTransform});

    const result=interaction.placeInside('cup','cabinet',{receptacleId:'interior',silent:true});

    expect(result).toMatchObject({status:'inside',containmentVerified:true,receptacleId:'interior'});
    expect(onObjectTransform).toHaveBeenCalledWith('cup','interaction.place-inside');
  });
});
