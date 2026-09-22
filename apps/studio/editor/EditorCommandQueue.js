export class EditorCommandQueue {
  constructor({
    tools,
    authoring = null,
    onCommitted = () => {},
    log = () => {}
  } = {}) {
    if (!tools?.call) throw new TypeError('EditorCommandQueue requires AgentTools-like call()');
    this.tools = tools;
    this.authoring = authoring;
    this.onCommitted = onCommitted;
    this.log = log;
    this.tail = Promise.resolve();
    this.listeners = new Set();
    this.state = {
      pending:0,
      revision:0,
      lastCommand:null,
      lastError:null
    };
  }

  snapshot() {
    return { ...this.state };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('EditorCommandQueue listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot=this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  enqueue(command, operation) {
    if (!command?.type) throw new TypeError('Editor command requires type');
    if (typeof operation !== 'function') throw new TypeError('Editor command operation must be a function');

    const run=async()=>{
      this.state={...this.state,pending:this.state.pending+1,lastCommand:command,lastError:null};
      this.emit();
      try {
        const result=await operation();
        this.state={...this.state,revision:this.state.revision+1,lastError:null};
        this.onCommitted(command,result);
        return result;
      } catch (error) {
        const message=error instanceof Error ? error.message : String(error);
        this.state={...this.state,lastError:message};
        throw error;
      } finally {
        this.state={...this.state,pending:Math.max(0,this.state.pending-1)};
        this.emit();
      }
    };

    const result=this.tail.then(run,run);
    this.tail=result.catch(()=>undefined);
    return result;
  }

  runtimeAction(action, id, args = {}) {
    if (!id) throw new TypeError('Runtime editor action requires id');
    if (!action) throw new TypeError('Runtime editor action requires action');
    return this.enqueue(
      { type:'runtime-action', source:'runtime', id, action },
      () => this.tools.call(action,{ id, ...args })
    );
  }

  scaleRuntime(id, scale) {
    if (!id) throw new TypeError('Runtime scale requires id');
    if (!Number.isFinite(scale) || scale < 0.05 || scale > 20) {
      throw new RangeError('Runtime scale must be between 0.05 and 20');
    }
    return this.enqueue(
      { type:'runtime-scale', source:'runtime', id, scale },
      () => this.tools.call('scaleObject',{ id, scale })
    );
  }

  updateAuthoringNode(id, updates, { label = 'Edit authoring node' } = {}) {
    if (!this.authoring?.patch) throw new Error('World Authoring is unavailable');
    if (!id) throw new TypeError('Authoring update requires id');
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new TypeError('Authoring update requires an update object');
    }

    return this.enqueue(
      { type:'authoring-update', source:'authoring', id, label },
      () => this.authoring.patch({ update:[{ id, ...updates }] },{ label })
    );
  }

  renameAuthoringNode(id, name) {
    const normalized=String(name ?? '').trim();
    if (!normalized) throw new TypeError('Authoring node name is required');
    return this.updateAuthoringNode(id,{ name:normalized },{ label:'Rename ' + id });
  }

  transformAuthoringNode(id, { position = null, scale = null } = {}) {
    const properties={};
    if (position) {
      if (!Array.isArray(position) || position.length !== 3 || position.some(value=>!Number.isFinite(value))) {
        throw new TypeError('Authoring position must contain 3 finite numbers');
      }
      properties.position=position;
    }
    if (scale) {
      if (!Array.isArray(scale) || scale.length !== 3 || scale.some(value=>!Number.isFinite(value) || value <= 0)) {
        throw new TypeError('Authoring scale must contain 3 positive finite numbers');
      }
      properties.scale=scale;
    }
    if (!Object.keys(properties).length) throw new TypeError('Authoring transform update is empty');

    return this.updateAuthoringNode(id,{
      components:{
        transform:{
          type:'Transform',
          properties
        }
      }
    },{ label:'Transform ' + id });
  }
}
