import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createRenderer } from "../../core/rendering/createRenderer.js";
import { RendererProbe } from "../../core/rendering/RendererProbe.js";
import { applyObservatorySceneTheme } from "./ObservatorySceneTheme.js";
import { CameraRig } from "./CameraRig.js";

export async function createObservatoryRenderSurface({
  viewport,
  scene,
  camera,
  rendererMode = "auto",
  rendererTiming = false,
  controlsTarget = [0, 0, 0],
  shadows = false,
  shadowType = null
} = {}) {
  if (!viewport || !scene || !camera) throw new TypeError("Observatory render surface requires viewport, scene and camera");
  const { renderer, info } = await createRenderer({ mode: rendererMode, antialias: true, alpha: false, trackTimestamp: rendererTiming });
  renderer.shadowMap.enabled = Boolean(shadows);
  if (shadowType != null) renderer.shadowMap.type = shadowType;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const rendererProbe = new RendererProbe(renderer, { requestedMode: rendererMode });
  const sceneTheme = applyObservatorySceneTheme(scene, renderer);
  viewport.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.fromArray(controlsTarget);
  controls.enableDamping = true;
  const cameraRig = new CameraRig({ camera, controls });

  return { renderer, rendererInfo: info, rendererProbe, sceneTheme, controls, cameraRig };
}