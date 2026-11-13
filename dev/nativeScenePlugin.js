import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Opt-in startup adapter for copied native projects. No source text rewriting.
 * Add project directories here; their ordinary `import ... from 'three'` stays intact.
 * The shim resolves `three` normally, so addons and the Runtime share one instance.
 */
export function nativeScenePlugin({ projectRoots = [] } = {}) {
  const roots = projectRoots.map(root => path.resolve(root));
  const shim = fileURLToPath(new URL('../application/native-scene/NativeThreeModule.js', import.meta.url));
  return {
    name: 'agentscape-native-scene', enforce: 'pre',
    resolveId(source, importer) {
      if (source !== 'three' || !importer) return null;
      const file = path.resolve(importer.split('?')[0]);
      if (roots.some(root => {
        const relative = path.relative(root, file);
        return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      })) return shim;
      return null;
    },
  };
}
