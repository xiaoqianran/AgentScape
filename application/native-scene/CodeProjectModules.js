import { init, parse } from 'es-module-lexer';

const fail = (code, detail = '') => Object.assign(new Error(detail ? code + ': ' + detail : code), { code });
const pathPattern = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:js|mjs|glsl|vert|frag|wgsl|json|txt)$/;
const script = path => /\.(?:js|mjs)$/.test(path);
const shader = path => /\.(?:glsl|vert|frag|wgsl|txt)$/.test(path);
const toUrl = code => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(code).replace(/[!'()*]/g, char =>
  '%' + char.charCodeAt(0).toString(16).toUpperCase());

export function assertCodeFilePath(path) {
  if (typeof path !== 'string' || path.length > 180 || !pathPattern.test(path) ||
    path.split('/').some(part => part === '.' || part === '..')) throw fail('PROJECT_FILE_PATH_INVALID', String(path));
  return path;
}

/** The entry lives in project.source; project.files contains other editable text files. */
export function projectFileEntries(project) {
  const entry = project.entry || 'main.js';
  return { [entry]:project.source, ...(project.files || {}) };
}

export function validateCodeFiles(project) {
  if (project.entry == null && project.files == null) return;
  if (!project.entry || !script(assertCodeFilePath(project.entry))) throw fail('PROJECT_ENTRY_INVALID');
  const files = project.files || {};
  if (Object.keys(files).length > 63) throw fail('PROJECT_FILE_LIMIT');
  for (const [path, content] of Object.entries(files)) {
    assertCodeFilePath(path);
    if (path === project.entry) throw fail('PROJECT_FILE_DUPLICATE', path);
    if (typeof content !== 'string' || new TextEncoder().encode(content).length > 1024 * 1024)
      throw fail('PROJECT_FILE_LIMIT', path);
  }
  if (new TextEncoder().encode(project.source).length > 1024 * 1024) throw fail('PROJECT_FILE_LIMIT', project.entry);
}

function resolveImport(importer, specifier, files) {
  if (!/^\.\.?\//.test(specifier)) throw fail('PROJECT_IMPORT_UNSUPPORTED', importer + ' -> ' + specifier);
  const raw = specifier.replace(/\?raw$/, '');
  if (raw.includes('?') || raw.includes('#') || raw.includes('\\')) throw fail('PROJECT_IMPORT_UNSUPPORTED', specifier);
  const parts = importer.split('/').slice(0, -1);
  for (const part of raw.split('/')) {
    if (part === '.' || !part) continue;
    if (part === '..') { if (!parts.length) throw fail('PROJECT_IMPORT_OUTSIDE_ROOT', specifier); parts.pop(); }
    else parts.push(part);
  }
  const joined = parts.join('/');
  const candidate = Object.hasOwn(files, joined) ? joined :
    ['.js','.mjs','.json'].map(ext => joined + ext).find(value => Object.hasOwn(files,value));
  if (!candidate) throw fail('PROJECT_IMPORT_NOT_FOUND', importer + ' -> ' + specifier);
  return { path:candidate, raw:specifier.endsWith('?raw') };
}

function threeBinding(statement, key) {
  // The host's Three.js instance must be shared with the native Runtime.
  const expression = 'globalThis[' + JSON.stringify(key) + ']';
  if (/^import\s*(['"])three\1\s*;?\s*$/.test(statement.trim())) return '';
  const match = /^import\s+([\s\S]*?)\s+from\s+(['"])three\2\s*;?\s*$/.exec(statement.trim());
  if (!match) throw fail('PROJECT_THREE_IMPORT_INVALID', statement);
  const clause = match[1].trim();
  if (/^\*\s+as\s+[A-Za-z_$][\w$]*$/.test(clause)) return 'const ' + clause.replace(/^\*\s+as\s+/,'') + ' = ' + expression + ';';
  if (/^[A-Za-z_$][\w$]*$/.test(clause)) return 'const ' + clause + ' = ' + expression + ';';
  if (/^\{[\s\S]*\}$/.test(clause)) {
    const names = clause.slice(1,-1).split(',').map(item => item.trim()).filter(Boolean).map(item => {
      const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(item);
      if (!match) throw fail('PROJECT_THREE_IMPORT_INVALID', item);
      return match[2] ? match[1] + ': ' + match[2] : match[1];
    });
    return 'const {' + names.join(',') + '} = ' + expression + ';';
  }
  throw fail('PROJECT_THREE_IMPORT_INVALID', clause);
}

/** Offline browser/Node ESM linker: relative JS and raw shader/JSON files, no separate server. */
export async function compileCodeProjectModules(project) {
  validateCodeFiles(project);
  if (!project.entry) return project.source;
  await init;
  const files = projectFileEntries(project);
  const key = '__agentscape_three_' + crypto.randomUUID().replaceAll('-','');
  const compiled = new Map(), visiting = new Set();
  async function link(path, asRaw = false) {
    const id = path + (asRaw ? '?raw' : '');
    if (compiled.has(id)) return compiled.get(id);
    if (visiting.has(id)) throw fail('PROJECT_IMPORT_CYCLE', path);
    visiting.add(id);
    try {
      let code = files[path];
      if (asRaw || shader(path)) code = 'export default ' + JSON.stringify(code) + ';';
      else if (path.endsWith('.json')) {
        try { code = 'export default ' + JSON.stringify(JSON.parse(code)) + ';'; }
        catch { throw fail('PROJECT_JSON_INVALID', path); }
      } else {
        if (!script(path)) throw fail('PROJECT_MODULE_UNSUPPORTED', path);
        let imports;
        try { [imports] = parse(code, path); }
        catch (error) { throw fail('PROJECT_MODULE_SYNTAX', path + ': ' + error.message); }
        const edits = [];
        for (const item of imports) {
          if (item.d >= 0) throw fail('PROJECT_DYNAMIC_IMPORT_UNSUPPORTED', path);
          if (!item.n) continue; // import.meta is not a module dependency.
          if (item.n === 'three') {
            edits.push({ start:item.ss, end:item.se,
              value:threeBinding(code.slice(item.ss,item.se), key) });
          } else {
            const dependency = resolveImport(path,item.n,files);
            const url = await link(dependency.path,dependency.raw);
            edits.push({ start:item.s,end:item.e,value:url });
          }
        }
        for (const edit of edits.reverse()) code = code.slice(0,edit.start) + edit.value + code.slice(edit.end);
      }
      const url = toUrl(code);
      if (url.length > 12 * 1024 * 1024) throw fail('PROJECT_BUNDLE_LIMIT', path);
      compiled.set(id,url);
      return url;
    } finally { visiting.delete(id); }
  }
  const url = await link(project.entry);
  return `export async function createProject(context) {
    const key = ${JSON.stringify(key)};
    globalThis[key] = context.THREE;
    try {
      const module = await import(/* @vite-ignore */ ${JSON.stringify(url)});
      if (typeof module.createProject !== 'function') throw new Error('CODE_PROJECT_FACTORY_REQUIRED');
      return await module.createProject(context);
    } finally { delete globalThis[key]; }
  }`;
}
