// A standalone native Three.js project. No AgentScape imports, globals or lifecycle.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const scene = new THREE.Scene();
scene.name = 'Native courtyard';
scene.background = new THREE.Color('#17212d');
scene.fog = new THREE.Fog('#17212d', 22, 65);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 100);
camera.position.set(10, 8, 13);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());
controls.target.set(0, 1, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xd5e8ff, 0x536346, 2));
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(5, 10, 7);
sun.castShadow = true;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.BoxGeometry(24, .2, 24), new THREE.MeshStandardMaterial({ color: '#526974', roughness: .8 }));
floor.name = 'NativeFloor';
floor.position.y = -.1;
floor.receiveShadow = true;
scene.add(floor);

const columns = new THREE.InstancedMesh(new THREE.CylinderGeometry(.22, .3, 3, 16), new THREE.MeshStandardMaterial({ color: '#d7cdbd' }), 12);
columns.name = 'NativeColumns';
for (let i = 0; i < 12; i++) {
  const angle = i / 12 * Math.PI * 2;
  columns.setMatrixAt(i, new THREE.Matrix4().makeTranslation(Math.cos(angle) * 9, 1.5, Math.sin(angle) * 9));
}
columns.castShadow = true;
scene.add(columns);

const material = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 } },
  vertexShader: `varying vec3 localPosition; void main() { localPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform float time; varying vec3 localPosition; void main() { float wave=.5+.5*sin(localPosition.y*8.+time*2.); gl_FragColor=vec4(mix(vec3(.1,.35,.9),vec3(.3,1.,.8),wave),1.); }`,
});
const ring = new THREE.Mesh(new THREE.TorusKnotGeometry(.8, .22, 128, 24), material);
ring.name = 'NativeShader';
ring.position.set(0, 3, -4);
let calls = 0;
ring.onBeforeRender = () => { ring.userData.renderCalls = ++calls; };
scene.add(ring);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
function animate(time) {
  requestAnimationFrame(animate);
  material.uniforms.time.value = time / 1000;
  ring.rotation.y = time / 1600;
  controls.update();
  composer.render();
}
requestAnimationFrame(animate);
