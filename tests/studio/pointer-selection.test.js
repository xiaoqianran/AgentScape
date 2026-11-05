import {it,expect} from 'vitest';
import * as THREE from 'three';
import {resolvePointerSelection} from '../../apps/studio/editor/PointerSelection.js';
const mesh=()=>new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
it('uses the nearest visible hit across runtime and environment, preserving wall occlusion',()=>{
 const cup=mesh(),door=mesh(),wall=mesh();cup.userData.instanceId='cup';
 const environment={interactions:[{object:door,contractId:'door',id:'legacy-door'}]};
 expect(resolvePointerSelection([{object:cup},{object:door}],environment)).toEqual({source:'runtime',id:'cup'});
 expect(resolvePointerSelection([{object:door},{object:cup}],environment)).toEqual({source:'environment',id:'door'});
 expect(resolvePointerSelection([{object:wall},{object:cup}],environment)).toBeNull();
 wall.visible=false;expect(resolvePointerSelection([{object:wall},{object:cup}],environment)?.id).toBe('cup');
});
it('resolves authoring and legacy identities through the same selection boundary',()=>{
 const wall=mesh();wall.userData.authoringId='wall';
 expect(resolvePointerSelection([{object:wall}],null)).toEqual({source:'authoring',id:'wall'});
 delete wall.userData.authoringId;
 expect(resolvePointerSelection([{object:wall}],{interactions:[{object:wall,id:'legacy'}]})).toEqual({source:'environment',id:'legacy'});
});
