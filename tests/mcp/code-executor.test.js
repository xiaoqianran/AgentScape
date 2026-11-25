import { it, expect } from 'vitest';
import { createCodeExecutor } from '../../apps/mcp-server/CodeExecutor.js';
const source = `export function createAsset(THREE) {
 const group = new THREE.Group(); group.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial())); return group;
}`;
for (const mode of ['worker-wasm', 'trusted-local']) {
  it(`${mode} builds a real serialized Three asset without Docker`, async () => {
    const runner = createCodeExecutor({ mode, authorized: true });
    try {
      const result = await runner.run({ mode: 'procedural', source });
      expect(result.document).toBeTruthy();
      expect(result.environment.engine).toBe(mode);
      expect(result.security.osIsolation).toBe(false);
    } finally { runner.close(); }
  }, 30000);
  it(`${mode} cancels an infinite loop and remains usable`, async () => {
    const runner = createCodeExecutor({ mode, authorized: true });
    const controller = new AbortController();
    try {
      await runner.environment();
      const pending = runner.run({ mode: 'procedural', source: 'export function createAsset(THREE) { while(true){} }' }, { signal: controller.signal });
      setTimeout(() => controller.abort(), 100);
      await expect(pending).rejects.toThrow('BUILD_CANCELLED');
      expect((await runner.run({ mode: 'procedural', source })).document).toBeTruthy();
    } finally { runner.close(); }
  }, 30000);
}
it('fails closed for unauthorized, disabled and public non-isolated execution', async () => {
  expect(() => createCodeExecutor({ mode: 'trusted-local' })).toThrow('AUTHORIZATION_REQUIRED');
  expect(() => createCodeExecutor({ remote: true })).toThrow('OS_ISOLATION_REQUIRED');
  await expect(createCodeExecutor({ mode: 'disabled' }).run({ mode: 'procedural', source })).rejects.toThrow('CODE_EXECUTION_DISABLED');
});
it('trusted-local accepts an asynchronous ESM factory in its dedicated Worker', async () => {
  const runner=createCodeExecutor({mode:'trusted-local',authorized:true});
  try {
    const result=await runner.run({mode:'procedural',source:source.replace('export function','export async function')});
    expect(result.document).toBeTruthy();
  } finally {runner.close();}
});


for (const mode of ['worker-wasm', 'trusted-local']) {
  it(`${mode} serializes actual curve/extrude buffers and preserves shared geometry`, async () => {
    const runner=createCodeExecutor({mode,authorized:true});
    try {
      const result=await runner.run({mode:'procedural',source:`export function createAsset(T) {
        const root=new T.Group(), material=new T.MeshStandardMaterial();
        const curve=new T.CatmullRomCurve3([new T.Vector3(0,0,0),new T.Vector3(1,1,0),new T.Vector3(2,0,0)]);
        const tube=new T.TubeGeometry(curve,12,.1,6,false);
        const shape=new T.Shape();shape.moveTo(0,0);shape.lineTo(1,0);shape.lineTo(0,1);shape.closePath();
        const extrude=new T.ExtrudeGeometry(shape,{depth:.3,bevelEnabled:false});
        const lathe=new T.LatheGeometry([new T.Vector2(.1,0),new T.Vector2(.4,.5),new T.Vector2(.1,1)],12);
        tube.translate(3,0,0);
        for(const g of [tube,tube,extrude,lathe])root.add(new T.Mesh(g,material));
        return root;
      }`});
      const geometries=Object.values(result.document.geometries);
      expect(geometries).toHaveLength(3);
      for(const g of geometries) {
        expect(g.type).toBe('BufferGeometry');
        expect(g.json.data.attributes.position.array.length).toBeGreaterThan(0);
        expect(g.json.parameters).toBeUndefined();
      }
      const tube=geometries.find(g=>g.json.data.attributes.position.array.length===13*7*3);
      expect(tube.json.data.attributes.position.array[0]).toBeGreaterThan(2.8);
      expect(tube.json.data.index.array.length).toBe(12*6*6);
    } finally {runner.close();}
  },30000);
}
