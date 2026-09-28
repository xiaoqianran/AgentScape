import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { WorldsPage } from './WorldsPage';

const environments = [
  {
    id: 'gallery',
    title: 'Gallery',
    number: '01',
    description: 'A compact interior world for navigation and interaction testing.',
    facts: ['Indoor', 'NavMesh', 'Interactive'],
  },
  {
    id: 'garden',
    title: 'Garden',
    number: '02',
    description: 'An outdoor scene with generated assets and open traversal.',
    facts: ['Outdoor', 'Generated assets', 'Large'],
    worldFirst: true,
  },
];

const generatedWorlds = [
  {
    id: 'manifest_garden_v1',
    label: 'Garden v1',
    source: 'generated',
    integrity: 'verified',
    provider: 'modal-world',
    jobId: 'job_001',
  },
];

const resources = {
  snapshot: () => ({ worlds: generatedWorlds }),
  onChange: () => () => {},
};

const meta = {
  title: 'Studio/Worlds/WorldsPage',
  component: WorldsPage,
  args: {
    environments,
    presentation: { id: 'gallery', title: 'Gallery', generated: false },
    resources,
    openBuiltinWorld: fn(async () => {}),
    openGeneratedWorld: fn(async () => {}),
  },
} satisfies Meta<typeof WorldsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Open in World Editor/ }));
    await expect(args.openBuiltinWorld).toHaveBeenCalledWith('garden');
  },
};

export const GeneratedWorldActive: Story = {
  args: {
    presentation: {
      id: 'generated',
      title: 'Garden v1',
      generated: true,
      persistenceSource: 'artifact:manifest_garden_v1',
    },
  },
};
