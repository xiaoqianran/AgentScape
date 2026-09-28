import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { ResourceLibraryView } from './ResourceLibraryView';

const snapshot = {
  assets: [
    {
      id: 'asset_chair_01',
      label: 'Lounge Chair',
      type: 'model/gltf-binary',
      source: 'generated',
      actions: ['pickup', 'place', 'inspect'],
    },
    {
      id: 'asset_table_01',
      label: 'Side Table',
      type: 'model/gltf-binary',
      source: 'builtin',
      actions: ['place', 'inspect'],
    },
  ],
  images: [
    {
      id: 'image_garden_01',
      label: 'Garden Concept',
      mime: 'image/png',
      provider: 'modal-2D',
      format: 'png',
      integrity: 'verified',
      bytes: 245760,
    },
  ],
  worlds: [
    {
      id: 'garden',
      label: 'Garden',
      source: 'builtin',
      number: '02',
      description: 'Outdoor navigation environment',
    },
    {
      id: 'manifest_garden_v1',
      label: 'Garden v1',
      source: 'generated',
      provider: 'modal-world',
      integrity: 'verified',
      jobId: 'job_001',
    },
  ],
};

const resources = {
  snapshot: () => snapshot,
  localArtifact: () => null,
  onChange: () => () => {},
};

const placement = {
  beginDrag: () => true,
  cancelDrag: () => {},
  placeAtCenter: async () => {},
};

const meta = {
  title: 'Studio/Resources/ResourceLibraryView',
  component: ResourceLibraryView,
  args: {
    resources,
    placement,
    openEnvironment: async () => {},
    openGeneratedWorld: async () => {},
  },
} satisfies Meta<typeof ResourceLibraryView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const imagesTab = canvas.getByRole('tab', { name: 'Images' });
    await userEvent.click(imagesTab);
    await expect(imagesTab).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByPlaceholderText('搜索 Image Artifact…')).toBeInTheDocument();

    const worldsTab = canvas.getByRole('tab', { name: 'Worlds' });
    await userEvent.click(worldsTab);
    await expect(worldsTab).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByText('Garden v1')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: {
    resources: {
      ...resources,
      snapshot: () => ({ assets: [], images: [], worlds: [] }),
    },
  },
};
