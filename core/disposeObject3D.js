const disposeTextureValue = (value, textures) => {
  if (value?.isTexture && !textures.has(value)) {
    textures.add(value);
    value.dispose();
  }
};

export function disposeObject3D(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  root?.traverse?.((node) => {
    const geometry = node.geometry;
    if (geometry && !geometries.has(geometry)) {
      geometries.add(geometry);
      geometry.disposeBoundsTree?.();
      geometry.dispose?.();
    }

    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) disposeTextureValue(value, textures);
      material.dispose?.();
    }
  });

  return { geometries: geometries.size, materials: materials.size, textures: textures.size };
}
