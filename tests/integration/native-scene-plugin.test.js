import { it, expect } from 'vitest';
import path from 'node:path';
import { nativeScenePlugin } from '../../dev/nativeScenePlugin.js';

it('adapts only opted-in native project imports, not Runtime, addons or sibling directories', () => {
  const root = path.resolve('examples/native-scene/project');
  const plugin = nativeScenePlugin({ projectRoots: [root] });
  const resolved = plugin.resolveId('three', path.join(root, 'nested', 'main.js'));
  expect(resolved.replaceAll('\\', '/')).toMatch(/application\/native-scene\/NativeThreeModule\.js$/);
  expect(plugin.resolveId('three', path.resolve('application/native-scene/NativeThreeModule.js'))).toBe(null);
  expect(plugin.resolveId('three', root + '-other/main.js')).toBe(null);
  expect(plugin.resolveId('three/addons/controls/OrbitControls.js', path.join(root, 'main.js'))).toBe(null);
});
