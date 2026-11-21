import { rolldown } from 'rolldown';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const rawPrefix = '\0agentscape-raw:';
const rawSource = value => /\?(?:raw)$/.test(value) || /\.(?:glsl|vert|frag|wgsl|txt)$/.test(value);

/** Build a normal ESM/npm project into editable offline Code Project files. */
export async function buildCodeProject({ entry, id, name = id, resources = {} }) {
  const bundle = await rolldown({
    input: resolve(entry),
    // Do not bundle a second copy of Three.js into the embedded Studio Runtime.
    external: specifier => specifier === 'three',
    plugins: [{
      name: 'code-project-text-imports',
      resolveId(specifier, importer) {
        if (!importer || !/^\.\.?\//.test(specifier) || !rawSource(specifier)) return null;
        const path = specifier.endsWith('?raw') ? specifier.slice(0, -4) : specifier;
        return rawPrefix + resolve(dirname(importer), path);
      },
      async load(id) {
        if (!id.startsWith(rawPrefix)) return null;
        const content = await readFile(id.slice(rawPrefix.length), 'utf8');
        return 'export default ' + JSON.stringify(content) + ';';
      }
    }]
  });
  try {
    const { output } = await bundle.generate({
      format: 'es', codeSplitting: true, entryFileNames: 'main.js',
      chunkFileNames: 'chunks/[name]-[hash].js'
    });
    const chunks = output.filter(item => item.type === 'chunk');
    const main = chunks.find(item => item.isEntry);
    if (!main || main.fileName !== 'main.js' || output.some(item => item.type === 'asset'))
      throw new Error('PROJECT_BUNDLE_EXTERNAL_RESOURCES: embed binary resources explicitly');
    const names = new Set(chunks.map(item => item.fileName));
    for (const chunk of chunks) {
      for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
        if (dependency !== 'three' && !names.has(dependency))
          throw new Error('PROJECT_BUNDLE_EXTERNAL_IMPORT: ' + dependency);
      }
    }
    return { schema: 'agentscape.code-project', schemaVersion: 1, id, name,
      entry: main.fileName, source: main.code,
      files: Object.fromEntries(chunks.filter(chunk => chunk !== main)
        .map(chunk => [chunk.fileName, chunk.code])), resources };
  } finally { await bundle.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [entry, destination, id = 'my-project', resourcesFile] = process.argv.slice(2);
  if (!entry || !destination)
    throw new Error('Usage: node dev/build-code-project.mjs entry.js project.json [project-id] [resources.json]');
  const resources = resourcesFile ? JSON.parse(await readFile(resourcesFile, 'utf8')) : {};
  await mkdir(dirname(resolve(destination)), { recursive: true });
  await writeFile(destination, JSON.stringify(await buildCodeProject({ entry, id, resources }), null, 2) + '\n');
  console.log('Editable Code Project written: ' + destination);
}
