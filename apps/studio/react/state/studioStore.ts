import { create } from 'zustand';

export type ContextView = 'create' | 'task' | 'resources' | 'inspect' | 'runs';
export type BuildOutputKind = 'image' | 'asset' | 'world';

export type BuildOutputRef = {
  key: string;
  kind: BuildOutputKind;
  primaryId: string;
  artifactIds: string[];
  prompt: string;
  status: string;
  routeLabel?: string;
  createdAt: number;
};

export type BuildWorkflowIntent = {
  id: number;
  action: 'asset-from-image';
  outputKey: string;
};

type StudioState = {
  selectedObjectId: string | null;
  activeContextView: ContextView;
  contextRevision: number;
  buildOutputs: BuildOutputRef[];
  selectedBuildOutputKey: string | null;
  buildWorkflowIntent: BuildWorkflowIntent | null;
  buildWorkflowSequence: number;
  setSelectedObjectId: (id: string | null) => void;
  setActiveContextView: (view: ContextView) => void;
  syncInspector: (id: string | null) => void;
  recordBuildOutput: (output: BuildOutputRef) => void;
  selectBuildOutput: (key: string | null) => void;
  clearBuildOutputs: () => void;
  requestBuildWorkflow: (action: BuildWorkflowIntent['action'], outputKey: string) => void;
  consumeBuildWorkflow: (id: number) => void;
};

export const useStudioStore = create<StudioState>((set) => ({
  selectedObjectId: null,
  activeContextView: 'create',
  contextRevision: 0,
  buildOutputs: [],
  selectedBuildOutputKey: null,
  buildWorkflowIntent: null,
  buildWorkflowSequence: 0,
  setSelectedObjectId: (selectedObjectId) => set({ selectedObjectId }),
  setActiveContextView: (activeContextView) => set({ activeContextView }),
  syncInspector: (selectedObjectId) => set((state) => ({
    selectedObjectId,
    contextRevision: state.contextRevision + 1
  })),
  recordBuildOutput: (output) => set((state) => ({
    buildOutputs: [output, ...state.buildOutputs.filter((item) => item.key !== output.key)].slice(0, 40),
    selectedBuildOutputKey: output.key
  })),
  selectBuildOutput: (selectedBuildOutputKey) => set({ selectedBuildOutputKey }),
  clearBuildOutputs: () => set({ buildOutputs: [], selectedBuildOutputKey: null }),
  requestBuildWorkflow: (action, outputKey) => set((state) => {
    const id = state.buildWorkflowSequence + 1;
    return {
      buildWorkflowSequence:id,
      buildWorkflowIntent:{ id, action, outputKey },
      selectedBuildOutputKey:outputKey
    };
  }),
  consumeBuildWorkflow: (id) => set((state) => (
    state.buildWorkflowIntent?.id === id ? { buildWorkflowIntent:null } : state
  ))
}));
