import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import styles from "./SceneViewport.module.css";

function buildStarterScene() {
  const root = new THREE.Group();
  root.name = "Scene";

  // Ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64),
    new THREE.MeshStandardMaterial({ color: "#1a1a1a", roughness: 0.9, metalness: 0.05 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = "Ground";
  ground.receiveShadow = true;
  root.add(ground);

  // Soft grid
  const grid = new THREE.GridHelper(16, 32, 0x2a2a2a, 0x222222);
  grid.position.y = 0.01;
  grid.name = "Grid";
  root.add(grid);

  const mats = {
    blue: new THREE.MeshStandardMaterial({ color: "#5b8cff", roughness: 0.25, metalness: 0.35 }),
    pink: new THREE.MeshStandardMaterial({ color: "#ff6b9d", roughness: 0.3, metalness: 0.2 }),
    yellow: new THREE.MeshStandardMaterial({ color: "#f5c842", roughness: 0.35, metalness: 0.15 }),
    salmon: new THREE.MeshStandardMaterial({ color: "#ff8a7a", roughness: 0.4, metalness: 0.1 }),
    white: new THREE.MeshStandardMaterial({ color: "#f2f2f2", roughness: 0.45, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: "#2c2c2c", roughness: 0.55, metalness: 0.2 }),
  };

  const add = (mesh, name) => {
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  // Center stack — spheres like the starter showcase
  const sphereBlue = add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 48), mats.blue), "sphere blue");
  sphereBlue.position.set(0, 1.15, 0);

  const spherePink = add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 32), mats.pink), "sphere pink");
  spherePink.position.set(1.5, 0.6, 0.6);

  const sphereYellow = add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 32), mats.yellow), "sphere yellow");
  sphereYellow.position.set(-1.35, 0.5, 0.9);

  // Torus + box accents
  const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.08, 16, 80), mats.yellow), "ring gold");
  ring.rotation.x = Math.PI / 2.4;
  ring.position.y = 1.15;

  const cube = add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mats.salmon), "cube glow");
  cube.position.set(-1.6, 0.4, -1.2);
  cube.rotation.y = 0.5;

  const cup = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.55, 24), mats.white), "cup");
  cup.position.set(1.7, 0.3, -1.1);

  const block = add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 1.1), mats.dark), "Ground deck");
  block.position.set(0, 0.1, -1.8);

  return { root, names: root.children.map((c) => c.name).filter(Boolean) };
}

export default function SceneViewport({ selected, onSelect }) {
  const mountRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 640;
    const height = mount.clientHeight || 480;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0a0a0a");

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(5.2, 3.4, 6.2);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1.1);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(5, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);

    const fill = new THREE.PointLight(0x5b8cff, 0.6, 30);
    fill.position.set(-4, 3, -2);
    scene.add(fill);

    const { root } = buildStarterScene();
    scene.add(root);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, 1, 0);
    controls.update();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let frame = 0;
    let disposed = false;
    let t = 0;

    const pickables = root.children.filter((c) => c.isMesh && c.name !== "Grid");

    const onClick = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits[0]) onSelect?.(hits[0].object.name);
    };
    renderer.domElement.addEventListener("click", onClick);

    const animate = () => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      if (apiRef.current?.paused) return;
      t += 0.01;
      // gentle idle motion on showcase spheres
      const blue = root.getObjectByName("sphere blue");
      const pink = root.getObjectByName("sphere pink");
      const yellow = root.getObjectByName("sphere yellow");
      const ringObj = root.getObjectByName("ring gold");
      if (blue) blue.position.y = 1.15 + Math.sin(t * 1.4) * 0.08;
      if (pink) pink.position.y = 0.6 + Math.sin(t * 1.8 + 1) * 0.06;
      if (yellow) yellow.position.y = 0.5 + Math.sin(t * 1.6 + 2) * 0.05;
      if (ringObj) ringObj.rotation.z = t * 0.25;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    apiRef.current = { scene, root, renderer, paused: false };

    const onResize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [onSelect]);

  // highlight selection via emissive
  useEffect(() => {
    const root = apiRef.current?.root;
    if (!root) return;
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material || obj.name === "Grid") return;
      const mat = obj.material;
      if (!mat.emissive) return;
      mat.emissive.set(obj.name === selected ? "#3355ff" : "#000000");
      mat.emissiveIntensity = obj.name === selected ? 0.35 : 0;
    });
  }, [selected]);

  // pause rendering when host is hidden; keep WebGL context alive
  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    const sync = () => {
      const view = host.closest("[data-view]");
      const hidden = !view || view.getAttribute("data-active") !== "1";
      if (apiRef.current) apiRef.current.paused = hidden;
    };
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-active", "class"] });
    sync();
    return () => obs.disconnect();
  }, []);

  return (
    <div className={styles.viewport}>
      <div ref={mountRef} className={styles.canvasMount} />
    </div>
  );
}
