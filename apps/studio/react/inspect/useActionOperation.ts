import { useCallback, useSyncExternalStore } from 'react';
import type { EditorCommandsLike } from './InspectorTypes';
export function useActionOperation(commands:EditorCommandsLike,actor:string|null,target:string) {
  // useSyncExternalStore treats subscribe identity as an effect dependency.
  const subscribe = useCallback(
    (listener:()=>void) => commands.subscribeActions?.(listener) || (()=>{}),
    [commands]
  );
  const operation=useSyncExternalStore(subscribe,()=>commands.actionSnapshot?.(actor,target) ?? null,()=>null);
  const running=useSyncExternalStore(subscribe,()=>commands.isActionPending?.(target) ?? false,()=>false);
  return {running,feedback:operation?.feedback || '',error:operation?.error || ''};
}
