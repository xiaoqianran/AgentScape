import * as THREE from "three";

export function createObservatorySceneTheme({ accent = 0x78b7f4 } = {}) {
  const group = new THREE.Group();
  group.name = "observatory-scene-theme";

  const hemisphere = new THREE.HemisphereLight(0xbfd9f2, 0x11161d, 1.08);
  hemisphere.name = "observatory-hemisphere";

  const key = new THREE.DirectionalLight(0xe8f1fb, 2.35);
  key.position.set(5.5, 9, 4.5);
  key.castShadow = false;
  key.name = "observatory-key";

  const rim = new THREE.DirectionalLight(accent, 0.72);
  rim.position.set(-5, 4.5, -6);
  rim.castShadow = false;
  rim.name = "observatory-rim";

  const fill = new THREE.DirectionalLight(0x9fa7c7, 0.34);
  fill.position.set(2, 2.8, -5);
  fill.castShadow = false;
  fill.name = "observatory-fill";

  group.add(hemisphere, key, rim, fill);
  return group;
}

export function applyObservatorySceneTheme(scene, renderer, options = {}) {
  scene.background = new THREE.Color(0x080d13);
  scene.fog = new THREE.Fog(0x080d13, 18, 48);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  const group = createObservatorySceneTheme(options);
  scene.add(group);
  return group;
}
