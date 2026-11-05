export const box={
 source:`export function createAsset(THREE) {
  const root=new THREE.Group();root.name='Box';
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),new THREE.MeshStandardMaterial({color:0xff8844}));
  mesh.position.y=.15;mesh.name='Body';root.add(mesh);return root;
 }`,
 definition:{id:'box',type:'box',label:'程序化箱子',actions:['move','pickup','drop','place'],requiredNodes:['Body'],physics:{body:'dynamic',mass:.3,colliders:[{shape:'box',halfExtents:[.15,.15,.15],translation:[0,.15,0]}]}}
};
export const table={
 source:`export function createAsset(THREE) {
  const root=new THREE.Group();root.name='Table';
  const material=new THREE.MeshStandardMaterial({color:0x996633});
  const top=new THREE.Mesh(new THREE.BoxGeometry(2.4,.16,1.25),material);top.name='TableTop';top.position.y=1;root.add(top);
  for(const x of [-1.02,1.02])for(const z of [-.46,.46]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.14,.94,.14),material);leg.position.set(x,.47,z);root.add(leg);}
  return root;
 }`,
 definition:{id:'table',type:'table',label:'程序化桌子',actions:['move'],requiredNodes:['TableTop'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[1.2,.08,.625],translation:[0,1,0]},...[-1.02,1.02].flatMap(x=>[-.46,.46].map(z=>({shape:'box',halfExtents:[.07,.47,.07],translation:[x,.47,z]})))]},surfaces:[{id:'top',localPosition:[0,1.1,0],size:[2.2,1.05]}]}
};
const shell=[
 {shape:'box',halfExtents:[.05,1,.36],translation:[-.8,1,0]},
 {shape:'box',halfExtents:[.05,1,.36],translation:[.8,1,0]},
 {shape:'box',halfExtents:[.75,.05,.32],translation:[0,.05,0]},
 {shape:'box',halfExtents:[.75,.05,.32],translation:[0,1.95,0]},
 {shape:'box',halfExtents:[.75,.9,.04],translation:[0,1,-.32]}
];
export const fridge={
 source:`export function createAsset(THREE) {
  const root=new THREE.Group();root.name='Fridge';const body=new THREE.Group();body.name='Body';root.add(body);
  const material=new THREE.MeshStandardMaterial({color:0xeeeeee});
  const panels=[[[.1,2,.72],[-.8,1,0]],[[.1,2,.72],[.8,1,0]],[[1.5,.1,.64],[0,.05,0]],[[1.5,.1,.64],[0,1.95,0]],[[1.5,1.8,.08],[0,1,-.32]]];
  for(const [size,position] of panels){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),material);m.position.set(...position);body.add(m);}
  const hinge=new THREE.Group();hinge.name='doorHinge';hinge.position.set(-.82,1,.39);root.add(hinge);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.62,1.9,.08),new THREE.MeshStandardMaterial({color:0xddeeff}));door.name='Door';door.position.x=.81;hinge.add(door);
  return root;
 }`,
 definition:{id:'fridge',type:'fridge',label:'程序化冰箱',actions:['move','open','close'],requiredNodes:['Body','doorHinge','Door'],physics:{body:'fixed',colliders:shell},receptacles:[{id:'interior',localPosition:[0,.95,-.01],size:[1.4,1.7,.46]}],parts:{door:{node:'doorHinge',semantic:'door',actions:['open','close'],targets:{open:-1.35,close:0},physics:{body:'dynamic',mass:8,colliders:[{shape:'box',halfExtents:[.81,.95,.04],translation:[.81,0,0]}]},joint:{type:'revolute',axis:[0,1,0],limits:[-1.35,0],parentAnchor:[-.82,1,.39],childAnchor:[0,0,0],motor:{stiffness:80,damping:12}}}}}
};
