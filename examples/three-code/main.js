import { AgentScape } from '../../sdk/typescript/src/index.ts';
const status=document.querySelector('[role=status]');
document.querySelector('#run').onclick=async()=>{
  try {
    const world=await AgentScape.open({canvas:'#app',codeExecution:{mode:'trusted-local',authorized:true}});
    await world.addModel({id:'cube',asset:{kind:'three-code',source:`export function createAsset(THREE) {
      const root=new THREE.Group();const cube=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshStandardMaterial({color:'#ee8844'}));
      cube.position.y=1;root.add(cube);return root;
    }`}});
    window.codeDemo={world,AgentScape};status.textContent='Cube created';
  } catch(error) {status.textContent=error.message;}
};
