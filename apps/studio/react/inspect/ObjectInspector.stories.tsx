import type { Meta, StoryObj } from '@storybook/react-vite';
import { useStudioStore } from '../state/studioStore';
import { ObjectInspectorView } from './ObjectInspector';

const projection = {
  project: () => ({ source:null, kind:'empty', id:null }),
  relations: () => [],
};

const commands = {
  runtimeAction:async () => {},
  scaleRuntime:async () => {},
  renameAuthoringNode:async () => {},
  transformAuthoringNode:async () => {},
};

const meta = {
  title: 'Studio/Inspect/ObjectInspector',
  component: ObjectInspectorView,
  beforeEach: () => {
    useStudioStore.getState().setSelection(null);
  },
  args:{
    projection,
    commands,
    log:() => {},
  },
} satisfies Meta<typeof ObjectInspectorView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptySelection: Story = {};

export const MissingSelection: Story = {
  beforeEach: () => {
    useStudioStore.getState().setSelection({ source:'runtime', id:'missing_entity' });
  },
  args:{
    projection:{
      ...projection,
      project: () => ({ source:'runtime', kind:'missing', id:'missing_entity' }),
    },
  },
};
