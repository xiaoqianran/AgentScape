import { useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { collectSceneObjects } from '../../ui/scene/SceneExplorer.js';
import { useStudioStore } from '../state/studioStore';

type EnvironmentDefinition = {
  id?: string;
  title?: string;
};

type EventBus = {
  on: (type: string, listener: () => void) => (() => void) | undefined;
};

type WorldLike = {
  environment?: { id?: string; title?: string; label?: string } | null;
  store: { list: () => Array<[string, unknown]> };
  events: EventBus;
};

type EditorLike = {
  selectedId?: string | null;
  select: (id: string) => unknown;
};

type SceneExplorerProps = {
  world: WorldLike;
  editor: EditorLike;
  environmentDefinition: EnvironmentDefinition;
};

const SCENE_REFRESH_EVENTS = [
  'object.spawned',
  'object.removed',
  'object.duplicated',
  'scene.restored',
  'scene.cleared',
  'environment.replaced'
] as const;

function SceneExplorerView({ world, editor, environmentDefinition }: SceneExplorerProps) {
  const selectedObjectId = useStudioStore((state) => state.selectedObjectId);
  const setSelectedObjectId = useStudioStore((state) => state.setSelectedObjectId);
  const [revision, setRevision] = useState(0);

  useLayoutEffect(() => {
    const unsubscribers: Array<() => void> = [];
    const refresh = () => setRevision((value) => value + 1);

    for (const type of SCENE_REFRESH_EVENTS) {
      const unsubscribe = world.events.on(type, refresh);
      if (unsubscribe) unsubscribers.push(unsubscribe);
    }

    const unsubscribeSelection = world.events.on('editor.selection', () => {
      setSelectedObjectId(editor.selectedId ?? null);
    });
    if (unsubscribeSelection) unsubscribers.push(unsubscribeSelection);

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [editor, setSelectedObjectId, world]);

  const environment = world.environment;
  const title = environment?.title || environment?.label || environmentDefinition.title || environment?.id || 'World';
  const environmentId = environment?.id || environmentDefinition.id || 'environment';
  const objects = useMemo(
    () => collectSceneObjects(world.store, selectedObjectId),
    [revision, selectedObjectId, world.store]
  );

  const selectObject = (id: string) => {
    setSelectedObjectId(id);
    editor.select(id);
  };

  return (
    <>
      <div className="scene-panel-heading">
        <div>
          <span className="scene-eyebrow">WORLD</span>
          <strong id="scene-world-title">{title}</strong>
        </div>
        <span id="scene-object-count" className="scene-count">{objects.length}</span>
      </div>
      <div className="scene-world-card">
        <span className="scene-world-dot" />
        <div>
          <strong id="scene-environment-id">{environmentId}</strong>
          <small>Current environment</small>
        </div>
      </div>
      <div className="scene-section-heading">
        <span>Scene</span>
        <small>Objects</small>
      </div>
      <div id="scene-object-list" className="scene-object-list">
        {objects.length === 0 ? (
          <div className="scene-empty">No runtime objects</div>
        ) : objects.map((record: any) => (
          <button
            key={record.id}
            type="button"
            className={`scene-object-row${record.selected ? ' active' : ''}`}
            data-object-id={record.id}
            aria-pressed={record.selected}
            onClick={() => selectObject(record.id)}
          >
            <span className="scene-object-glyph">
              {record.assetId === 'agent' || record.type === 'agent' ? 'A' : '◆'}
            </span>
            <span className="scene-object-copy">
              <strong>{record.label}</strong>
              <small>{record.id}</small>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function mountSceneExplorer({
  root,
  world,
  editor,
  environmentDefinition
}: SceneExplorerProps & { root: HTMLElement }) {
  useStudioStore.getState().setSelectedObjectId(editor.selectedId ?? null);
  const reactRoot: Root = createRoot(root);
  flushSync(() => {
    reactRoot.render(
      <SceneExplorerView
        world={world}
        editor={editor}
        environmentDefinition={environmentDefinition}
      />
    );
  });

  return {
    destroy() {
      reactRoot.unmount();
    }
  };
}
