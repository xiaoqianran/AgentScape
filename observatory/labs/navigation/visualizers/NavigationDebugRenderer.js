import * as THREE from "three";

const clearGroup = (group) => {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  }
};

const sphere = (position, color, radius = 0.08) => {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 8),
    new THREE.MeshBasicMaterial({ color, depthTest: false })
  );
  mesh.position.fromArray(position);
  mesh.renderOrder = 24;
  return mesh;
};

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
    clearGroup(this.navMeshGroup);
    if (!navMesh?.positions?.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(navMesh.positions, 3));
    if (navMesh.indices?.length) geometry.setIndex(navMesh.indices);
    geometry.computeVertexNormals();

    const surface = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0x4f8eb8, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })
    );
    surface.renderOrder = 10;
    this.navMeshGroup.add(surface);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x8bc2df, transparent: true, opacity: 0.75, depthTest: false })
    );
    wire.renderOrder = 11;
    this.navMeshGroup.add(wire);
  }

  updatePath(route) {
    clearGroup(this.pathGroup);
    const points = route?.path;
    if (!Array.isArray(points) || points.length < 2) return;
    const vectors = points.map((point) => new THREE.Vector3(...point));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(vectors),
      new THREE.LineBasicMaterial({ color: route.reachable ? 0x6fd59b : 0xe6846f, depthTest: false })
    );
    line.renderOrder = 22;
    this.pathGroup.add(line);
    for (const point of points) this.pathGroup.add(sphere(point, route.reachable ? 0x6fd59b : 0xe6846f, 0.055));
  }

  updateObstacles(obstacles, diagnosis) {
    clearGroup(this.obstacleGroup);
    const recommended = new Set(diagnosis?.candidates?.filter((candidate) => candidate.counterfactual?.reachable).flatMap((candidate) => candidate.obstacleIds || []) || []);
    for (const obstacle of obstacles) {
      let geometry = null;
      const position = new THREE.Vector3(...(obstacle.position || [0, 0, 0]));
      if (obstacle.shape === "box" && Array.isArray(obstacle.halfExtents)) {
        geometry = new THREE.BoxGeometry(obstacle.halfExtents[0] * 2, obstacle.halfExtents[1] * 2, obstacle.halfExtents[2] * 2);
      } else if (obstacle.shape === "cylinder" && Number.isFinite(obstacle.radius) && Number.isFinite(obstacle.height)) {
        geometry = new THREE.CylinderGeometry(obstacle.radius, obstacle.radius, obstacle.height, 24);
        position.y += obstacle.height / 2;
      }
      if (!geometry) continue;
      const isRecommended = recommended.has(obstacle.id);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: isRecommended ? 0xf0b85d : 0xe26d6d,
          wireframe: true,
          transparent: true,
          opacity: isRecommended ? 0.9 : 0.65,
          depthTest: false
        })
      );
      mesh.name = `navigation-obstacle:${obstacle.id}`;
      mesh.position.copy(position);
      mesh.rotation.y = obstacle.angle || 0;
      mesh.renderOrder = 23;
      this.obstacleGroup.add(mesh);
    }
  }

  updateEndpoints(route) {
    clearGroup(this.endpointGroup);
    if (!route) return;
    const startInput = route.start?.input || null;
    const endInput = route.end?.input || null;
    const startSnapped = route.start?.snapped || null;
    const endSnapped = route.end?.snapped || null;
    if (Array.isArray(startInput)) this.endpointGroup.add(sphere(startInput, 0xf3c766, 0.095));
    if (Array.isArray(endInput)) this.endpointGroup.add(sphere(endInput, 0xec8e8e, 0.095));
    if (Array.isArray(startSnapped)) this.endpointGroup.add(sphere(startSnapped, 0x7ad1df, 0.06));
    if (Array.isArray(endSnapped)) this.endpointGroup.add(sphere(endSnapped, 0xb78ce5, 0.06));
  }

  dispose() {
    clearGroup(this.navMeshGroup);
    clearGroup(this.pathGroup);
    clearGroup(this.endpointGroup);
    clearGroup(this.obstacleGroup);
    this.scene.remove(this.navMeshGroup, this.pathGroup, this.endpointGroup, this.obstacleGroup);
  }
}
