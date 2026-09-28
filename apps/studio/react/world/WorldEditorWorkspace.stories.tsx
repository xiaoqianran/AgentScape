import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { useStudioStore } from '../state/studioStore';
import { WorldEditorWorkspace } from './WorldEditorWorkspace';

const bridgeState = {
  content:null,
  sceneControls:null,
  authoring:null,
  dockActions:[
    { id:'dock-test', label:'Test', title:'Test extension', onClick:fn() },
  ],
};

const presentation = {
  id:'gallery',
  number:'01',
  title:'Gallery',
  headline:'Interactive Gallery',
  description:'A compact environment for runtime interaction and navigation.',
  facts:['Indoor','NavMesh'],
};

const meta = {
  title:'Studio/World/WorldEditorWorkspace',
  component:WorldEditorWorkspace,
  decorators:[
    (Story) => <main className="shell spatial-editor"><Story /></main>,
  ],
  beforeEach:() => {
    useStudioStore.getState().closeContext();
    useStudioStore.getState().setSceneCollapsed(false);
    useStudioStore.getState().setSelection(null);
  },
  args:{
    bridgeState,
    presentation,
    active:true,
    notifyLayout:fn(),
  },
} satisfies Meta<typeof WorldEditorWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LoadingTools: Story = {
  play:async ({ canvas,args }) => {
    await expect(canvas.getByText('场景工具启动中…')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button',{name:'Inspect'}));
    await expect(args.notifyLayout).toHaveBeenCalled();
  },
};

export const Background: Story = {
  args:{ active:false },
};
