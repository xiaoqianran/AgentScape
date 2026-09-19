export function createStudioUiBridge() {
  let snapshot = Object.freeze({
    runtimeStatus:{ state:'loading', label:'启动中', recoveryAction:null },
    worldChangeHandler:null,
    layoutChangeHandler:null,
    dockActions:[],
    agent:null,
    content:null,
    sceneControls:null,
    authoring:null,
    developerOpenHandler:null,
    commandDraft:null
  });
  const listeners = new Set();
  let commandSequence = 0;

  const emit = (patch) => {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    setRuntimeStatus(state,label) {
      emit({ runtimeStatus:{ ...snapshot.runtimeStatus, state, label } });
    },
    setRuntimeRecoveryAction(recoveryAction,label=null) {
      emit({
        runtimeStatus:{
          ...snapshot.runtimeStatus,
          recoveryAction:typeof recoveryAction === 'function' ? recoveryAction : null,
          label:label || snapshot.runtimeStatus.label
        }
      });
    },
    setWorldChangeHandler(handler) {
      emit({ worldChangeHandler:typeof handler === 'function' ? handler : null });
    },
    setLayoutChangeHandler(handler) {
      emit({ layoutChangeHandler:typeof handler === 'function' ? handler : null });
    },
    notifyLayout() {
      snapshot.layoutChangeHandler?.();
    },
    async openWorld(id) {
      if (!snapshot.worldChangeHandler) return null;
      return snapshot.worldChangeHandler(id);
    },
    addDockAction(action) {
      if (!action?.id || !action?.label || typeof action?.onClick !== 'function') return null;
      const next = [...snapshot.dockActions.filter((item) => item.id !== action.id), action];
      emit({ dockActions:next });
      return action.id;
    },
    attachAgent(agent) {
      emit({ agent });
    },
    attachContent(content) {
      emit({ content });
    },
    attachSceneControls(sceneControls) {
      emit({ sceneControls });
    },
    attachAuthoring(authoring) {
      emit({ authoring });
    },
    setDeveloperOpenHandler(handler) {
      emit({ developerOpenHandler:typeof handler === 'function' ? handler : null });
    },
    prefillAgentCommand(value) {
      emit({ commandDraft:{ id:++commandSequence, value:String(value || '') } });
    },
    dispose() {
      listeners.clear();
    }
  };
}
