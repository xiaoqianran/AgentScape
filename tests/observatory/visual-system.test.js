import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  worldLabelsForAgent,
  worldLabelsForNavigation,
  worldLabelsForPhysics
} from "../../observatory/visual/WorldLabelLayer.js";
import { CameraRig } from "../../observatory/visual/CameraRig.js";

describe("Observatory visual system", () => {
  it("maps normalized physics state into compact world labels", () => {
    const labels = worldLabelsForPhysics({
      bodies: [{ objectId: "cup", position: [1, 2, 3], linearVelocity: [0, 2, 0], sleeping: false }]
    });
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ id: "physics:cup", title: "cup", detail: "2.00 m/s", tone: "info" });
  });

  it("maps route endpoints into navigation world labels", () => {
    const labels = worldLabelsForNavigation({
      route: {
        reachable: true,
        start: { input: [0, 0, 0] },
        end: { input: [4, 0, 2] }
      }
    });
    expect(labels.map((item) => item.title)).toEqual(["起点", "终点"]);
    expect(labels[1].tone).toBe("pass");
  });

  it("maps ToolCallingAgent execution without inventing AgentTools lastTool state", () => {
    const labels = worldLabelsForAgent({
      lastTool: null,
      agent: { execution: [{ executed: true, tool: "getBounds", args: { id: "table" } }] },
      spatial: {
        bounds: [{ id: "table", center: [0, 0.5, 0], max: [1, 1, 1] }]
      }
    });
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ title: "table", detail: "getBounds · 已接受", tone: "info" });
  });

  it("can immediately restore a scenario camera composition", () => {
    const camera = new THREE.PerspectiveCamera();
    const controls = { target: new THREE.Vector3(), update() {} };
    const rig = new CameraRig({ camera, controls });
    rig.moveTo([5, 4, 3], [0, 1, 0], { immediate: true });
    expect(camera.position.toArray()).toEqual([5, 4, 3]);
    expect(controls.target.toArray()).toEqual([0, 1, 0]);
    expect(rig.active).toBe(false);
  });
});
