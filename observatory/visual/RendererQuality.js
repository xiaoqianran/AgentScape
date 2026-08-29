export function resizeObservatoryRenderer({ renderer, camera, viewport, pixelBudget = 720000 }) {
  const width = Math.max(viewport.clientWidth, 1);
  const height = Math.max(viewport.clientHeight, 1);
  const cssPixels = width * height;
  const deviceRatio = globalThis.devicePixelRatio || 1;
  const budgetRatio = Math.sqrt(pixelBudget / Math.max(cssPixels, 1));
  const pixelRatio = Math.max(0.78, Math.min(deviceRatio, 1.15, budgetRatio));

  if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  return { width, height, pixelRatio };
}
