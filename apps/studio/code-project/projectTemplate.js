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
      // Code owns geometry/rotation; the visual editor may adjust location and visibility.
      api.registerEditable({ id:'sculpture', object:sculpture, properties:['position','visible'] });
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
Shaders, animation, arbitrary JS logic and embedded resources are supported. Studio native multi-file: entry='main.js' and source is the entry content; files maps relative paths to JS/GLSL/WGSL/JSON/TXT text. Use relative import paths. Imported Shader/TXT becomes a default string and JSON becomes a default value. Imports from 'three' bind to context.THREE. Direct editor mode supports relative modules, string-literal dynamic import('./lazy.js') and import('three'); other bare npm packages, addons and computed dynamic import expressions require an external bundler. Circular dependencies should be prebundled.
setup can opt in live Three.js objects with api.registerEditable({id,object,label?,properties:['position','quaternion','scale','visible']}); only explicit properties are editable, selected by stable per-world ID. GUI and MCP use scene.apply({operations:[{type:'editNative',id,changes:{position:[x,y,z]}}]}) through one Scene edit gate. Visual edits live in a separate optional project.edits snapshot, replayed after code reruns, while ordinary editor-created models live in project.runtime. Never expose actively code-animated properties for editing without coordinating ownership.
setup registers api.registerEntity({id,label,object?,read:()=>JSON}) and api.registerAction({target,name,description,parameters:JSONSchema,execute(args,{signal}),verify?}).
For objects with repeatable interactions prefer api.registerStateMachine({id,label,object,initialState,transitions:[{name,description,when:[{field,op,value|other}],effects:[{field,op:'set'|'add',value}]}],timers?,ranges?,onChange(next),verifyVisual(next)}). This automatically registers guarded actions with verified project-owned state and saves/restores machine state without project.serialize. Timed behaviors call the returned machine.advance(dt) from update(). Actions may use expose:false for internal clock completions. Example: examples/code-project/semantic-workshop.json (book pages and rice cooker). This verifies Three.js/state, not physical grasping.
Discover actions via observeScene; invoke registered actions through interactScene with action:invoke after planSceneTask. Verification is optional and never implies physics.
readStudioProject returns entry-source preview, file/resource manifest, revision and runtime capabilities (not embedded base64 or full runtime snapshot). For coordinated edits prefer previewStudioProjectBatch({expectedRevision,operations:[{kind:'file',action:'create|write|patch|rename|delete',path,...}, {kind:'resource',action:'add|delete',path,...}]}) to inspect bounded diffs without publishing. Then applyStudioProjectBatch({previewId,expectedRevision}) to atomically persist all files in one revision. discardStudioProjectBatch({previewId}) cancels the preview, and undoStudioProjectBatch({expectedRevision}) reverts the latest batch only if no subsequent edits occurred. Re-run before saving live world state. readStudioFile reads one path; editStudioFile creates/writes/patches/renames/deletes text files with expectedRevision; editStudioResource adds/removes base64 resources. writeStudioProject creates/edits a durable draft with expectedRevision; patchStudioProject replaces exactly one unique oldText fragment (optional path) with newText and expectedRevision; runStudioProject activates it; saveStudioProject saves live state, source and assets locally. Read before editing. Through MCP, studio_project inspect(expectedRevision,nodePath,offset,limit) reads actual native geometry and instance counts, world bounds and camera frustum coverage, without entity registration; child-index paths are scoped to the current runtime. Bounds are approximate and can be incomplete; lines and points use geometric centers (not screen-space width). Inspect smaller subtrees when limited. capture returns real JPEG (imageMode=mcp for vision-capable clients, default base64); initializing canvases may return VISUAL_CANVAS_NOT_READY after a short wait, retry on the same running revision; optional view={position:[x,y,z],target:[x,y,z],fov:45} renders an independent perspective camera without changing the authored camera or advancing simulation. Use view={nodePath,direction:[x,y,z],fov:45,padding:1.12} to automatically frame a measured subtree; incomplete/empty bounds are rejected. operation=search scans up to 8192 native Object3D nodes by query, objectType and material, returning runtime-local nodePath pages; internal Studio gizmo/outline nodes are excluded unless includeInternal=true. operation=inspect_batch inspects 1-8 paths in one synchronous snapshot with per-path CPU/geometry budgets; optional visibility is limited to 4 paths. operation=suggest_views evaluates 2-12 independent candidate cameras with a configurable 3-7 ray grid (default 5×5) and ranks their estimated visible fraction; it is not pixel-perfect or a guarantee of an unobstructed view. includeLights=true reports bounded light transforms, color, intensity, shadow and spot parameters (Three.js intensity is not lux). Pass expectedSceneRevision from the latest result to reject stale paths. Studio GUI includes the same search, batch and local preview actions. Inspection views use direct rendering, not custom postprocessing. inspect can includeMaterials=true and visibility=true (49 approximate opaque-mesh ray samples, not pixel coverage), with optional view; capture isolateNodePath temporarily masks unrelated renderables. Supply expectedRuntimeId for runtime-local paths. timeline(expectedRevision,command,steps) supports status/pause/resume/step; step 1-120 fixed ticks while paused. Resume before actions. Playback control is session-local, not a persisted timeline or arbitrary seek; external JS timers are not controlled. Use scene_verify object-exists only for observed registered IDs. Running edited code preserves state via serialize/restore. Draft edits are not live until run. No automatic rollback of arbitrary external side effects.`;
