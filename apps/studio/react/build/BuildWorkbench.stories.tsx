import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { BuildWorkbenchView } from './BuildWorkbench';

type Mode = 'image'|'asset'|'world';

function createSession(initialMode:Mode = 'world') {
  let state:any = {
    mode:initialMode,
    status:'idle',
    prompt:'',
    result:null,
    error:null,
    steps:[],
  };
  const listeners = new Set<(state:any)=>void>();
  return {
    snapshot:() => state,
    subscribe:(listener:(state:any)=>void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMode:(mode:Mode) => {
      state={...state,mode};
      for (const listener of listeners) listener(state);
    },
  };
}

const worldSession = createSession('world');
const assetSession = createSession('asset');

const resources = {
  currentEnvironment:() => ({ id:'gallery', title:'Gallery' }),
  artifact:() => null,
  localArtifact:() => ({}),
  onEnvironmentChange:() => () => {},
};

const controller = {
  capabilities:() => ({ paired:true, image:true, asset:true, world:true }),
  providerOptions:() => [{ id:'auto-provider', label:'Recommended Provider' }],
  onGenerationState:() => () => {},
  connect:fn(async () => ({ status:'generation-ready' })),
  runBuild:fn(async ({mode,prompt}:any) => {
    if (mode === 'world') {
      return { kind:'world' as const, prompt, provider:'modal-world', manifestArtifactId:'manifest_demo', artifacts:{} };
    }
    if (mode === 'image') {
      return { kind:'image' as const, prompt, provider:'modal-2D', artifactId:'image_demo' };
    }
    return { kind:'asset' as const, prompt, provider:'modal-3D', assetId:'asset_demo', status:'asset-ready', asset:{} };
  }),
  placeAsset:fn(async () => {}),
  openWorld:fn(async () => {}),
};

const meta = {
  title:'Studio/Build/BuildWorkbench',
  component:BuildWorkbenchView,
  args:{
    resources,
    session:worldSession,
    controller,
    environmentDefinition:{ id:'gallery', title:'Gallery' },
    log:fn(),
  },
} satisfies Meta<typeof BuildWorkbenchView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorldReady: Story = {
  play:async ({ canvas,args }) => {
    const prompt=canvas.getByPlaceholderText('描述你希望创建的内容…');
    await userEvent.type(prompt,'A quiet garden world');
    await userEvent.click(canvas.getByRole('checkbox',{name:/使用已连接的生成计算资源/}));
    await userEvent.click(canvas.getByRole('button',{name:'Create World'}));
    await expect(args.controller.runBuild).toHaveBeenCalled();
  },
};

export const AssetNeedsImage: Story = {
  args:{ session:assetSession },
};
