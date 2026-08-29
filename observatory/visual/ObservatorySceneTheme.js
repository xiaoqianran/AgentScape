import * as THREE from "three";

export function createObservatorySceneTheme({ accent = 0x8caaee } = {}) {
  const group = new THREE.Group();
  group.name = "observatory-scene-theme";

  const hemisphere = new THREE.HemisphereLight(0xc6d0f5, 0x292c3c, 1.05);
  hemisphere.name = "observatory-hemisphere";

  const key = new THREE.DirectionalLight(0xe5e9f0, 2.1);
  key.position.set(5.5, 9, 4.5);
  key.castShadow = false;
  key.name = "observatory-key";

  const rim = new THREE.DirectionalLight(accent, 0.66);
  rim.position.set(-5, 4.5, -6);
  rim.castShadow = false;
  rim.name = "observatory-rim";

  const fill = new THREE.DirectionalLight(0xa5adce, 0.3);
  fill.position.set(2, 2.8, -5);
  fill.castShadow = false;
  fill.name = "observatory-fill";

  group.add(hemisphere, key, rim, fill);
  return group;
}

export function applyObservatorySceneTheme(scene, renderer, options = {}) {
  scene.background = new THREE.Color(0x303446);
  scene.fog = new THREE.Fog(0x303446, 18, 48);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const group = createObservatorySceneTheme(options);
  scene.add(group);
  return group;
}
