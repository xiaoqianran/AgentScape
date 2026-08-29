import * as THREE from "three";

export const OBSERVATORY_COLORS = Object.freeze({
  info: 0x78b7f4,
  pass: 0x72d29a,
  warn: 0xd8b36a,
  fail: 0xee7f83,
  muted: 0x71869a,
  structure: 0x8da9c2,
  violet: 0xa59ade
});

const colorOf = (tone) => OBSERVATORY_COLORS[tone] ?? OBSERVATORY_COLORS.info;

const sharedSphereGeometry = new THREE.SphereGeometry(1, 10, 6);
sharedSphereGeometry.userData.observatoryShared = true;
const sharedRingGeometry = new THREE.RingGeometry(1.55, 1.92, 20);
sharedRingGeometry.userData.observatoryShared = true;
const sharedMaterials = new Map();

const sharedBasicMaterial = (tone, kind) => {
  const key = `${tone}:${kind}`;
  if (sharedMaterials.has(key)) return sharedMaterials.get(key);
  const material = new THREE.MeshBasicMaterial({
    color: colorOf(tone),
    side: kind === "ring" ? THREE.DoubleSide : THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: kind === "ring" ? 0.36 : 0.96
  });
  material.userData.observatoryShared = true;
  sharedMaterials.set(key, material);
  return material;
};

export function createInstrumentMarker(position, tone = "info", { radius = 0.065, ring = true } = {}) {
  const group = new THREE.Group();
  group.position.fromArray(position);
  group.name = `instrument-marker:${tone}`;

  const core = new THREE.Mesh(sharedSphereGeometry, sharedBasicMaterial(tone, "core"));
  core.scale.setScalar(radius);
  core.renderOrder = 26;
  group.add(core);

  if (ring) {
    const halo = new THREE.Mesh(sharedRingGeometry, sharedBasicMaterial(tone, "ring"));
    halo.scale.setScalar(radius);
    halo.rotation.x = -Math.PI / 2;
    halo.renderOrder = 25;
    group.add(halo);
  }
  return group;
}

export function createInstrumentLine(points, tone = "info", { opacity = 0.82, dashed = false } = {}) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => point.isVector3 ? point : new THREE.Vector3(...point)));
  const material = dashed
    ? new THREE.LineDashedMaterial({ color: colorOf(tone), transparent: true, opacity, dashSize: 0.16, gapSize: 0.1, depthTest: false })
    : new THREE.LineBasicMaterial({ color: colorOf(tone), transparent: true, opacity, depthTest: false });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  line.renderOrder = 23;
  return line;
}

export function createInstrumentArrow(direction, origin, length, tone = "info") {
  const dir = direction.isVector3 ? direction.clone() : new THREE.Vector3(...direction);
  const magnitude = dir.length();
  if (!(magnitude > 1e-8)) return null;
  dir.multiplyScalar(1 / magnitude);
  const helper = new THREE.ArrowHelper(
    dir,
    origin.isVector3 ? origin : new THREE.Vector3(...origin),
    length,
    colorOf(tone),
    Math.min(0.16, length * 0.24),
    Math.min(0.075, length * 0.13)
  );
  helper.line.material.transparent = true;
  helper.line.material.opacity = 0.84;
  helper.line.material.depthTest = false;
  helper.cone.material.transparent = true;
  helper.cone.material.opacity = 0.92;
  helper.cone.material.depthTest = false;
  helper.renderOrder = 24;
  return helper;
}

export function createInstrumentBounds(min, max, tone = "structure") {
  const helper = new THREE.Box3Helper(
    new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)),
    colorOf(tone)
  );
  helper.material.transparent = true;
  helper.material.opacity = 0.68;
  helper.material.depthTest = false;
  helper.renderOrder = 20;
  return helper;
}

export function createInstrumentSurface(center, size, tone = "pass", { opacity = 0.12, wireframe = false } = {}) {
  const [sx, sz] = size;
  const group = new THREE.Group();
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshBasicMaterial({
      color: colorOf(tone),
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
      wireframe
    })
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.fromArray(center);
  fill.renderOrder = 18;
  group.add(fill);

  if (!wireframe) {
    const outlineSource = new THREE.PlaneGeometry(sx, sz);
    const outlineGeometry = new THREE.EdgesGeometry(outlineSource);
    outlineSource.dispose();
    const outline = new THREE.LineSegments(
      outlineGeometry,
      new THREE.LineBasicMaterial({ color: colorOf(tone), transparent: true, opacity: 0.62, depthTest: false })
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.fromArray(center);
    outline.renderOrder = 19;
    group.add(outline);
  }
  return group;
}

export function createInstrumentPath(points, tone = "pass", { dashed = false, markers = true } = {}) {
  const group = new THREE.Group();
  if (!Array.isArray(points) || points.length < 2) return group;
  const lifted = points.map(([x, y, z]) => [x, y + 0.028, z]);
  group.add(createInstrumentLine(lifted, tone, { opacity: 0.9, dashed }));
  if (markers) {
    for (const [index, point] of lifted.entries()) {
      group.add(createInstrumentMarker(point, tone, { radius: index === 0 || index === lifted.length - 1 ? 0.055 : 0.035, ring: index === 0 || index === lifted.length - 1 }));
    }
  }
  return group;
}

export function disposeVisualObject(root) {
  root?.traverse?.((node) => {
    if (!node.geometry?.userData?.observatoryShared) node.geometry?.dispose?.();
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => {
        if (!material?.userData?.observatoryShared) material?.dispose?.();
      });
    } else if (!node.material?.userData?.observatoryShared) {
      node.material?.dispose?.();
    }
  });
}

export function clearVisualGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeVisualObject(child);
  }
}
