import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

const tuple = (value) => Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite);
const compact = (value, digits = 2) => Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
const length3 = (value) => tuple(value) ? Math.hypot(value[0], value[1], value[2]) : 0;
const label = (id, position, eyebrow, title, detail = "", tone = "neutral") => ({ id, position, eyebrow, title, detail, tone });

export function worldLabelsForPhysics(snapshot) {
  const bodies = (snapshot?.bodies || []).filter((body) => tuple(body.position)).slice(0, 5);
  return bodies.map((body, index) => {
    const speed = length3(body.linearVelocity);
    return label(
      `physics:${body.objectId || index}`,
      [body.position[0], body.position[1] + 0.28, body.position[2]],
      body.sleeping ? "SLEEPING" : "BODY",
      body.objectId || `body ${index + 1}`,
      `${compact(speed)} m/s`,
      body.sleeping ? "muted" : speed > 0.08 ? "info" : "neutral"
    );
  });
}

export function worldLabelsForSpatial(snapshot) {
  const labels = [];
  for (const [index, hit] of (snapshot?.ray?.hits || []).slice(0, 3).entries()) {
    if (!tuple(hit.point)) continue;
    labels.push(label(
      `spatial:hit:${index}`,
      [hit.point[0], hit.point[1] + 0.18, hit.point[2]],
      index === 0 ? "FIRST HIT" : `HIT ${index + 1}`,
      hit.id || hit.objectId || "surface",
      Number.isFinite(hit.distance) ? `${compact(hit.distance)} m` : "",
      index === 0 ? "warn" : "neutral"
    ));
  }
  const free = snapshot?.freeSpace?.point;
  if (tuple(free)) labels.push(label("spatial:free", [free[0], free[1] + 0.2, free[2]], "QUERY", "free space", "candidate", "pass"));
  const support = snapshot?.support;
  if (tuple(support?.surface?.center)) {
    const center = support.surface.center;
    labels.push(label("spatial:support", [center[0], center[1] + 0.14, center[2]], "SUPPORT", support.on ? "supported" : "unsupported", "surface", support.on ? "pass" : "fail"));
  }
  return labels.slice(0, 6);
}

export function worldLabelsForNavigation(snapshot) {
  const labels = [];
  const route = snapshot?.route;
  const start = route?.start?.input || route?.start?.snapped;
  const end = route?.end?.input || route?.end?.snapped;
  if (tuple(start)) labels.push(label("nav:start", [start[0], start[1] + 0.22, start[2]], "ROUTE", "START", "input", "info"));
  if (tuple(end)) labels.push(label("nav:end", [end[0], end[1] + 0.22, end[2]], "ROUTE", "END", route?.reachable ? "reachable" : (route?.reason || "blocked"), route?.reachable ? "pass" : "fail"));
  for (const obstacle of (snapshot?.obstacles || []).slice(0, 3)) {
    if (!tuple(obstacle.position)) continue;
    labels.push(label(`nav:obstacle:${obstacle.id}`, [obstacle.position[0], obstacle.position[1] + 0.42, obstacle.position[2]], "OBSTACLE", obstacle.id || "dynamic", obstacle.action || obstacle.shape || "", "warn"));
  }
  return labels;
}

export function worldLabelsForInteraction(snapshot) {
  const labels = [];
  const reach = snapshot?.reach;
  const eye = reach?.lineOfSight?.eye;
  const aim = reach?.lineOfSight?.aim;
  if (tuple(eye)) labels.push(label("interaction:actor", [eye[0], eye[1] + 0.2, eye[2]], "ACTOR", "agent", reach?.interactable ? "can interact" : "checking reach", "info"));
  if (tuple(aim)) labels.push(label("interaction:target", [aim[0], aim[1] + 0.2, aim[2]], "TARGET", "cup", reach?.visible ? "visible" : "occluded", reach?.visible ? "pass" : "fail"));
  const surface = snapshot?.supportSurface;
  if (tuple(surface?.center)) labels.push(label("interaction:support", [surface.center[0], surface.center[1] + 0.16, surface.center[2]], "SUPPORT", snapshot?.support?.on ? "ON" : "surface", "placement", snapshot?.support?.on ? "pass" : "neutral"));
  return labels;
}

export function worldLabelsForAgent(snapshot) {
  const labels = [];
  const tool = snapshot?.lastTool;
  if (tool?.name === "findFreeSpace" && tuple(tool.result)) {
    labels.push(label("agent:free", [tool.result[0], tool.result[1] + 0.22, tool.result[2]], "TOOL RESULT", "free space", tool.name, "pass"));
  }
  if (tool?.name === "raycast") {
    const hit = Array.isArray(tool.result) ? tool.result[0] : null;
    if (tuple(hit?.point)) labels.push(label("agent:hit", [hit.point[0], hit.point[1] + 0.22, hit.point[2]], "TOOL RESULT", hit.id || hit.objectId || "first hit", tool.name, "warn"));
  }
  if (tool?.name === "getBounds" && tuple(tool.result?.min) && tuple(tool.result?.max)) {
    const center = tool.result.min.map((value, index) => (value + tool.result.max[index]) / 2);
    labels.push(label("agent:bounds", [center[0], tool.result.max[1] + 0.2, center[2]], "TOOL RESULT", tool.args?.id || tool.args?.objectId || "bounds", tool.name, "info"));
  }
  const cup = snapshot?.physics?.bodies?.find((body) => body.objectId === "cup");
  if (tool?.name === "getCarryStatus" && tool.result?.status === "empty" && tuple(cup?.position)) {
    labels.push(label("agent:dropped", [cup.position[0], cup.position[1] + 0.25, cup.position[2]], "VERIFIED", "cup dropped", "settled", "pass"));
  }

  const execution = snapshot?.agent?.execution || [];
  const latestExecution = [...execution].reverse().find((entry) => entry.executed);
  if (!tool && latestExecution?.tool === "getBounds") {
    const id = latestExecution.args?.id || latestExecution.args?.objectId;
    const bound = snapshot?.spatial?.bounds?.find((item) => item.id === id);
    if (tuple(bound?.center) && tuple(bound?.max)) {
      labels.push(label("trace:bounds", [bound.center[0], bound.max[1] + 0.2, bound.center[2]], "PLANNING STEP", id || "bounds", "getBounds · accepted", "info"));
    }
  }
  if (snapshot?.agent?.lastMutation?.tool === "dropHeld" && tuple(cup?.position)) {
    const verified = snapshot.agent.lastMutation?.outcome?.verified === true;
    labels.push(label("trace:mutation", [cup.position[0], cup.position[1] + 0.26, cup.position[2]], verified ? "VERIFIED MUTATION" : "MUTATION", "cup dropped", "replan barrier", verified ? "pass" : "warn"));
  }
  return labels.slice(0, 5);
}

export class WorldLabelLayer {
  constructor({ scene, camera, viewport }) {
    this.scene = scene;
    this.camera = camera;
    this.viewport = viewport;
    this.group = new THREE.Group();
    this.group.name = "observatory-world-labels";
    scene.add(this.group);

    this.renderer = new CSS2DRenderer();
    this.renderer.domElement.className = "obs-world-label-layer";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    viewport.appendChild(this.renderer.domElement);
    this.objects = new Map();
    this.visible = true;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.renderer.domElement.hidden = !this.visible;
  }

  setLabels(labels = []) {
    const nextIds = new Set(labels.map((item) => item.id));
    for (const [id, object] of this.objects) {
      if (nextIds.has(id)) continue;
      this.group.remove(object);
      object.element.remove();
      this.objects.delete(id);
    }

    for (const item of labels) {
      if (!tuple(item.position)) continue;
      let object = this.objects.get(item.id);
      if (!object) {
        const element = document.createElement("div");
        element.className = "obs-world-label";
        element.innerHTML = "<i></i><div><small></small><b></b><span></span></div>";
        object = new CSS2DObject(element);
        object.name = `world-label:${item.id}`;
        this.objects.set(item.id, object);
        this.group.add(object);
      }
      object.position.fromArray(item.position);
      object.element.dataset.tone = item.tone || "neutral";
      object.element.querySelector("small").textContent = item.eyebrow || "";
      object.element.querySelector("b").textContent = item.title || "";
      object.element.querySelector("span").textContent = item.detail || "";
    }
  }

  resize() {
    this.renderer.setSize(Math.max(this.viewport.clientWidth, 1), Math.max(this.viewport.clientHeight, 1));
  }

  render() {
    if (this.visible) this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const object of this.objects.values()) object.element.remove();
    this.objects.clear();
    this.scene.remove(this.group);
    this.renderer.domElement.remove();
  }
}
