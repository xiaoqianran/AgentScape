import * as THREE from 'three';

export function createPortal() {
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, pulse: { value: 1 } },
    vertexShader: 'varying vec3 local; void main(){ local=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform float time; uniform float pulse; varying vec3 local; void main(){ float wave=.5+.5*sin(local.y*12.+time*3.); gl_FragColor=vec4(mix(vec3(.1,.3,.9),vec3(.2,1.,.65),wave)*pulse,1.); }',
  });
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(1.5, .18, 24, 100), material);
  mesh.name = 'ProjectPortal'; mesh.position.set(0, 1.8, 0);
  const positions = [];
  for (let i = 0; i < 400; i++) {
    const angle = i * 2.39996, radius = 1.6 + .5 * Math.sin(i * 1.73);
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, .2 * Math.cos(i));
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const particles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#71ffd0', size: .045, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false }));
  particles.name = 'PortalParticles'; mesh.add(particles);
  return { mesh, material, particles };
}
