import type { Meta, StoryObj } from '@storybook/react-vite';
import { GenerationJobCenterView } from './GenerationJobCenterView';

const meta = {
  title: 'Studio/Generation/GenerationJobCenter',
  component: GenerationJobCenterView,
} satisfies Meta<typeof GenerationJobCenterView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
