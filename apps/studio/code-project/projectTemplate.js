export const projectTemplate = `export async function createProject({ THREE, container, state }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101827');
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(4, 3, 6); camera.lookAt(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const geometry = new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
  const material = new THREE.MeshNormalMaterial();
  const sculpture = new THREE.Mesh(geometry, material);
  scene.add(sculpture);
  let speed = state?.speed ?? 0.5;
  const resize = new ResizeObserver(() => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  });
  resize.observe(container);
  return {
    scene, camera, renderer,
    setup({ scene: api }) {
      api.registerEntity({ id: 'sculpture', label: '旋转雕塑', object: sculpture, read: () => ({ speed }) });
      api.registerAction({ target: 'sculpture', name: 'setSpeed', description: '设置旋转速度',
        parameters: { type: 'object', properties: { speed: { type: 'number' } }, required: ['speed'], additionalProperties: false },
        execute(args) { speed = args.speed; },
        verify({ args, after }) { return after.speed === args.speed; }
      });
    },
    update({ dt }) { sculpture.rotation.y += dt * speed; },
    serialize() { return { speed }; },
    restore(saved) { speed = saved.speed ?? 0.5; },
    dispose() { resize.disconnect(); geometry.dispose(); material.dispose(); renderer.dispose(); }
  };
}`;

export const projectGuide = `Complete trusted JavaScript ES module exporting async createProject(context).
context: { THREE, container, state, resource(name), signal }. THREE is the host engine; do not bare-import another Three.
Return { scene: THREE.Scene, camera, renderer, setup({scene: api, world, signal}), update({dt,timestamp}), render?, serialize(), restore(state), dispose() }.
Append renderer.domElement to container; use ResizeObserver and release resources in dispose.
Shaders, animation, arbitrary JS logic and embedded resources are supported. Studio native multi-file: entry='main.js' and source is the entry content; files maps relative paths to JS/GLSL/WGSL/JSON/TXT text. Use relative import paths. Imported Shader/TXT becomes a default string and JSON becomes a default value. Imports from 'three' bind to context.THREE. Other bare packages, addons, dynamic imports and import cycles require external bundling.
setup registers api.registerEntity({id,label,object?,read:()=>JSON}) and api.registerAction({target,name,description,parameters:JSONSchema,execute(args,{signal}),verify?}).
Discover actions via observeScene; invoke interactScene custom actions after planSceneTask. Verification is optional and never implies physics.
readStudioProject returns entry-source preview, file/resource manifest, revision and runtime capabilities (not embedded base64 or full runtime snapshot). readStudioFile reads one path; editStudioFile creates/writes/patches/renames/deletes text files with expectedRevision; editStudioResource adds/removes base64 resources. writeStudioProject creates/edits a durable draft with expectedRevision; patchStudioProject replaces exactly one unique oldText fragment (optional path) with newText and expectedRevision; runStudioProject activates it; saveStudioProject saves live state, source and assets locally. Read before editing. Running edited code preserves state via serialize/restore. Draft edits are not live until run. No automatic rollback of arbitrary external side effects.`;
