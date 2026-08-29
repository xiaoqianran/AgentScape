import * as THREE from "three";
import {
  clearVisualGroup,
  createInstrumentBounds,
  createInstrumentLine,
  createInstrumentMarker
} from "../../../visual/DebugVisualPrimitives.js";

export class AgentToolsDebugRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "observatory-agent-tool-result";
    scene.add(this.group);
  }

  setVisible(visible) { this.group.visible = Boolean(visible); }

  update(snapshot) {
    clearVisualGroup(this.group);
    const tool = snapshot?.lastTool;
    if (!tool) return;

    if (tool.name === "raycast" && Array.isArray(tool.args?.origin) && Array.isArray(tool.args?.direction)) {
      const origin = new THREE.Vector3(...tool.args.origin);
      const direction = new THREE.Vector3(...tool.args.direction).normalize();
      const length = Number(tool.args.maxDistance) || 100;
      const end = origin.clone().addScaledVector(direction, length);
      this.group.add(createInstrumentLine([origin, end], "info", { opacity: 0.78 }));
      this.group.add(createInstrumentMarker(origin.toArray(), "info", { radius: 0.04, ring: false }));
      for (const [index, hit] of (tool.result || []).entries()) {
        if (!Array.isArray(hit.point)) continue;
        this.group.add(createInstrumentMarker(
          hit.point,
          index === 0 ? "warn" : "muted",
          { radius: index === 0 ? 0.062 : 0.04, ring: index === 0 }
        ));
      }
    }

    if (tool.name === "findFreeSpace" && Array.isArray(tool.result)) {
      this.group.add(createInstrumentMarker(tool.result, "pass", { radius: 0.075 }));
    }

    if (tool.name === "getBounds" && tool.result?.min && tool.result?.max) {
      this.group.add(createInstrumentBounds(tool.result.min, tool.result.max, "info"));
    }

    if (tool.name === "getCarryStatus" && tool.result?.status === "empty") {
      const dropped = snapshot.physics?.bodies?.find((body) => body.objectId === "cup");
      if (dropped?.position) this.group.add(createInstrumentMarker(dropped.position, "pass", { radius: 0.07 }));
    }
  }

  dispose() {
    clearVisualGroup(this.group);
    this.scene.remove(this.group);
  }
}
