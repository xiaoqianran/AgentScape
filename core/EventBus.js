export class EventBus {
  constructor() { this.listeners = new Map(); }

  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  emit(type, payload = {}) {
    const event = { type, at: Date.now(), ...payload };
    this.listeners.get(type)?.forEach((handler) => handler(event));
    this.listeners.get('*')?.forEach((handler) => handler(event));
    return event;
  }

  clear() { this.listeners.clear(); }
}
