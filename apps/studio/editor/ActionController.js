// Owns operation identity and presentation state; Scene jobs still verify the result.
export class ActionController {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.sequence = 0;
    this.epoch = 0;
    this.states = new Map();
    this.pending = new Map();
    this.listeners = new Set();
  }

  key(actor, target) { return JSON.stringify([actor, target]); }
  snapshot(actor, target) { return this.states.get(this.key(actor, target)) || null; }
  isPending(target) { return this.pending.has(target); }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() { for (const listener of this.listeners) listener(); }

  publish(key, state) {
    this.states.set(key, Object.freeze(state));
    this.emit();
  }

  // Reset presentation ownership, not the underlying Runtime job. Its late result is ignored.
  reset() {
    this.epoch++;
    this.states.clear();
    this.pending.clear();
    this.emit();
  }

  execute(input, run) {
    const epoch = this.epoch;
    const isCurrent = () => epoch === this.epoch;
    const key = this.key(input.actor, input.target);
    const existing = this.pending.get(input.target);
    const signature = JSON.stringify(input);
    if (existing) {
      return existing.signature === signature
        ? existing.promise
        : Promise.reject(new Error('该对象已有动作正在执行'));
    }
    const operation = {
      operationId: ++this.sequence,
      actor: input.actor,
      targetId: input.target,
      action: input.action,
      status: 'running',
      feedback: '',
      error: ''
    };

    // Reserve synchronously before observers or the queue can submit the same target again.
    const promise = Promise.resolve().then(() => {
      if (!isCurrent()) throw new Error('世界已切换');
      return run(isCurrent);
    }).then(result => {
      const feedback = result?.legacy
        ? '旧式操作已触发（未验证）'
        : result?.value?.physicsVerified === true
          ? '物理状态已验证'
          : '状态已验证（非抓取力或物理力学证明）';
      if (isCurrent()) {
        this.publish(key, { ...operation, status: 'succeeded', feedback });
        this.log(input.target + '：' + feedback, 'result');
      }
      return result;
    }, error => {
      const message = error instanceof Error ? error.message : String(error);
      if (isCurrent()) {
        this.publish(key, { ...operation, status: 'failed', error: message });
        this.log(input.target + '：' + message, 'error');
      }
      throw error;
    }).finally(() => {
      if (isCurrent()) this.pending.delete(input.target);
      this.emit();
    });
    this.pending.set(input.target, { promise, signature });
    this.publish(key, operation);
    return promise;
  }
}
