import * as THREE from 'three';

// Standalone hinged door, authored from primitive geometry.
// The hinge pivot is the left edge of the leaf, not its center.
export async function createHouseDoor() {
  const root = new THREE.Group();
  root.name = 'HouseDoor';
  const hinge = new THREE.Group();
  hinge.name = 'doorHinge';
  hinge.position.set(-0.6, 0.62, 0);
  root.add(hinge);

  const wood = new THREE.MeshStandardMaterial({color:0x81563b,roughness:0.64});
  const trim = new THREE.MeshStandardMaterial({color:0x5b3927,roughness:0.72});
  const metal = new THREE.MeshStandardMaterial({color:0xc8ae74,metalness:0.65,roughness:0.3});
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.18,2.02,0.075), wood);
  leaf.name = 'Door';
  leaf.position.set(0.59,1.01,0);
  leaf.castShadow = leaf.receiveShadow = true;
  hinge.add(leaf);
  for(const y of [0.37,1.64]) {
    const panel=new THREE.Mesh(new THREE.BoxGeometry(0.92,0.48,0.017),trim);
    panel.position.set(0.59,y,0.046);
    panel.castShadow = true;
    hinge.add(panel);
  }
  for(const side of [-1,1]) {
    const knob=new THREE.Mesh(new THREE.SphereGeometry(0.057,12,8),metal);
    knob.position.set(1.04,1.03,side*0.12);
    hinge.add(knob);
  }
  return root;
}