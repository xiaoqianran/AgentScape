export class CommandHistory {
  constructor({ apply, limit = 100, events = null } = {}) {
    this.apply = apply;
    this.limit = limit;
    this.events = events;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.suspended = false;
  }

  begin(label, before) {
    if (this.suspended || this.pending) return false;
    this.pending = { label, before };
    return true;
  }

  commit(after, meta = {}) {
    if (this.suspended || !this.pending) return false;
    const command = { ...this.pending, after, meta, at: Date.now() };
    this.pending = null;
    if (JSON.stringify(command.before) === JSON.stringify(command.after)) return false;
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.events?.emit('history.changed', this.status());
    this.events?.emit('history.recorded', { label: command.label, meta });
    return true;
  }

  cancel() { this.pending = null; }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  status() { return { undo: this.undoStack.length, redo: this.redoStack.length, canUndo: this.canUndo(), canRedo: this.canRedo() }; }

  async undo() {
    if (!this.canUndo()) return false;
    const command = this.undoStack.pop();
    this.suspended = true;
    try { await this.apply(command.before); }
    finally { this.suspended = false; }
    this.redoStack.push(command);
    this.events?.emit('history.changed', this.status());
    this.events?.emit('history.applied', { direction: 'undo', label: command.label });
    return command;
  }

  async redo() {
    if (!this.canRedo()) return false;
    const command = this.redoStack.pop();
    this.suspended = true;
    try { await this.apply(command.after); }
    finally { this.suspended = false; }
    this.undoStack.push(command);
    this.events?.emit('history.changed', this.status());
    this.events?.emit('history.applied', { direction: 'redo', label: command.label });
    return command;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
    this.events?.emit('history.changed', this.status());
  }
}
