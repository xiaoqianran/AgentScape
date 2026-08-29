import * as THREE from "three";

const clearGroup = (group) => {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  }
};

const marker = (position, color, radius = 0.085) => {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 8),
    new THREE.MeshBasicMaterial({ color, depthTest: false })
  );
  mesh.position.fromArray(position);
  mesh.renderOrder = 24;
  return mesh;
};

export class AgentToolsDebugRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "observatory-agent-tool-result";
    scene.add(this.group);
  }

  setVisible(visible) { this.group.visible = Boolean(visible); }

  update(snapshot) {
    clearGroup(this.group);
    const tool = snapshot?.lastTool;
    if (!tool) return;

    if (tool.name === "raycast" && Array.isArray(tool.args?.origin) && Array.isArray(tool.args?.direction)) {
      const origin = new THREE.Vector3(...tool.args.origin);
      const direction = new THREE.Vector3(...tool.args.direction).normalize();
      const length = Number(tool.args.maxDistance) || 100;
      const end = origin.clone().addScaledVector(direction, length);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([origin, end]),
        new THREE.LineBasicMaterial({ color: 0x78c8e8, depthTest: false })
      );
      line.renderOrder = 21;
      this.group.add(line, marker(origin.toArray(), 0x78c8e8, 0.055));
      for (const [index, hit] of (tool.result || []).entries()) {
        if (Array.isArray(hit.point)) this.group.add(marker(hit.point, index === 0 ? 0xf0cf6d : 0xb7c4cf, index === 0 ? 0.09 : 0.06));
      }
    }

    if (tool.name === "findFreeSpace" && Array.isArray(tool.result)) {
      this.group.add(marker(tool.result, 0x6fd59b, 0.11));
    }

    if (tool.name === "getBounds" && tool.result?.min && tool.result?.max) {
      const helper = new THREE.Box3Helper(
        new THREE.Box3(new THREE.Vector3(...tool.result.min), new THREE.Vector3(...tool.result.max)),
        0x78c8e8
      );
      helper.renderOrder = 20;
      this.group.add(helper);
    }

    if (tool.name === "getCarryStatus" && tool.result?.status === "empty") {
      const dropped = snapshot.physics?.bodies?.find((body) => body.objectId === "cup");
      if (dropped?.position) this.group.add(marker(dropped.position, 0x6fd59b, 0.1));
    }
  }

  dispose() {
    clearGroup(this.group);
    this.scene.remove(this.group);
  }
}
