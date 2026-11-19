import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AudioSystem } from '../../modules/world/runtime/systems/AudioSystem.js';
import { EntityCapabilityRegistry } from '../../modules/world/runtime/EntityCapabilityRegistry.js';

function createAudioFixture() {
  const calls = [];
  const node = () => ({
    connect(target) { calls.push(['connect', target]); },
    disconnect() { calls.push(['disconnect']); },
  });
  const oscillator = () => ({
    type: 'sine', frequency: { setValueAtTime() {} },
    connect(target) { calls.push(['oscillator-connect', target]); }, disconnect() { calls.push(['oscillator-disconnect']); },
    start(time) { calls.push(['start', time]); }, stop(time) { calls.push(['stop', time]); }, onended: null,
  });
  const context = { currentTime: 10, createOscillator: oscillator, createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect(target) { calls.push(['gain-connect', target]); }, disconnect() { calls.push(['gain-disconnect']); } }) };
  const listener = { context, getInput: () => node() };
  class PositionalAudio extends THREE.Object3D {
    constructor() { super(); this.isObject3D = true; this.panner = node(); }
    setRefDistance(value) { this.refDistance = value; return this; }
    setRolloffFactor(value) { this.rolloffFactor = value; return this; }
    disconnect() { calls.push(['sound-disconnect']); return this; }
  }
  return { listener, three: { PositionalAudio }, calls };
}

describe('AudioSystem', () => {
  it('registers a host-owned spatial emitter and schedules a one-shot note', () => {
    const registry = new EntityCapabilityRegistry();
    const object = new THREE.Group();
    registry.register({ id: 'bell', object, phase: 'visual-mounted' });
    const fixture = createAudioFixture();
    const audio = new AudioSystem({ entities: registry, ...fixture });
    audio.registerEmitter('bell', object, { refDistance: 4 });
    const note = audio.scheduleNote('bell', { frequency: 440, duration: 0.5 });

    expect(object.children).toHaveLength(1);
    expect(registry.get('bell')).toMatchObject({ phase: 'audio-registered', capabilities: ['audio-emitter'] });
    expect(note.entityId).toBe('bell');
    expect(fixture.calls).toEqual(expect.arrayContaining([['start', 10], ['stop', 10.5]]));

    audio.dispose();
    expect(object.children).toHaveLength(0);
    expect(registry.get('bell')).toMatchObject({ phase: 'visual-mounted', capabilities: [] });
    expect(() => audio.scheduleNote('bell', { frequency: 440 })).toThrow(expect.objectContaining({ code: 'AUDIO_RUNTIME_DISPOSED' }));
  });

  it('rejects a missing emitter and invalid note without creating nodes', () => {
    const registry = new EntityCapabilityRegistry();
    registry.register({ id: 'object', object: new THREE.Group() });
    const fixture = createAudioFixture();
    const audio = new AudioSystem({ entities: registry, ...fixture });
    expect(() => audio.scheduleNote('object', { frequency: 440 })).toThrow(expect.objectContaining({ code: 'AUDIO_EMITTER_NOT_FOUND' }));
    expect(() => audio.registerEmitter('object')).not.toThrow();
    expect(() => audio.scheduleNote('object', { frequency: -1 })).toThrow(expect.objectContaining({ code: 'AUDIO_NOTE_INVALID' }));
  });
});

