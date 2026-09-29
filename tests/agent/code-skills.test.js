import { describe, expect, it, vi } from 'vitest';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import {
  registerCodeSkills,
  validateAuthoringCode,
  summarizeAuthoringDiff
} from '../../application/skills/packs/codeSkills.js';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { diffAuthoringDocuments } from '../../application/world-authoring/AuthoringDiff.js';

function createFakeRendering() {
  const modes = new Map();
  return {
    addAuthoringScene:(scene, options = {}) => { modes.set(scene, options.mode || 'overlay'); return true; },
    removeAuthoringScene:(scene) => modes.delete(scene),
    setAuthoringSceneMode:(scene, mode) => { if (!modes.has(scene)) return false; modes.set(scene, mode); return true; }
  };
}

function createAuthoringFixture() {
  const world = { events:{ emit:vi.fn() }, rendering:createFakeRendering() };
  const authoring = createWorldAuthoringContext(world);
  const registry = new SkillRegistry({});
  registerCodeSkills((name, options, handler)=>registry.register({ name, ...options, handler }), authoring);
  return { authoring, registry, world };
}

const BOX_CODE = `
const box = new THREE.Mesh(
  new THREE.BoxGeometry(2, 1, 3),
  new THREE.MeshStandardMaterial({ color: '#ffffff' })
);
box.name = 'table';
scene.add(box);
`;

describe('validateAuthoringCode', () => {
  it('accepts ordinary Three.js code', () => {
    expect(validateAuthoringCode(BOX_CODE)).toEqual({ ok:true });
  });

  it('rejects empty or non-string code', () => {
    expect(validateAuthoringCode(undefined).code).toBe('AUTHORING_CODE_REQUIRED');
    expect(validateAuthoringCode('   ').code).toBe('AUTHORING_CODE_REQUIRED');
  });

  it('rejects oversized code', () => {
    expect(validateAuthoringCode('x'.repeat(131073)).code).toBe('AUTHORING_CODE_TOO_LARGE');
  });

  it('rejects ambient capability references fail-closed', () => {
    for (const source of [
      'fetch("/models/a.glb")',
      'window.__secret',
      'document.createElement("canvas")',
      'eval("1+1")',
      'new Function("return 1")',
      'const w = new Worker("w.js")',
      'localStorage.getItem("k")',
      'await import("./x.js")',
      'globalThis.process.exit(1)'
    ]) {
      const result = validateAuthoringCode(source);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('AUTHORING_CODE_FORBIDDEN_API');
    }
  });
});

describe('runAuthoringCode skill', () => {
  it('requires a World authoring context', () => {
    expect(() => registerCodeSkills(()=>{}, null)).toThrow(TypeError);
  });

  it('applies code, commits an agent-code revision and returns a diff summary', async () => {
    const { authoring, registry } = createAuthoringFixture();
    const result = await registry.invoke('runAuthoringCode', { code:BOX_CODE, label:'table draft' });
    expect(result.success).toBe(true);
    expect(result.result.status).toBe('authoring-code-applied');
    expect(result.result.label).toBe('table draft');
    expect(result.result.revision.revision.source).toBe('agent-code');
    expect(result.result.diff.nodes.added.length).toBeGreaterThan(0);
    const entry = authoring.history().at(-1);
    expect(entry.source).toBe('agent-code');
    expect(entry.label).toBe('table draft');
    const object = authoring.scene.children.find((child)=>child.name === 'table');
    expect(object).toBeTruthy();
  });

  it('exposes modelRef inside the sandbox so code can define assets', async () => {
    const { authoring, registry } = createAuthoringFixture();
    const result = await registry.invoke('runAuthoringCode', { code:`
      const cup = new THREE.Group();
      cup.userData.authoringId = 'desk-cup';
      modelRef(cup, { assetRef: { assetId: 'cup' } });
      cup.position.set(0.6, 1, 0);
      scene.add(cup);
    ` });
    expect(result.result.status).toBe('authoring-code-applied');
    const state = authoring.capture();
    expect(state.nodesById['desk-cup'].components.modelRef.properties.source)
      .toEqual({ type:'asset', assetRef:{ assetId:'cup' } });
  });

  it('exposes onFrame inside the sandbox and runs registered handlers', async () => {
    const { authoring, registry, world } = createAuthoringFixture();
    const result = await registry.invoke('runAuthoringCode', { code:`
      onFrame((delta) => { scene.userData.ticked = (scene.userData.ticked || 0) + delta; });
    ` });
    expect(result.result.status).toBe('authoring-code-empty');
    authoring.update(0.5, 0.5);
    expect(authoring.scene.userData.ticked).toBe(0.5);
    expect(world.events.emit).toHaveBeenCalledWith('authoring.changed', {});
  });

  it('restores the draft baseline when code throws and reports the error for retry', async () => {
    const { authoring, registry } = createAuthoringFixture();
    await registry.invoke('runAuthoringCode', { code:BOX_CODE, label:'good' });
    const baseline = authoring.export();
    const failed = await registry.invoke('runAuthoringCode', { code:`
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.StandarMaterial({})));
    ` });
    expect(failed.success).toBe(true);
    expect(failed.result.status).toBe('authoring-code-failed');
    expect(failed.result.reason).toBe('AUTHORING_CODE_EXECUTION_ERROR');
    expect(failed.result.message).toMatch(/StandarMaterial/);
    expect(authoring.export()).toEqual(baseline);
    expect(authoring.history().at(-1).label).toBe('good');
    // the model can retry after fixing the code
    const retried = await registry.invoke('runAuthoringCode', { code:`
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({})));
    `, label:'fixed' });
    expect(retried.result.status).toBe('authoring-code-applied');
  });

  it('rejects forbidden API without touching the draft', async () => {
    const { authoring, registry } = createAuthoringFixture();
    const baseline = authoring.export();
    const rejected = await registry.invoke('runAuthoringCode', { code:'fetch("/leak")' });
    expect(rejected.result.status).toBe('authoring-code-rejected');
    expect(rejected.result.reason).toBe('AUTHORING_CODE_FORBIDDEN_API');
    expect(authoring.export()).toEqual(baseline);
    expect(authoring.scene.children.length).toBe(0);
  });

  it('reports a no-op when code changes nothing', async () => {
    const { registry } = createAuthoringFixture();
    const empty = await registry.invoke('runAuthoringCode', { code:'const unused = 1;' });
    expect(empty.result.status).toBe('authoring-code-empty');
  });

  it('classifies outcomes for the agent loop', async () => {
    const { registry } = createAuthoringFixture();
    expect(registry.executionPolicy('runAuthoringCode', { status:'authoring-code-applied' }))
      .toMatchObject({ mutates:true, barrier:true, outcome:{ state:'accepted', verified:null } });
    expect(registry.executionPolicy('runAuthoringCode', { status:'authoring-code-failed' }).outcome)
      .toMatchObject({ state:'failed', verified:false });
    expect(registry.executionPolicy('runAuthoringCode', { status:'authoring-code-rejected' }).outcome)
      .toMatchObject({ state:'failed', verified:false });
    expect(registry.executionPolicy('runAuthoringCode', { status:'authoring-code-empty' }).outcome)
      .toMatchObject({ state:'noop', verified:false });
  });

  it('keeps the diff summary bounded and derived from the real document diff', () => {
    const { authoring, registry } = createAuthoringFixture();
    const baseline = authoring.export();
    const box = new (authoring.THREE.Mesh)(
      new (authoring.THREE.BoxGeometry)(1, 1, 1),
      new (authoring.THREE.MeshStandardMaterial)()
    );
    box.userData.authoringId = 'node-a';
    authoring.scene.add(box);
    const summary = summarizeAuthoringDiff(diffAuthoringDocuments(baseline, authoring.export()));
    expect(summary.empty).toBe(false);
    expect(summary.nodes.added.map((node)=>node.id)).toEqual(['node-a']);
    expect(summary.resources.added.geometries).toBe(1);
  });
});
