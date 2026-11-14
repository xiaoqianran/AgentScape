/** Compare effective collision shapes rather than visual geometry or material metadata. */
const signature = manifest => JSON.stringify({
  body:manifest.physics?.body,
  colliders:manifest.physics?.colliders,
  parts:Object.fromEntries(Object.entries(manifest.parts||{}).sort(([a],[b])=>a.localeCompare(b)).map(([id,part])=>[
    id,{
      body:part.physics?.body,
      colliders:part.physics?.colliders,
      joint:part.joint
    }
  ]))
});

export const samePhysicalGeometry = (left,right) => signature(left)===signature(right);
