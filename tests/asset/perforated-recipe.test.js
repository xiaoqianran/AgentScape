import {expect,it} from 'vitest';
import * as THREE from 'three';
import {recipeSchema,assertEmbeddedGLB} from '../../modules/asset/model/AssetInputContracts.js';
import {compileRecipeGeometry} from '../../modules/asset/production/AssetRecipe.js';
import {createAssetGLTFIO} from '../../modules/asset/production/compiler/gltfIO.js';

const input=holes=>({schema:'agentscape.asset-recipe',schemaVersion:1,id:'test/perforated',
  parts:[{id:'plate',geometry:{type:'perforated-box',size:[2,.15,1],holes},material:{color:'#c7a776'}}]});
const valid=[{center:[-.5,.2],radius:.08},{center:[.4,-.2],radius:.12}];
it('compiles actual through-holes with inner walls, two caps and centered Y thickness',async()=>{
  const {bytes}=await compileRecipeGeometry(input(valid));
  const gltf=assertEmbeddedGLB(bytes);
  expect(gltf.meshes).toHaveLength(1);
  const doc=await createAssetGLTFIO().readBinary(bytes);
  const primitive=doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const positions=primitive.getAttribute('POSITION').getArray(),normals=primitive.getAttribute('NORMAL').getArray();
  const g=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(positions,3))
    .setAttribute('normal',new THREE.BufferAttribute(normals,3));
  if(primitive.getIndices())g.setIndex(new THREE.BufferAttribute(primitive.getIndices().getArray(),1));
  const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  mesh.updateMatrixWorld();
  g.computeBoundingBox();
  expect(g.boundingBox.min.toArray()).toEqual(expect.arrayContaining([expect.closeTo(-1),expect.closeTo(-.075),expect.closeTo(-.5)]));
  expect(g.boundingBox.max.toArray()).toEqual(expect.arrayContaining([expect.closeTo(1),expect.closeTo(.075),expect.closeTo(.5)]));
  const hits=(origin,direction)=>new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction)).intersectObject(mesh);
  for(const {center:[x,z],radius} of valid){
    expect(hits([x,1,z],[0,-1,0])).toHaveLength(0);
    expect(hits([x,-1,z],[0,1,0])).toHaveLength(0);
    const side=hits([x,0,z],[1,0,0]);
    expect(side[0].distance).toBeCloseTo(radius,2);
  }
  expect(hits([0,1,0],[0,-1,0]).map(h=>h.point.y)).toEqual(expect.arrayContaining([expect.closeTo(.075),expect.closeTo(-.075)]));
  g.dispose();mesh.material.dispose();
});

it('rejects touching, overlapping, out-of-bounds and over-budget holes',()=>{
  const bad=[
    [{center:[.99,0],radius:.02}],
    [{center:[0,0],radius:.1},{center:[.2,0],radius:.1}],
    [{center:[0,0],radius:.1},{center:[.05,0],radius:.1}],
    [{center:[0,0],radius:0}],
    []
  ];
  for(const holes of bad)expect(recipeSchema.safeParse(input(holes)).success).toBe(false);
  const many=Array.from({length:100},(_,i)=>({center:[(i%10-4.5)*.16,(Math.floor(i/10)-4.5)*.08],radius:.02}));
  const recipe=input(many);
  expect(recipeSchema.safeParse(recipe).success).toBe(true);
  recipe.parts.push(...['plate2','plate3'].map(id=>({...recipe.parts[0],id})));
  expect(recipeSchema.safeParse(recipe).success).toBe(false);
});
