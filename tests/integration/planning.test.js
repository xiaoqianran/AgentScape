import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPlanning, readyTasks } from '../../dev/planning.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive:true, force:true }); });
const task = (id, overrides = {}) => ({
  id, type:'feat', title:id, status:'READY', priority:'P1', path:'world.test',
  depends:[], files:[], criteria:['Observable result'], ...overrides
});
function fixture(sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentscape-planning-test-'));
  roots.push(root);
  for (const [source, tasks] of Object.entries(sources)) {
    const target = path.join(root, source);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.writeFileSync(target, tasks.map(value => JSON.stringify(value)).join('\n'));
  }
  return root;
}

describe('distributed planning', () => {
  it('keeps source ownership and resolves readiness across files without loading nested copies', () => {
    const root = fixture({
      'planning/tasks.jsonl':[task('Project-1', { status:'DONE' })],
      'modules/world/tasks.jsonl':[task('World-1', { depends:['Project-1'] }), task('World-2', { depends:['World-1'] })],
      'modules/world/archive/tasks.jsonl':[task('World-1')],
      'apps/studio/tasks.jsonl':[task('Studio-1', { status:'DEFERRED' })]
    });
    const entries = loadPlanning(root);
    expect(entries).toHaveLength(4);
    expect(readyTasks(entries)).toEqual([{ source:'modules/world/tasks.jsonl', task:task('World-1', { depends:['Project-1'] }) }]);
  });
  it('rejects duplicate identities across owners', () => {
    const root = fixture({ 'planning/tasks.jsonl':[task('Same')], 'application/tasks.jsonl':[task('Same')] });
    expect(() => loadPlanning(root)).toThrow(/duplicate task ID/);
  });
  it('rejects a missing dependency and a cross-owner cycle', () => {
    expect(() => loadPlanning(fixture({ 'planning/tasks.jsonl':[task('A', { depends:['Missing'] })] }))).toThrow(/missing dependency/);
    expect(() => loadPlanning(fixture({
      'planning/tasks.jsonl':[task('A', { depends:['B'] })],
      'modules/agent/tasks.jsonl':[task('B', { depends:['A'] })]
    }))).toThrow(/cycle/);
  });
  it('rejects malformed task fields and paths outside the repository', () => {
    expect(() => loadPlanning(fixture({ 'planning/tasks.jsonl':[task('A', { files:['../elsewhere.js'] })] }))).toThrow(/repository-relative/);
    expect(() => loadPlanning(fixture({ 'planning/tasks.jsonl':[task('A', { status:'FINISHED' })] }))).toThrow(/invalid type, status or priority/);
  });
});
