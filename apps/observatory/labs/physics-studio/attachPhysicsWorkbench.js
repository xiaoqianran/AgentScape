import { createPhysicsWorkbench } from './workbench.js';

/** Bind the shared API workbench to either physical lab variant. */
export function attachPhysicsWorkbench(lab, { getContext, afterInvoke }) {
  const workbench = createPhysicsWorkbench({ getContext, afterInvoke });
  for (const method of ['toolDefinitions', 'suggestedToolName', 'invokeTool', 'apiHistory', 'apiCoverageMetrics']) {
    lab[method] = (...args) => workbench[method](...args);
  }
  return lab;
}
