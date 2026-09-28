import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { ProductHeader } from './ProductHeader';

const meta = {
  title: 'Studio/Shell/ProductHeader',
  component: ProductHeader,
  decorators: [
    (Story) => (
      <main className="shell spatial-editor" style={{ minHeight: '100vh' }}>
        <Story />
      </main>
    ),
  ],
  args: {
    activePage: 'worlds',
    sceneCollapsed: false,
    setSceneCollapsed: fn(),
    choosePage: fn(),
    presentation: { id: 'gallery', title: 'Gallery' },
    environments: [
      { id: 'gallery', title: 'Gallery', number: '01' },
      { id: 'garden', title: 'Garden', number: '02' },
    ],
    generated: false,
    worldSelectValue: 'gallery',
    openWorld: async () => {},
    runtimeStatus: { state: 'ready', label: 'Runtime ready', recoveryAction: null },
    cinematic: false,
    setCinematic: fn(),
    openDeveloper: fn(),
  },
} satisfies Meta<typeof ProductHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Worlds: Story = {};

export const WorldEditor: Story = {
  args: {
    activePage: 'world',
  },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: '沉浸模式' }));
    await expect(args.setCinematic).toHaveBeenCalledWith(true);

    await userEvent.click(canvas.getByRole('button', { name: '打开开发者设置' }));
    await expect(args.openDeveloper).toHaveBeenCalledTimes(1);
  },
};

export const RuntimeRecovery: Story = {
  args: {
    runtimeStatus: {
      state: 'error',
      label: 'Runtime unavailable',
      recoveryAction: () => {},
    },
  },
};
