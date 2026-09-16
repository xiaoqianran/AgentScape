export class CommandHistory {
  constructor({ apply, limit = 100, events = null } = {}) {
    this.apply = apply;
    this.limit = limit;
    this.events = events;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.suspended = false;
    this.applying = false;
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

  async undo() { return this.step('undo'); }
  async redo() { return this.step('redo'); }

  // 恢复成功后才转移历史栈：apply 抛错时命令留在原栈，历史记录不会丢失。
  // applying 同时阻止重入，避免 UI 连点让两次恢复交错执行。
  async step(direction) {
    if (this.applying) return false;
    const undoing = direction === 'undo';
    const from = undoing ? this.undoStack : this.redoStack;
    const to = undoing ? this.redoStack : this.undoStack;
    if (!from.length) return false;
    const command = from[from.length - 1];
    this.applying = true;
    this.suspended = true;
    try {
      await this.apply(undoing ? command.before : command.after);
    } finally {
      this.suspended = false;
      this.applying = false;
    }
    from.pop();
    to.push(command);
    this.events?.emit('history.changed', this.status());
    this.events?.emit('history.applied', { direction, label: command.label });
    return command;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
    this.events?.emit('history.changed', this.status());
  }
}
