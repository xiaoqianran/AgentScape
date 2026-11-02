import { compileRuleGraph, evaluateRuleGraph, executeRuleEffects } from './RuleGraph.js';

export class RuleRuntime {
  constructor(runtime, { maxCascadeDepth = 16 } = {}) {
    this.runtime = runtime;
    this.events = runtime.events;
    this.maxCascadeDepth = maxCascadeDepth;
    this.graph = compileRuleGraph([]);
    this.generation = 0;
    this.unsubscribe = null;
    this.queue = Promise.resolve();
    this.active = false;
    this.transactionEvents = null;
    this.transactionDepth = 0;
    this.waitingEvents = [];
    this.eventSuspensions = 0;
  }

  load(rulesOrGraph = []) {
    const rules = rulesOrGraph?.schema === 'agentscape.rule-graph' ? rulesOrGraph.rules : rulesOrGraph;
    const graph = compileRuleGraph(rules);
    this.graph = graph;
    this.generation += 1;
    return structuredClone(graph);
  }

  start() {
    if (this.unsubscribe) return;
    this.active = true;
    this.unsubscribe = this.events.on('*', (event) => {
      if (!this.active || this.eventSuspensions || event.type === 'rule.error' || !this.graph.rules.some((rule) => rule.event === event.type)) return;
      // Rules currently consume only the event type and cascade metadata, not mutable payloads.
      const depth = Math.max(this.transactionDepth, Number(event.meta?.ruleCascadeDepth) || 0);
      const entry = { generation:this.generation, event:{ type:event.type, meta:{ ruleCascadeDepth:depth } } };
      if (this.transactionEvents) this.transactionEvents.push(entry);
      else this.enqueue(entry);
    });
  }

  stop() {
    this.active = false;
    this.generation += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.transactionEvents = null;
    this.transactionDepth = 0;
    this.waitingEvents.length = 0;
  }

  beginTransaction(depth = 0) {
    this.transactionEvents = [];
    this.transactionDepth = Math.max(0, Number(depth) || 0);
  }

  endTransaction(committed) {
    const events = committed ? this.transactionEvents || [] : [];
    this.transactionEvents = null;
    this.transactionDepth = 0;
    const waiting = this.waitingEvents.splice(0);
    for (const entry of [...waiting, ...events]) this.enqueue(entry);
  }

  suspendEvents() { this.eventSuspensions += 1; }
  resumeEvents() { this.eventSuspensions = Math.max(0, this.eventSuspensions - 1); }

  enqueue(entry) {
    this.queue = this.queue.then(() => {
      if (!this.active || entry.generation !== this.generation || this.eventSuspensions) return;
      // An event queued before a new write must wait without occupying the world lock.
      if (this.runtime.mutationOwner) {
        this.waitingEvents.push(entry);
        return;
      }
      return this.dispatchEvent(entry.event, { cascadeDepth:entry.event.meta.ruleCascadeDepth });
    }).catch((error) => {
      this.events.emit('rule.error', {
        error:{ code:error.code || 'RULE_RUNTIME_ERROR', message:error.message },
        sourceEvent:entry.event.type,
        meta:{ ruleCascadeDepth:entry.event.meta.ruleCascadeDepth + 1 }
      });
    });
  }

  readState(targetId, stateKey) {
    return this.runtime.store?.get?.(targetId)?.state?.[stateKey];
  }

  async dispatchEvent(event, { cascadeDepth = 0 } = {}) {
    if (!event?.type) return { status:'no-rule-event' };
    if (cascadeDepth >= this.maxCascadeDepth) {
      const error = new Error(`Rule cascade depth exceeded: ${event.type}`);
      error.code = 'RULE_CASCADE_DEPTH_EXCEEDED';
      throw error;
    }
    const effects = evaluateRuleGraph(this.graph, event.type, (id, key) => this.readState(id, key));
    const seen = new Set();
    const uniqueEffects = effects.filter((effect) => {
      const key = JSON.stringify([effect.targetId, effect.stateKey, effect.value]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!uniqueEffects.length) return { status:'no-rule-match', event:event.type, effects:[] };
    const result = await executeRuleEffects(this.runtime, uniqueEffects, {
      source:'rule-runtime', eventId:event.type, ruleCascadeDepth:cascadeDepth + 1
    });
    if (result.effects?.every((effect) => effect.changed === false)) {
      return { status:'no-rule-match', event:event.type, effects:[] };
    }
    this.events.emit('rule.effects-applied', {
      eventType:event.type, count:uniqueEffects.length, meta:{ ruleCascadeDepth:cascadeDepth + 1 }, result
    });
    return { status:'rules-applied', event:event.type, effects:uniqueEffects, result };
  }
}
