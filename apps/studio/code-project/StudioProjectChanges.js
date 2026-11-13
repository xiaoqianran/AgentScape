import { assertCodeFilePath, projectFileEntries } from '../../../application/native-scene/CodeProjectModules.js';

const fail = code => Object.assign(new Error(code), { code });
const clone = value => structuredClone(value);

export function patchProjectText(source, { oldText, newText } = {}) {
  if (typeof oldText !== 'string' || !oldText.length || typeof newText !== 'string') throw fail('PROJECT_PATCH_INVALID');
  const start = source.indexOf(oldText);
  if (start < 0) throw fail('PROJECT_PATCH_NOT_FOUND');
  if (source.indexOf(oldText, start + 1) >= 0) throw fail('PROJECT_PATCH_AMBIGUOUS');
  if (oldText === newText) throw fail('PROJECT_PATCH_UNCHANGED');
  return source.slice(0, start) + newText + source.slice(start + oldText.length);
}

function assertResourcePath(path) {
  if (typeof path !== 'string' || path.length > 180 ||
    !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
    path.split('/').some(part => part === '.' || part === '..')) throw fail('PROJECT_RESOURCE_PATH_INVALID');
  return path;
}

function applyFile(project, change) {
  const { action, path, newPath, content, oldText, newText } = change;
  assertCodeFilePath(path);
  project.entry ||= 'main.js';
  project.files ||= {};
  const entry = project.entry;
  const exists = path === entry || Object.hasOwn(project.files, path);
  if (action === 'create') {
    if (exists) throw fail('PROJECT_FILE_EXISTS');
    if (typeof content !== 'string') throw fail('PROJECT_FILE_CONTENT_REQUIRED');
    project.files[path] = content;
  } else if (action === 'write' || action === 'patch') {
    if (!exists) throw fail('PROJECT_FILE_NOT_FOUND');
    const previous = path === entry ? project.source : project.files[path];
    const updated = action === 'patch' ? patchProjectText(previous, { oldText, newText }) : content;
    if (typeof updated !== 'string') throw fail('PROJECT_FILE_CONTENT_REQUIRED');
    if (updated === previous && (change.name === undefined || change.name === project.name)) throw fail('PROJECT_PATCH_UNCHANGED');
    if (path === entry) project.source = updated;
    else project.files[path] = updated;
    if (change.name !== undefined) project.name = change.name;
  } else if (action === 'rename') {
    assertCodeFilePath(newPath);
    if (!exists) throw fail('PROJECT_FILE_NOT_FOUND');
    if (newPath === entry || Object.hasOwn(project.files,newPath)) throw fail('PROJECT_FILE_EXISTS');
    if (path === entry) project.entry = newPath;
    else { project.files[newPath] = project.files[path]; delete project.files[path]; }
  } else if (action === 'delete') {
    if (path === entry) throw fail('PROJECT_ENTRY_REQUIRED');
    if (!exists) throw fail('PROJECT_FILE_NOT_FOUND');
    delete project.files[path];
  } else throw fail('PROJECT_FILE_ACTION_INVALID');
}

function applyResource(project, change) {
  const { action, path, mime, base64 } = change;
  assertResourcePath(path);
  project.resources ||= {};
  if (action === 'add') {
    if (Object.hasOwn(project.resources,path)) throw fail('PROJECT_RESOURCE_EXISTS');
    if (typeof mime !== 'string' || !mime || mime.length > 120 || typeof base64 !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
      throw fail('PROJECT_RESOURCE_INVALID');
    project.resources[path] = { mime, base64 };
  } else if (action === 'delete') {
    if (!Object.hasOwn(project.resources,path)) throw fail('PROJECT_RESOURCE_NOT_FOUND');
    delete project.resources[path];
  } else throw fail('PROJECT_RESOURCE_ACTION_INVALID');
}

/** Plan all changes against one immutable source revision; never publish partial edits. */
export function applyProjectChanges(project, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 32)
    throw fail('PROJECT_BATCH_OPERATIONS_INVALID');
  const next = clone(project);
  delete next.integrity;
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw fail('PROJECT_BATCH_OPERATION_INVALID');
    if (operation.kind === 'file') applyFile(next, operation);
    else if (operation.kind === 'resource') applyResource(next, operation);
    else throw fail('PROJECT_BATCH_OPERATION_INVALID');
  }
  return next;
}

/** Bounded, line-oriented change preview. Resource payload bytes never enter a diff. */
function textDifference(before, after) {
  const a = (before ?? '').split('\n'), b = (after ?? '').split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const oldLines = a.slice(prefix, a.length - suffix);
  const newLines = b.slice(prefix, b.length - suffix);
  const beforeContext = a.slice(Math.max(0, prefix - 2), prefix).map(line => '  ' + line);
  const afterContext = b.slice(b.length - suffix, b.length - suffix + 2).map(line => '  ' + line);
  const lines = [
    ...beforeContext, ...oldLines.slice(0, 32).map(line => '- ' + line),
    ...(oldLines.length > 32 ? ['- ...'] : []),
    ...newLines.slice(0, 32).map(line => '+ ' + line),
    ...(newLines.length > 32 ? ['+ ...'] : []), ...afterContext
  ];
  const full = lines.join('\n');
  return { diff:full.slice(0, 3200), truncated:full.length > 3200 || oldLines.length > 32 || newLines.length > 32 };
}

export function summarizeProjectChanges(before, after) {
  const originalFiles = projectFileEntries(before), nextFiles = projectFileEntries(after);
  const paths = new Set([...Object.keys(originalFiles), ...Object.keys(nextFiles)]);
  const changes = [];
  for (const path of [...paths].sort()) {
    const old = originalFiles[path], latest = nextFiles[path];
    if (old === latest) continue;
    changes.push({ kind:'file', path, action:old === undefined?'create':latest === undefined?'delete':'modify',
      beforeChars:old?.length || 0, afterChars:latest?.length || 0, ...textDifference(old,latest) });
  }
  const resourcesBefore = before.resources || {}, resourcesAfter = after.resources || {};
  for (const path of [...new Set([...Object.keys(resourcesBefore),...Object.keys(resourcesAfter)])].sort()) {
    const old = resourcesBefore[path], latest = resourcesAfter[path];
    if (old?.mime === latest?.mime && old?.base64 === latest?.base64) continue;
    changes.push({ kind:'resource', path,
      action:old == null?'create':latest == null?'delete':'modify',
      beforeChars:old?.base64.length || 0, afterChars:latest?.base64.length || 0,
      mime:latest?.mime || old?.mime || '', diff:'资源内容不在差异预览中展示', truncated:false });
  }
  if (!changes.length) throw fail('PROJECT_BATCH_UNCHANGED');
  return { files:changes.filter(change=>change.kind==='file').length,
    resources:changes.filter(change=>change.kind==='resource').length, changes };
}
