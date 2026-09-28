import type { Preview } from '@storybook/react-vite';
import '../apps/studio/ui/chrome/studio-tokens.css';
import '../apps/studio/ui/chrome/studio-base.css';
import '../apps/studio/ui/chrome/studio-shell.css';
import '../apps/studio/ui/chrome/studio-spatial.css';
import '../apps/studio/ui/chrome/studio-editor-theme.css';
import '../apps/studio/ui/content/StudioContent.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    a11y: {
      test: 'todo',
    },
  },
};

export default preview;
