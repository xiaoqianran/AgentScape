import { useEffect, useLayoutEffect, useMemo, useState, type DragEvent } from 'react';
import { ASSET_DRAG_MIME } from '../../editor/AssetPlacementController.js';
import { collectSceneObjectSummaries } from '../../scene/SceneObjectProjection.js';
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
  resources: {
    snapshot: () => {
      assets?: Array<{
        id: string;
        label?: string;
        type?: string;
        source?: string;
        actions?: string[];
      }>;
    };
    onChange: (listener: () => void) => (() => void);
  };
  placement: {
    beginDrag: (assetId: string) => boolean;
    cancelDrag: () => void;
    placeAtCenter: (assetId: string) => Promise<unknown>;
  };
  openLibrary?: () => void;
  openCreate?: () => void;
};

const SCENE_REFRESH_EVENTS = [
  'object.spawned',
  'object.removed',
  'object.duplicated',
  'scene.restored',
  'scene.cleared',
  'environment.replaced'
] as const;

export function SceneExplorerView({
  world,
  editor,
  environmentDefinition,
  resources,
  placement,
  openLibrary = () => {},
  openCreate = () => {}
}: SceneExplorerProps) {
  const selectedObjectId = useStudioStore((state) => state.selectedObjectId);
  const worldPresentation = useStudioStore((state) => state.worldPresentation);
  const setSelectedObjectId = useStudioStore((state) => state.setSelectedObjectId);
  const [revision, setRevision] = useState(0);
  const [resourceRevision, setResourceRevision] = useState(0);
  const [tab, setTab] = useState<'objects' | 'assets'>('objects');
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

  useEffect(() => resources.onChange(() => setResourceRevision((value) => value + 1)), [resources]);

  const environment = world.environment;
  const title = worldPresentation?.title || environment?.title || environment?.label || environmentDefinition.title || environment?.id || 'World';
  const environmentId = worldPresentation?.id || environment?.id || environmentDefinition.id || 'environment';
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
  const assets = useMemo(() => resources.snapshot().assets || [], [resourceRevision, resources]);
  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter((asset) => (
      [asset.label, asset.id, asset.type, asset.source, ...(asset.actions || [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    ));
  }, [assets, query]);

  const selectObject = (id: string) => {
    setSelectedObjectId(id);
    editor.select(id);
  };
  const startAssetDrag = (event: DragEvent, assetId: string) => {
    if (!placement.beginDrag(assetId)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(ASSET_DRAG_MIME, assetId);
    event.dataTransfer.setData('text/plain', assetId);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <>
      <div className="scene-panel-heading">
        <div>
          <span className="scene-eyebrow">WORLD</span>
          <strong id="scene-world-title">{title}</strong>
          <div className="product-flow" aria-label="World workflow">
            <span>Environment</span><i>→</i><span>Objects</span><i>→</i><span>State</span>
          </div>
        </div>
        <span id="scene-object-count" className="scene-count">{tab === 'objects' ? objects.length : assets.length}</span>
      </div>

      <div className="scene-panel-tabs" role="tablist" aria-label="Studio sidebar">
        <button type="button" className={tab === 'objects' ? 'active' : ''} aria-selected={tab === 'objects'} onClick={() => { setTab('objects'); setQuery(''); }}>
          Objects
        </button>
        <button type="button" className={tab === 'assets' ? 'active' : ''} aria-selected={tab === 'assets'} onClick={() => { setTab('assets'); setQuery(''); }}>
          Assets
        </button>
      </div>

      <div className="scene-panel-body">
        {tab === 'objects' ? (
          <>
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
        ) : (
          <>
            <label className="scene-search scene-asset-search">
              <span className="sr-only">搜索资源</span>
              <input
                id="scene-asset-search"
                name="sceneAssetSearch"
                type="search"
                value={query}
                placeholder="Search assets"
                aria-label="搜索资源"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="scene-section-heading">
              <span>Assets</span>
              <small>{visibleAssets.length} Reusable</small>
            </div>
            <div className="scene-asset-list">
              {visibleAssets.length === 0 ? (
                <div className="scene-empty">{assets.length ? 'No matching assets' : 'No reusable assets'}</div>
              ) : visibleAssets.map((asset) => (
                <article
                  key={asset.id}
                  className="scene-asset-row"
                  draggable
                  data-asset-id={asset.id}
                  onDragStart={(event) => startAssetDrag(event, asset.id)}
                  onDragEnd={() => placement.cancelDrag()}
                >
                  <span className="scene-asset-glyph">◇</span>
                  <div className="scene-asset-copy">
                    <strong>{asset.label || asset.id}</strong>
                    <small>{[asset.type, asset.source].filter(Boolean).join(' · ') || asset.id}</small>
                  </div>
                  <button type="button" title="放到视口中心" onClick={() => void placement.placeAtCenter(asset.id)}>＋</button>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="scene-panel-footer">
        <button type="button" onClick={openLibrary}>Library</button>
        <button type="button" onClick={openCreate}>＋ Create</button>
      </footer>
    </>
  );
}
