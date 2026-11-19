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
    type: 'sine', frequency: { setValueAtTime(value, time) { calls.push(['frequency', value, time]); } },
    connect(target) { calls.push(['oscillator-connect', target]); },
    disconnect() { calls.push(['oscillator-disconnect']); },
    start(time) { calls.push(['start', time]); },
    stop(time) { calls.push(['stop', time]); },
    onended: null,
  });
  const context = {
    currentTime: 10,
    createOscillator: oscillator,
    createGain: () => ({
      gain: {
        setValueAtTime() {},
        linearRampToValueAtTime() {},
      },
      connect(target) { calls.push(['gain-connect', target]); },
      disconnect() { calls.push(['gain-disconnect']); },
    }),
  };
  const listener = { context, getInput: () => node() };
  class PositionalAudio extends THREE.Object3D {
    constructor() { super(); this.isObject3D = true; this.panner = node(); }
    setRefDistance(value) { this.refDistance = value; return this; }
    setRolloffFactor(value) { this.rolloffFactor = value; return this; }
    disconnect() { calls.push(['sound-disconnect']); return this; }
  }
  return { listener, three: { PositionalAudio }, calls };
}

function createInstrumentFixture() {
  const registry = new EntityCapabilityRegistry();
  const object = new THREE.Group();
  registry.register({ id: 'piano', object, phase: 'visual-mounted' });
  const fixture = createAudioFixture();
  const audio = new AudioSystem({ entities: registry, ...fixture });
  audio.registerEmitter('piano', object);
  return { audio, fixture };
}

describe('Instrument', () => {
  it('maps named notes to spatial one-shot audio', () => {
    const { audio, fixture } = createInstrumentFixture();
    const instrument = audio.createInstrument('piano', {
      notes: { C4: 261.63, E4: { frequency: 329.63, duration: 0.6 } },
      duration: 0.4,
      gain: 0.3,
    });

    const note = instrument.play('C4');
    instrument.trigger('E4', { waveform: 'triangle' });

    expect(note.entityId).toBe('piano');
    expect(fixture.calls).toEqual(expect.arrayContaining([
      ['frequency', 261.63, 10],
      ['frequency', 329.63, 10],
      ['start', 10],
      ['stop', 10.4],
      ['stop', 10.6],
    ]));
  });

  it('rejects unknown notes and cannot play after disposal', () => {
    const { audio } = createInstrumentFixture();
    const instrument = audio.createInstrument('piano', { notes: { C4: 261.63 } });

    expect(() => instrument.play('D4')).toThrow(expect.objectContaining({ code: 'AUDIO_NOTE_UNKNOWN' }));
    instrument.dispose();
    expect(() => instrument.play('C4')).toThrow(expect.objectContaining({ code: 'AUDIO_INSTRUMENT_DISPOSED' }));
  });

  it('disposes instruments when the emitter is unregistered', () => {
    const { audio } = createInstrumentFixture();
    const instrument = audio.createInstrument('piano', { notes: { C4: 261.63 } });

    audio.unregisterEmitter('piano');

    expect(() => instrument.play('C4')).toThrow(expect.objectContaining({ code: 'AUDIO_INSTRUMENT_DISPOSED' }));
  });

  it('preserves stable errors for unavailable emitters and disposed runtimes', () => {
    const { audio } = createInstrumentFixture();
    expect(() => audio.createInstrument('missing')).toThrow(expect.objectContaining({ code: 'AUDIO_EMITTER_NOT_FOUND' }));
    audio.dispose();
    expect(() => audio.createInstrument('piano')).toThrow(expect.objectContaining({ code: 'AUDIO_RUNTIME_DISPOSED' }));
  });
});
