import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = new Set(['feat','fix','refactor','perf','test','docs','build','ci','chore','revert','research']);
const statuses = new Set(['TODO','READY','IN_PROGRESS','BLOCKED','DISCOVERY','DEFERRED','DONE']);

// Discover only immediate owners, never dependencies, build outputs or nested copies.
export function taskSources(root = defaultRoot) {
  const owners = ['planning', 'application'];
  for (const group of ['modules', 'apps', 'sdk', 'services']) {
    const dir = path.join(root, group);
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) owners.push(group + '/' + entry.name);
      }
    }
  }
  return owners.map(owner => owner + '/tasks.jsonl')
    .filter(file => fs.existsSync(path.join(root, file))).sort();
}

export function loadPlanning(root = defaultRoot) {
  const entries = [];
  const byId = new Map();
  for (const source of taskSources(root)) {
    const lines = fs.readFileSync(path.join(root, source), 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].trim()) continue;
      const location = source + ':' + (index + 1);
      let task;
      try { task = JSON.parse(lines[index]); }
      catch { throw new Error(location + ': invalid JSON'); }
      if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error(location + ': expected a task object');
      for (const field of ['id','title','path']) {
        if (typeof task[field] !== 'string' || !task[field].trim()) throw new Error(location + ': invalid ' + field);
      }
      if (!types.has(task.type) || !statuses.has(task.status) || !/^P[0-3]$/.test(task.priority)) {
        throw new Error(location + ': invalid type, status or priority');
      }
      for (const field of ['depends','files','criteria']) {
        if (!Array.isArray(task[field]) || task[field].some(value => typeof value !== 'string' || !value.trim())) {
          throw new Error(location + ': invalid ' + field);
        }
      }
      for (const file of task.files) {
        if (file.includes('\\') || path.posix.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) {
          throw new Error(location + ': files must be repository-relative paths');
        }
      }
      if (byId.has(task.id)) throw new Error(location + ': duplicate task ID ' + task.id);
      const entry = { source, task };
      entries.push(entry);
      byId.set(task.id, entry);
    }
  }
  const visited = new Set(), active = new Set();
  function visit(id) {
    if (active.has(id)) throw new Error('Task dependency cycle at ' + id);
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id).task.depends) {
      if (!byId.has(dependency)) throw new Error(id + ': missing dependency ' + dependency);
      visit(dependency);
    }
    active.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return entries;
}

export function readyTasks(entries) {
  const done = new Set(entries.filter(entry => entry.task.status === 'DONE').map(entry => entry.task.id));
  return entries.filter(({ task }) => ['TODO','READY'].includes(task.status) && task.depends.every(id => done.has(id)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const entries = loadPlanning();
    const selected = process.argv.includes('--ready') ? readyTasks(entries) : entries;
    if (process.argv.includes('--json')) console.log(JSON.stringify(selected, null, 2));
    else {
      const owners = Object.fromEntries(taskSources().map(source => [source, entries.filter(entry => entry.source === source).length]));
      console.log(JSON.stringify({ tasks:entries.length, ready:readyTasks(entries).length, owners }, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
