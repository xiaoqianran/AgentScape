import { rolldown } from 'rolldown';
import * as THREE from 'three';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Bundle ordinary multi-file JS/npm code. Share the host's exact Three instance. */
export async function buildCodeProject({ entry, id, name = id, resources = {} }) {
  const bundle = await rolldown({ input: resolve(entry), plugins: [{
    name: 'project-three-context',
    resolveId(source) { if (source === 'three') return '\0project-three'; },
    load(id) {
      if (id !== '\0project-three') return;
      return `const THREE = context.THREE;\n${Object.keys(THREE).filter(key => /^[A-Za-z_$][\w$]*$/.test(key)).map(key => `export const ${key} = THREE.${key};`).join('\n')}`;
    },
  }] });
  try {
    const { output } = await bundle.generate({ format: 'iife', name: '__AgentScapeProject', codeSplitting: false });
    const chunk = output.find(item => item.type === 'chunk');
    if (!chunk || output.some(item => item.type === 'asset') || chunk.imports.length) throw new Error('PROJECT_BUNDLE_EXTERNAL_RESOURCES: embed resources explicitly');
    return { schema: 'agentscape.code-project', schemaVersion: 1, id, name,
      source: `export async function createProject(context) {\n${chunk.code}\nreturn __AgentScapeProject.createProject(context);\n}\n`, resources };
  } finally { await bundle.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [entry, destination, id = 'my-project', resourcesFile] = process.argv.slice(2);
  if (!entry || !destination) throw new Error('Usage: node dev/build-code-project.mjs entry.js project.json [project-id] [resources.json]');
  const resources = resourcesFile ? JSON.parse(await readFile(resourcesFile, 'utf8')) : {};
  await mkdir(dirname(resolve(destination)), { recursive: true });
  await writeFile(destination, JSON.stringify(await buildCodeProject({ entry, id, resources }), null, 2) + '\n');
  console.log(`Code project written: ${destination}`);
}
