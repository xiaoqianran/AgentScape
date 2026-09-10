import * as THREE from "three";
import {
  OBSERVATORY_COLORS,
  clearVisualGroup,
  createBlockedPathGate,
  createInstrumentMarker,
  createInstrumentPath
} from "../../../visual/DebugVisualPrimitives.js";

export class NavigationDebugRenderer {
  constructor(scene) {
    this.scene = scene;
    this.navMeshGroup = new THREE.Group();
    this.pathGroup = new THREE.Group();
    this.endpointGroup = new THREE.Group();
    this.obstacleGroup = new THREE.Group();
    this.navMeshGroup.name = "observatory-navigation-navmesh";
    this.pathGroup.name = "observatory-navigation-path";
    this.endpointGroup.name = "observatory-navigation-endpoints";
    this.obstacleGroup.name = "observatory-navigation-obstacles";
    scene.add(this.navMeshGroup, this.pathGroup, this.endpointGroup, this.obstacleGroup);
  }

  setNavMeshVisible(visible) { this.navMeshGroup.visible = Boolean(visible); }
  setPathVisible(visible) { this.pathGroup.visible = Boolean(visible); }
  setEndpointsVisible(visible) { this.endpointGroup.visible = Boolean(visible); }
  setObstaclesVisible(visible) { this.obstacleGroup.visible = Boolean(visible); }

  update(snapshot) {
    this.updateNavMesh(snapshot?.navMesh);
    this.updatePath(snapshot?.route);
    this.updateEndpoints(snapshot?.route);
    this.updateObstacles(snapshot?.obstacles || [], snapshot?.diagnosis || null);
  }

  updateNavMesh(navMesh) {
    clearVisualGroup(this.navMeshGroup);
    if (!navMesh?.positions?.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(navMesh.positions, 3));
    if (navMesh.indices?.length) geometry.setIndex(navMesh.indices);
    geometry.computeVertexNormals();

    const surface = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: OBSERVATORY_COLORS.info,
        transparent: true,
        opacity: 0.075,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    surface.renderOrder = 9;
    this.navMeshGroup.add(surface);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: OBSERVATORY_COLORS.structure,
        transparent: true,
        opacity: 0.34,
        depthTest: false
      })
    );
    wire.renderOrder = 10;
    this.navMeshGroup.add(wire);
  }

  updatePath(route) {
    clearVisualGroup(this.pathGroup);
    const points = route?.path;
    if (!Array.isArray(points) || points.length < 2) return;
    this.pathGroup.add(createInstrumentPath(
      points,
      route.reachable ? "pass" : "fail",
      { dashed: !route.reachable, markers: true }
    ));
    if (!route.reachable) {
      const gate = createBlockedPathGate(points, "fail");
      if (gate) this.pathGroup.add(gate);
    }
  }

  updateObstacles(obstacles, diagnosis) {
    clearVisualGroup(this.obstacleGroup);
    const recommended = new Set(
      diagnosis?.candidates
        ?.filter((candidate) => candidate.counterfactual?.reachable)
        .flatMap((candidate) => candidate.obstacleIds || []) || []
    );

    for (const obstacle of obstacles) {
      let geometry = null;
      const position = new THREE.Vector3(...(obstacle.position || [0, 0, 0]));
      if (obstacle.shape === "box" && Array.isArray(obstacle.halfExtents)) {
        geometry = new THREE.BoxGeometry(
          obstacle.halfExtents[0] * 2,
          obstacle.halfExtents[1] * 2,
          obstacle.halfExtents[2] * 2
        );
      } else if (obstacle.shape === "cylinder" && Number.isFinite(obstacle.radius) && Number.isFinite(obstacle.height)) {
        geometry = new THREE.CylinderGeometry(obstacle.radius, obstacle.radius, obstacle.height, 24);
        position.y += obstacle.height / 2;
      }
      if (!geometry) continue;

      const isRecommended = recommended.has(obstacle.id);
      const tone = isRecommended ? "warn" : "fail";
      const color = OBSERVATORY_COLORS[tone];
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity: isRecommended ? 0.82 : 0.48,
          depthTest: false
        })
      );
      mesh.name = `navigation-obstacle:${obstacle.id}`;
      mesh.position.copy(position);
      mesh.rotation.y = obstacle.angle || 0;
      mesh.renderOrder = 22;
      this.obstacleGroup.add(mesh);
      this.obstacleGroup.add(createInstrumentMarker(
        [position.x, position.y + 0.18, position.z],
        tone,
        { radius: 0.045, ring: isRecommended }
      ));
    }
  }

  updateEndpoints(route) {
    clearVisualGroup(this.endpointGroup);
    if (!route) return;
    const startInput = route.start?.input || null;
    const endInput = route.end?.input || null;
    const startSnapped = route.start?.snapped || null;
    const endSnapped = route.end?.snapped || null;
    if (Array.isArray(startInput)) this.endpointGroup.add(createInstrumentMarker(startInput, "warn", { radius: 0.062 }));
    if (Array.isArray(endInput)) this.endpointGroup.add(createInstrumentMarker(endInput, "fail", { radius: 0.062 }));
    if (Array.isArray(startSnapped)) this.endpointGroup.add(createInstrumentMarker(startSnapped, "info", { radius: 0.038, ring: false }));
    if (Array.isArray(endSnapped)) this.endpointGroup.add(createInstrumentMarker(endSnapped, "violet", { radius: 0.038, ring: false }));
  }

  dispose() {
    clearVisualGroup(this.navMeshGroup);
    clearVisualGroup(this.pathGroup);
    clearVisualGroup(this.endpointGroup);
    clearVisualGroup(this.obstacleGroup);
    this.scene.remove(this.navMeshGroup, this.pathGroup, this.endpointGroup, this.obstacleGroup);
  }
}
