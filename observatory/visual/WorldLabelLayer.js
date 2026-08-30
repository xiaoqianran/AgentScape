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
      body.sleeping ? "休眠" : "刚体",
      body.objectId || `刚体 ${index + 1}`,
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
      index === 0 ? "首次命中" : `命中 ${index + 1}`,
      hit.id || hit.objectId || "表面",
      Number.isFinite(hit.distance) ? `${compact(hit.distance)} m` : "",
      index === 0 ? "warn" : "neutral"
    ));
  }
  const free = snapshot?.freeSpace?.point;
  if (tuple(free)) labels.push(label("spatial:free", [free[0], free[1] + 0.2, free[2]], "查询", "自由空间", "候选点", "pass"));
  const support = snapshot?.support;
  if (tuple(support?.surface?.center)) {
    const center = support.surface.center;
    labels.push(label("spatial:support", [center[0], center[1] + 0.14, center[2]], "支撑", support.on ? "已支撑" : "未支撑", "表面", support.on ? "pass" : "fail"));
  }
  return labels.slice(0, 6);
}

export function worldLabelsForNavigation(snapshot) {
  const labels = [];
  const route = snapshot?.route;
  const start = route?.start?.input || route?.start?.snapped;
  const end = route?.end?.input || route?.end?.snapped;
  if (tuple(start)) labels.push(label("nav:start", [start[0], start[1] + 0.22, start[2]], "路径", "起点", "输入", "info"));
  if (tuple(end)) labels.push(label("nav:end", [end[0], end[1] + 0.22, end[2]], "路径", "终点", route?.reachable ? "可达" : (route?.reason || "受阻"), route?.reachable ? "pass" : "fail"));
  if (!route?.reachable && Array.isArray(route?.path) && tuple(route.path.at(-1))) {
    const blocked = route.path.at(-1);
    labels.push(label("nav:blocked", [blocked[0], blocked[1] + 0.24, blocked[2]], "路径停止", "阻断点", route.reason || "目标不可达", "fail"));
  }
  for (const obstacle of (snapshot?.obstacles || []).slice(0, 3)) {
    if (!tuple(obstacle.position)) continue;
    labels.push(label(`nav:obstacle:${obstacle.id}`, [obstacle.position[0], obstacle.position[1] + 0.42, obstacle.position[2]], "障碍物", obstacle.id || "动态障碍物", obstacle.action || obstacle.shape || "", "warn"));
  }
  return labels;
}

export function worldLabelsForInteraction(snapshot) {
  const labels = [];
  const reach = snapshot?.reach;
  const eye = reach?.lineOfSight?.eye;
  const aim = reach?.lineOfSight?.aim;
  if (tuple(eye)) labels.push(label("interaction:actor", [eye[0], eye[1] + 0.2, eye[2]], "主体", "智能体", reach?.interactable ? "可交互" : "检查交互范围", "info"));
  if (tuple(aim)) labels.push(label("interaction:target", [aim[0], aim[1] + 0.2, aim[2]], "目标", "杯子", reach?.visible ? "可见" : "被遮挡", reach?.visible ? "pass" : "fail"));
  const surface = snapshot?.supportSurface;
  if (tuple(surface?.center)) labels.push(label("interaction:support", [surface.center[0], surface.center[1] + 0.16, surface.center[2]], "支撑", snapshot?.support?.on ? "位于其上" : "表面", "放置", snapshot?.support?.on ? "pass" : "neutral"));
  return labels;
}

export function worldLabelsForAgent(snapshot) {
  const labels = [];
  const tool = snapshot?.lastTool;
  if (tool?.name === "findFreeSpace" && tuple(tool.result)) {
    labels.push(label("agent:free", [tool.result[0], tool.result[1] + 0.22, tool.result[2]], "工具结果", "自由空间", tool.name, "pass"));
  }
  if (tool?.name === "raycast") {
    const hit = Array.isArray(tool.result) ? tool.result[0] : null;
    if (tuple(hit?.point)) labels.push(label("agent:hit", [hit.point[0], hit.point[1] + 0.22, hit.point[2]], "工具结果", hit.id || hit.objectId || "首次命中", tool.name, "warn"));
  }
  if (tool?.name === "getBounds" && tuple(tool.result?.min) && tuple(tool.result?.max)) {
    const center = tool.result.min.map((value, index) => (value + tool.result.max[index]) / 2);
    labels.push(label("agent:bounds", [center[0], tool.result.max[1] + 0.2, center[2]], "工具结果", tool.args?.id || tool.args?.objectId || "边界", tool.name, "info"));
  }
  const cup = snapshot?.physics?.bodies?.find((body) => body.objectId === "cup");
  if (tool?.name === "getCarryStatus" && tool.result?.status === "empty" && tuple(cup?.position)) {
    labels.push(label("agent:dropped", [cup.position[0], cup.position[1] + 0.25, cup.position[2]], "已验证", "杯子已放下", "已稳定", "pass"));
  }

  if (snapshot?.source === "generation-agent-build") {
    const generatedId = snapshot?.generation?.instanceId;
    const generatedBody = snapshot?.physics?.bodies?.find((body) => body.objectId === generatedId);
    const relation = snapshot?.generation?.relations?.find((edge) => edge.subject === generatedId && edge.predicate === "ON");
    if (generatedId && tuple(generatedBody?.position)) {
      labels.push(label(
        "generation:asset",
        [generatedBody.position[0], generatedBody.position[1] + 0.34, generatedBody.position[2]],
        relation ? "已验证生成资产" : "生成资产",
        snapshot.generation.asset?.type === "apple" ? "红苹果" : generatedId,
        relation ? `ON · ${relation.object}` : (snapshot.generation.asset?.admission?.status || "已实例化"),
        relation ? "pass" : "info"
      ));
    }
  }

  const execution = snapshot?.agent?.execution || [];
  const latestExecution = [...execution].reverse().find((entry) => entry.executed);
  if (!tool && latestExecution?.tool === "getBounds") {
    const id = latestExecution.args?.id || latestExecution.args?.objectId;
    const bound = snapshot?.spatial?.bounds?.find((item) => item.id === id);
    if (tuple(bound?.center) && tuple(bound?.max)) {
      labels.push(label("trace:bounds", [bound.center[0], bound.max[1] + 0.2, bound.center[2]], "规划步骤", id || "边界", "getBounds · 已接受", "info"));
    }
  }
  if (snapshot?.agent?.lastMutation?.tool === "dropHeld" && tuple(cup?.position)) {
    const verified = snapshot.agent.lastMutation?.outcome?.verified === true;
    labels.push(label("trace:mutation", [cup.position[0], cup.position[1] + 0.26, cup.position[2]], verified ? "已验证变更" : "变更", "杯子已放下", "重新规划屏障", verified ? "pass" : "warn"));
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
    this.hoveredId = null;
    this.onPointerMove = (event) => {
      let nextId = null;
      let closest = 30;
      if (this.hoveredId) {
        const currentCard = this.objects.get(this.hoveredId)?.labelElement;
        const cardRect = currentCard?.getBoundingClientRect();
        if (cardRect && event.clientX >= cardRect.left && event.clientX <= cardRect.right && event.clientY >= cardRect.top && event.clientY <= cardRect.bottom) {
          nextId = this.hoveredId;
        }
      }
      for (const [id, object] of this.objects) {
        if (nextId) break;
        const pin = object.pinElement;
        if (!pin) continue;
        const pinRect = pin.getBoundingClientRect();
        const distance = Math.hypot(event.clientX - (pinRect.left + pinRect.width / 2), event.clientY - (pinRect.top + pinRect.height / 2));
        if (distance < closest) {
          closest = distance;
          nextId = id;
        }
      }
      this.setHovered(nextId);
    };
    this.onPointerLeave = () => {
      this.setHovered(null);
    };
    viewport.addEventListener("pointermove", this.onPointerMove);
    viewport.addEventListener("pointerleave", this.onPointerLeave);
  }

  setHovered(id) {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    for (const [objectId, object] of this.objects) {
      object.element.classList.toggle("is-hovered", objectId === id);
    }
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    if (!this.visible) this.setHovered(null);
    this.renderer.domElement.hidden = !this.visible;
  }

  setLabels(labels = []) {
    const nextIds = new Set(labels.map((item) => item.id));
    for (const [id, object] of this.objects) {
      if (nextIds.has(id)) continue;
      if (this.hoveredId === id) this.hoveredId = null;
      this.group.remove(object);
      object.element.remove();
      this.objects.delete(id);
    }

    for (const item of labels) {
      if (!tuple(item.position)) continue;
      let object = this.objects.get(item.id);
      if (!object) {
        const anchor = document.createElement("div");
        anchor.className = "obs-world-label-anchor";
        const pin = document.createElement("i");
        pin.className = "obs-world-label-pin";
        pin.setAttribute("aria-hidden", "true");
        const element = document.createElement("div");
        element.className = "obs-world-label";
        element.innerHTML = "<i></i><div><small></small><b></b><span></span></div>";
        anchor.append(pin, element);
        object = new CSS2DObject(anchor);
        object.pinElement = pin;
        object.labelElement = element;
        object.name = `world-label:${item.id}`;
        this.objects.set(item.id, object);
        this.group.add(object);
      }
      object.position.fromArray(item.position);
      object.labelElement.dataset.tone = item.tone || "neutral";
      object.labelElement.querySelector("small").textContent = item.eyebrow || "";
      object.labelElement.querySelector("b").textContent = item.title || "";
      object.labelElement.querySelector("span").textContent = item.detail || "";
    }
  }

  resize() {
    this.renderer.setSize(Math.max(this.viewport.clientWidth, 1), Math.max(this.viewport.clientHeight, 1));
  }

  render() {
    if (!this.visible) return;
    this.renderer.render(this.scene, this.camera);

    const viewportRect = this.viewport.getBoundingClientRect();
    const badge = this.viewport.closest(".obs-stage")?.querySelector(".obs-stage-title");
    const badgeRect = badge?.getBoundingClientRect();
    const padding = 8;

    for (const object of this.objects.values()) {
      const element = object.labelElement;
      if (!element || !object.element.classList.contains("is-hovered")) continue;
      element.style.setProperty("--obs-label-shift-x", "0px");
      element.style.setProperty("--obs-label-shift-y", "0px");
      let rect = element.getBoundingClientRect();
      let shiftX = 0;
      let shiftY = 0;
      if (rect.left < viewportRect.left + padding) shiftX += viewportRect.left + padding - rect.left;
      if (rect.right > viewportRect.right - padding) shiftX -= rect.right - (viewportRect.right - padding);
      if (rect.top < viewportRect.top + padding) shiftY += viewportRect.top + padding - rect.top;
      if (rect.bottom > viewportRect.bottom - padding) shiftY -= rect.bottom - (viewportRect.bottom - padding);

      if (badgeRect && rect.left < badgeRect.right && rect.right > badgeRect.left && rect.top < badgeRect.bottom && rect.bottom > badgeRect.top) {
        shiftY += badgeRect.bottom + padding - rect.top;
        rect = { x: rect.x + shiftX, y: rect.y + shiftY, width: rect.width, height: rect.height, bottom: rect.bottom + shiftY };
        if (rect.bottom > viewportRect.bottom - padding) {
          shiftY -= rect.bottom - (viewportRect.bottom - padding);
          shiftX += badgeRect.left + padding - rect.right;
        }
      }

      element.style.setProperty("--obs-label-shift-x", `${shiftX}px`);
      element.style.setProperty("--obs-label-shift-y", `${shiftY}px`);
    }
  }

  dispose() {
    this.viewport.removeEventListener("pointermove", this.onPointerMove);
    this.viewport.removeEventListener("pointerleave", this.onPointerLeave);
    for (const object of this.objects.values()) object.element.remove();
    this.objects.clear();
    this.scene.remove(this.group);
    this.renderer.domElement.remove();
  }
}
