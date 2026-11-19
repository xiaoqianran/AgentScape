import * as THREE from 'three';
import { Instrument } from './Instrument.js';

const fail = (code, message) => Object.assign(new Error(message), { code });

/** Spatial one-shot tones attached to host-owned Three.js entities. */
export class AudioSystem {
  constructor({ entities, listener, three = THREE } = {}) {
    if (!entities || typeof entities.get !== 'function') throw new TypeError('AudioSystem requires an entity registry');
    if (!listener?.context || typeof listener.context.createOscillator !== 'function' || typeof listener.getInput !== 'function') {
      throw new TypeError('AudioSystem requires a host-owned Three.js AudioListener');
    }
    if (typeof three.PositionalAudio !== 'function') throw new TypeError('AudioSystem requires Three.js PositionalAudio');
    this.entities = entities;
    this.listener = listener;
    this.context = listener.context;
    this.three = three;
    this.emitters = new Map();
    this.notes = new Set();
    this.instruments = new Set();
    this.disposed = false;
  }

  registerEmitter(id, object = this.entities.get(id)?.object, options = {}) {
    this.assertAvailable();
    const entity = this.entities.get(id);
    if (!entity) throw fail('AUDIO_ENTITY_NOT_FOUND', `Audio entity not found: ${id}`);
    if (!object?.isObject3D || object !== entity.object) throw fail('AUDIO_OBJECT_MISMATCH', 'Audio emitter must use its registered entity object');
    if (this.emitters.has(id)) throw fail('AUDIO_EMITTER_CONFLICT', `Audio emitter already registered: ${id}`);
    const sound = new this.three.PositionalAudio(this.listener);
    sound.setRefDistance(options.refDistance ?? 1);
    sound.setRolloffFactor(options.rolloffFactor ?? 1);
    object.add(sound);
    this.emitters.set(id, { object, sound, previousPhase: entity.phase });
    this.entities.addCapabilities(id, ['audio-emitter']);
    this.entities.setPhase(id, 'audio-registered');
    return sound;
  }

  unregisterEmitter(id) {
    const emitter = this.emitters.get(id);
    if (!emitter) return false;
    this.stopEntityNotes(id);
    for (const instrument of [...this.instruments]) {
      if (instrument.entityId === id) instrument.dispose();
    }
    this.emitters.delete(id);
    emitter.sound.disconnect();
    emitter.sound.removeFromParent();
    if (this.entities.has(id)) {
      this.entities.removeCapabilities(id, ['audio-emitter']);
      this.entities.setPhase(id, emitter.previousPhase);
    }
    return true;
  }

  createInstrument(id, options = {}) {
    this.assertAvailable();
    if (!this.emitters.has(id)) throw fail('AUDIO_EMITTER_NOT_FOUND', `Audio emitter not registered: ${id}`);
    const instrument = new Instrument({ ...options, audio: this, entityId: id });
    this.instruments.add(instrument);
    return instrument;
  }

  releaseInstrument(instrument) {
    this.instruments.delete(instrument);
  }

  scheduleNote(id, { frequency, duration = 0.25, gain = 0.2, startAt = this.context.currentTime, waveform = 'sine' } = {}) {
    this.assertAvailable();
    const emitter = this.emitters.get(id);
    if (!emitter) throw fail('AUDIO_EMITTER_NOT_FOUND', `Audio emitter not registered: ${id}`);
    if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(duration) || duration <= 0 ||
        !Number.isFinite(gain) || gain < 0 || gain > 1 || !Number.isFinite(startAt) || startAt < 0 ||
        !['sine', 'square', 'sawtooth', 'triangle'].includes(waveform)) {
      throw fail('AUDIO_NOTE_INVALID', 'Note requires a positive frequency and duration, gain from 0 to 1, valid start time, and supported waveform');
    }
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const note = { id, oscillator, envelope };
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    envelope.gain.setValueAtTime(0, startAt);
    envelope.gain.linearRampToValueAtTime(gain, startAt + 0.01);
    envelope.gain.setValueAtTime(gain, Math.max(startAt + 0.01, startAt + duration - 0.02));
    envelope.gain.linearRampToValueAtTime(0, startAt + duration);
    oscillator.connect(envelope);
    envelope.connect(emitter.sound.panner);
    oscillator.onended = () => this.releaseNote(note);
    this.notes.add(note);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
    return Object.freeze({ entityId: id, stop: () => this.stopNote(note) });
  }

  stopNote(note) {
    if (!this.notes.has(note)) return false;
    try { note.oscillator.stop(); } catch { /* It may already have ended. */ }
    this.releaseNote(note);
    return true;
  }

  stopEntityNotes(id) {
    for (const note of [...this.notes]) if (note.id === id) this.stopNote(note);
  }

  releaseNote(note) {
    if (!this.notes.delete(note)) return;
    note.oscillator.onended = null;
    note.oscillator.disconnect();
    note.envelope.disconnect();
  }

  assertAvailable() {
    if (this.disposed) throw fail('AUDIO_RUNTIME_DISPOSED', 'AudioSystem has been disposed');
  }

  dispose() {
    if (this.disposed) return;
    for (const instrument of [...this.instruments]) instrument.dispose();
    for (const id of [...this.emitters.keys()]) this.unregisterEmitter(id);
    for (const note of [...this.notes]) this.stopNote(note);
    this.disposed = true;
  }
}
