import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assetManifests } from '../asset/manifests/index.js';
import { validateAssetManifest } from '../asset/schema.js';

function readGlbNodes(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('Not a GLB file');
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}`);
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.toString('ascii', 16, 20) !== 'JSON') throw new Error('GLB JSON chunk missing');
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
  return new Set((json.nodes || []).map((node) => node.name).filter(Boolean));
}

let checked = 0;
for (const manifest of Object.values(assetManifests)) {
  validateAssetManifest(manifest);
  if (manifest.source.kind !== 'glb') continue;
  const url = manifest.source.url.replace(/^\//, '');
  const file = resolve('public', url);
  const nodes = readGlbNodes(await readFile(file));
  const missing = (manifest.requiredNodes || []).filter((name) => !nodes.has(name));
  if (missing.length) throw new Error(`${manifest.id}: missing GLB nodes: ${missing.join(', ')}`);
  console.log(`✓ ${manifest.id}: ${file} (${nodes.size} named nodes)`);
  checked++;
}
console.log(`Asset validation passed (${checked} GLB asset${checked === 1 ? '' : 's'} checked).`);
