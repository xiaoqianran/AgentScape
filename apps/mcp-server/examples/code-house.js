// Shared source/definition fixture for SDK, MCP and Studio project bundles.
const panels = [
  [[6,.2,5],[0,.1,0]], [[.2,3,5],[-3,1.5,0]], [[.2,3,5],[3,1.5,0]],
  [[6,3,.2],[0,1.5,-2.5]], [[2,3,.2],[-2,1.5,2.5]], [[2,3,.2],[2,1.5,2.5]],
  [[2,.6,.2],[0,2.7,2.5]], [[6.4,.2,5.4],[0,3.1,0]]
];
const stairs = Array.from({length:6},(_,i)=>[[1,.2*(i+1),.4],[-2,.2+.1*(i+1),1-i*.4]]);
export const house = {
  source:`export function createAsset(THREE) {
    const root=new THREE.Group(); root.name='House';
    const material=new THREE.MeshStandardMaterial({color:'#eeeecc'});
    const panels=${JSON.stringify([...panels,...stairs])};
    panels.forEach(([size,position],i)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.name='panel_'+i;mesh.position.set(...position);root.add(mesh);});
    const hinge=new THREE.Group();hinge.name='doorHinge';hinge.position.set(-1,1.2,2.65);root.add(hinge);
    const door=new THREE.Mesh(new THREE.BoxGeometry(2,2.4,.12),new THREE.MeshStandardMaterial({color:'#884422'}));door.position.x=1;door.name='Door';hinge.add(door);
    return root;
  }`,
  definition:{id:'house',type:'building',label:'Code house with stairs and hinged door',actions:['open','close'],requiredNodes:['Door','doorHinge'],
    physics:{body:'fixed',navigationObstacle:true,colliders:[...panels,...stairs].map(([size,translation])=>({shape:'box',halfExtents:size.map(n=>n/2),translation}))},
    parts:{door:{node:'doorHinge',semantic:'door',actions:['open','close'],targets:{open:-1.4,close:0},
      physics:{body:'dynamic',mass:8,colliders:[{shape:'box',halfExtents:[1,1.2,.06],translation:[1,0,0]}]},
      joint:{type:'revolute',axis:[0,1,0],limits:[-1.4,0],parentAnchor:[-1,1.2,2.65],childAnchor:[0,0,0],motor:{stiffness:80,damping:12}}}}
  }
};
