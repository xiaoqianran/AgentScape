const fail = (code, message) => Object.assign(new Error(message), { code });

/** Maps named instrument notes to the host-owned spatial audio runtime. */
export class Instrument {
  constructor({ audio, entityId, notes = {}, duration = 0.25, gain = 0.2, waveform = 'sine' } = {}) {
    if (!audio || typeof audio.scheduleNote !== 'function' || typeof audio.releaseInstrument !== 'function') {
      throw new TypeError('Instrument requires an AudioSystem');
    }
    if (typeof entityId !== 'string' || !entityId) throw new TypeError('Instrument requires an entity ID');
    if (!notes || typeof notes !== 'object' || Array.isArray(notes)) throw new TypeError('Instrument notes must be an object');
    this.audio = audio;
    this.entityId = entityId;
    this.notes = Object.freeze({ ...notes });
    this.defaults = Object.freeze({ duration, gain, waveform });
    this.disposed = false;
  }

  play(note, options = {}) {
    if (this.disposed) throw fail('AUDIO_INSTRUMENT_DISPOSED', 'Instrument has been disposed');
    const noteOptions = typeof note === 'string' ? this.notes[note] : note;
    if (noteOptions === undefined) throw fail('AUDIO_NOTE_UNKNOWN', `Instrument note not found: ${note}`);
    const resolved = typeof noteOptions === 'number' ? { frequency: noteOptions } : noteOptions;
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
      throw fail('AUDIO_NOTE_UNKNOWN', `Instrument note is invalid: ${note}`);
    }
    return this.audio.scheduleNote(this.entityId, { ...this.defaults, ...resolved, ...options });
  }

  trigger(note, options = {}) {
    return this.play(note, options);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.audio.releaseInstrument(this);
  }
}
