import { agentViewForStudioView, pageForStudioView } from '../../navigation/StudioNavigation.js';
import { create } from 'zustand';

export type ProductPage = 'worlds' | 'world' | 'build' | 'assets' | 'agent';
export type AgentPageView = 'tasks' | 'runs';
export type ContextView = 'inspect';
export type LegacyStudioView = 'world' | 'create' | 'task' | 'resources' | 'inspect' | 'runs';
export type BuildOutputKind = 'image' | 'asset' | 'world';
export type StudioSelectionSource = 'runtime' | 'authoring' | 'environment';

export type StudioSelection = {
  source: StudioSelectionSource;
  id: string;
} | null;

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

export type StudioWorldPresentation = {
  id: string;
  title?: string;
  number?: string;
  headline?: string;
  description?: string;
  facts?: string[];
  worldFirst?: boolean;
  generated?: boolean;
  persistenceSource?: string | null;
};

export type StudioProductState = {
  activePage: ProductPage;
  agentView: AgentPageView;
};

export type StudioLayoutState = {
  activeContextView: ContextView;
  contextOpen: boolean;
  buildAdvancedOpen: boolean;
  cinematic: boolean;
  sceneCollapsed: boolean;
};

export type StudioEditorState = {
  selection: StudioSelection;
  revision: number;
};

export type StudioViewState = {
  worldPresentation: StudioWorldPresentation | null;
};

export type StudioBuildState = {
  outputs: BuildOutputRef[];
  selectedOutputKey: string | null;
  workflowIntent: BuildWorkflowIntent | null;
  workflowSequence: number;
};

type StudioState = {
  product: StudioProductState;
  layout: StudioLayoutState;
  editor: StudioEditorState;
  view: StudioViewState;
  build: StudioBuildState;
  setSelection: (selection: StudioSelection) => void;
  selectRuntimeObject: (id: string | null) => void;
  setWorldPresentation: (identity: StudioWorldPresentation | null) => void;
  openPage: (page: ProductPage) => void;
  openAgentView: (view: AgentPageView) => void;
  openView: (view: LegacyStudioView) => void;
  closeContext: () => void;
  setBuildAdvancedOpen: (open: boolean) => void;
  setCinematic: (enabled: boolean) => void;
  setSceneCollapsed: (collapsed: boolean) => void;
  syncInspector: (id: string | null) => void;
  refreshInspector: () => void;
  recordBuildOutput: (output: BuildOutputRef) => void;
  selectBuildOutput: (key: string | null) => void;
  clearBuildOutputs: () => void;
  requestBuildWorkflow: (action: BuildWorkflowIntent['action'], outputKey: string) => void;
  consumeBuildWorkflow: (id: number) => void;
};

export const runtimeSelectionId = (selection: StudioSelection) => (
  selection?.source === 'runtime' ? selection.id : null
);

export const studioSelectionKey = (selection: StudioSelection) => (
  selection ? selection.source + ':' + selection.id : null
);

export const useStudioStore = create<StudioState>((set) => ({
  product: {
    activePage:'worlds',
    agentView:'tasks'
  },
  layout: {
    activeContextView:'inspect',
    contextOpen:false,
    buildAdvancedOpen:false,
    cinematic:false,
    sceneCollapsed:false
  },
  editor: {
    selection:null,
    revision:0
  },
  view: {
    worldPresentation:null
  },
  build: {
    outputs:[],
    selectedOutputKey:null,
    workflowIntent:null,
    workflowSequence:0
  },

  setSelection: (selection) => set((state) => ({
    editor:{ ...state.editor, selection }
  })),

  selectRuntimeObject: (id) => set((state) => ({
    editor:{
      ...state.editor,
      selection:id ? { source:'runtime', id } : null
    }
  })),

  setWorldPresentation: (worldPresentation) => set((state) => ({
    view:{ ...state.view, worldPresentation }
  })),

  openPage: (activePage) => set((state) => ({
    product:{ ...state.product, activePage },
    layout:{
      ...state.layout,
      contextOpen:activePage === 'world' ? state.layout.contextOpen : false,
      buildAdvancedOpen:activePage === 'build' ? state.layout.buildAdvancedOpen : false,
      cinematic:activePage === 'world' ? state.layout.cinematic : false
    }
  })),

  openAgentView: (agentView) => set((state) => ({
    product:{ activePage:'agent', agentView },
    layout:{ ...state.layout, contextOpen:false }
  })),

  openView: (view) => set((state) => {
    if (view === 'inspect') {
      return {
        product:{ ...state.product, activePage:'world' },
        layout:{ ...state.layout, activeContextView:'inspect', contextOpen:true }
      };
    }
    const activePage = pageForStudioView(view) as ProductPage;
    return {
      product:{
        activePage,
        agentView:activePage === 'agent' ? agentViewForStudioView(view) as AgentPageView : state.product.agentView
      },
      layout:{ ...state.layout, contextOpen:false, buildAdvancedOpen:activePage === 'build' ? state.layout.buildAdvancedOpen : false }
    };
  }),

  closeContext: () => set((state) => ({
    layout:{ ...state.layout, contextOpen:false }
  })),

  setBuildAdvancedOpen: (buildAdvancedOpen) => set((state) => ({
    layout:{ ...state.layout, buildAdvancedOpen }
  })),

  setCinematic: (cinematic) => set((state) => ({
    layout:{ ...state.layout, cinematic }
  })),

  setSceneCollapsed: (sceneCollapsed) => set((state) => ({
    layout:{ ...state.layout, sceneCollapsed }
  })),

  syncInspector: (id) => set((state) => ({
    editor:{
      selection:id ? { source:'runtime', id } : state.editor.selection,
      revision:state.editor.revision + 1
    }
  })),

  refreshInspector: () => set((state) => ({
    editor:{
      ...state.editor,
      revision:state.editor.revision + 1
    }
  })),

  recordBuildOutput: (output) => set((state) => ({
    build:{
      ...state.build,
      outputs:[output, ...state.build.outputs.filter((item) => item.key !== output.key)].slice(0,40),
      selectedOutputKey:output.key
    }
  })),

  selectBuildOutput: (selectedOutputKey) => set((state) => ({
    build:{ ...state.build, selectedOutputKey }
  })),

  clearBuildOutputs: () => set((state) => ({
    build:{ ...state.build, outputs:[], selectedOutputKey:null }
  })),

  requestBuildWorkflow: (action, outputKey) => set((state) => {
    const id = state.build.workflowSequence + 1;
    return {
      build:{
        ...state.build,
        workflowSequence:id,
        workflowIntent:{ id, action, outputKey },
        selectedOutputKey:outputKey
      }
    };
  }),

  consumeBuildWorkflow: (id) => set((state) => (
    state.build.workflowIntent?.id === id
      ? { build:{ ...state.build, workflowIntent:null } }
      : state
  ))
}));
