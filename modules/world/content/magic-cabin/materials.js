import * as THREE from 'three';

// Port the original daytime ink-and-paper palette to materials supported by both
// production WebGPU and WebGL backends. Keep uniform data for the source animations.
export function createCabinMaterial(options) {
  const points = options.fragmentShader?.includes('gl_PointCoord');
  const material = points
    ? new THREE.PointsMaterial({ color:0xe5e88d, size:0.045, transparent:true, depthWrite:false })
    : options.uniforms?.uTint
      ? new THREE.MeshStandardMaterial({ color:options.uniforms.uTint.value, roughness:0.88, metalness:0 })
      : new THREE.MeshBasicMaterial({ color:0xffffff });
  material.uniforms = options.uniforms;
  if (points && options.uniforms?.uOpacity) material.opacity=options.uniforms.uOpacity.value;
  material.vertexShader = options.vertexShader;
  material.fragmentShader = options.fragmentShader;
  for (const key of ['transparent','opacity','depthWrite','depthTest','side','blending']) {
    if (options[key] !== undefined) material[key] = options[key];
  }
  return material;
}
