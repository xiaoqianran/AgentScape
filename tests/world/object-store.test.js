import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';

describe('ObjectStore', () => {
  it('stores and retrieves records', () => { const s = new ObjectStore(); s.add('a', { value: 1 }); expect(s.get('a').value).toBe(1); });
  it('rejects duplicate ids', () => { const s = new ObjectStore(); s.add('a', {}); expect(() => s.add('a', {})).toThrow(/Duplicate/); });
  it('uses a stable domain error for missing objects', () => { const s = new ObjectStore(); try { s.get('missing'); throw new Error('expected missing object error'); } catch (error) { expect(error.code).toBe('OBJECT_NOT_FOUND'); } });
});
