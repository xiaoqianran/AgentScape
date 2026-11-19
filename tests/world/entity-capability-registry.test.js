import { describe, expect, it, vi } from 'vitest';
import { EntityCapabilityRegistry } from '../../modules/world/runtime/EntityCapabilityRegistry.js';

describe('EntityCapabilityRegistry', () => {
  it('keeps stable identity while capabilities and lifecycle change', () => {
    const events = { emit: vi.fn() };
    const registry = new EntityCapabilityRegistry({ events });
    const object = {};
    registry.register({ id:'instrument-1', object, source:'native', capabilities:['semantic'] });
    registry.addCapabilities('instrument-1', ['instrument', 'audio-emitter']);
    registry.setPhase('instrument-1', 'active');

    expect(registry.get('instrument-1').object).toBe(object);
    expect(registry.list({ capability:'instrument' })).toEqual([
      expect.objectContaining({ id:'instrument-1', source:'native', phase:'active', capabilities:['semantic', 'instrument', 'audio-emitter'] }),
    ]);
    expect(registry.unregister('instrument-1')).toBe(true);
    expect(registry.has('instrument-1')).toBe(false);
    expect(events.emit).toHaveBeenCalledWith('entity.removed', { id:'instrument-1', reason:'removed' });
  });

  it('rejects duplicate ids and unknown lifecycle phases', () => {
    const registry = new EntityCapabilityRegistry();
    registry.register({ id:'entity-1' });
    expect(() => registry.register({ id:'entity-1' })).toThrow(expect.objectContaining({ code:'ENTITY_ID_CONFLICT' }));
    expect(() => registry.setPhase('entity-1', 'unknown')).toThrow('Unknown entity lifecycle phase');
  });
});
