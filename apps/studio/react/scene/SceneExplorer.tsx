import { useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { collectSceneObjectSummaries } from '../../ui/scene/SceneExplorer.js';
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
  queries: { listObjects: () => Array<{ id:string; asset?:string; type?:string; label?:string }> };
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
  const [query, setQuery] = useState('');

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
    () => collectSceneObjectSummaries(world.queries.listObjects(), selectedObjectId),
    [revision, selectedObjectId, world.queries]
  );
  const visibleObjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return objects;
    return objects.filter((record: any) => (
      [record.label, record.id, record.assetId, record.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    ));
  }, [objects, query]);

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
      <label className="scene-search">
        <span className="sr-only">搜索场景对象</span>
        <input
          id="scene-object-search"
          name="sceneObjectSearch"
          type="search"
          value={query}
          placeholder="Search objects"
          aria-label="搜索场景对象"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="scene-section-heading">
        <span>Scene</span>
        <small>{visibleObjects.length} Objects</small>
      </div>
      <div id="scene-object-list" className="scene-object-list">
        {visibleObjects.length === 0 ? (
          <div className="scene-empty">{objects.length ? 'No matching objects' : 'No runtime objects'}</div>
        ) : visibleObjects.map((record: any) => (
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
