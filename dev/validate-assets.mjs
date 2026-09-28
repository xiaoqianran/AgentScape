import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { assetManifests } from '../modules/asset/registry/manifests/index.js';
import { validateAssetManifest } from '../modules/asset/model/schema.js';

function readGlbNodes(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('Not a GLB file');
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}`);
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.toString('ascii', 16, 20) !== 'JSON') throw new Error('GLB JSON chunk missing');
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
  return new Set((json.nodes || []).map((node) => node.name).filter(Boolean));
}

// Validates every manifest. A manifest failure never aborts the sweep, so one bad
// asset cannot hide the rest; every failure names the manifest id, source url and reason.
export async function validateAssetManifests(manifests, { readGlbFile = readFile, log = () => {} } = {}) {
  const failures = [];
  let checked = 0;
  for (const manifest of Object.values(manifests)) {
    try {
      validateAssetManifest(manifest);
      if (manifest.source.kind !== 'glb') continue;
      const url = manifest.source.url.replace(/^\//, '');
      const file = resolve('public', url);
      const nodes = readGlbNodes(await readGlbFile(file));
      const missing = (manifest.requiredNodes || []).filter((name) => !nodes.has(name));
      if (missing.length) throw new Error(`${manifest.id}: missing GLB nodes: ${missing.join(', ')}`);
      log(`✓ ${manifest.id}: ${file} (${nodes.size} named nodes)`);
      checked++;
    } catch (error) {
      const source = manifest?.source?.url || 'unknown source url';
      failures.push(`${manifest?.id || '<unnamed manifest>'} (${source}): ${error.message}`);
    }
  }
  return { failures, checked };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { failures, checked } = await validateAssetManifests(assetManifests, { log: (line) => console.log(line) });
  if (failures.length) {
    console.error('asset validation failed');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log(`Asset validation passed (${checked} GLB asset${checked === 1 ? '' : 's'} checked).`);
}
