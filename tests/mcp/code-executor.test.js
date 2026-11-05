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
