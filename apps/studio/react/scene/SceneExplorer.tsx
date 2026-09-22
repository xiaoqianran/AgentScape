import { useEffect, useLayoutEffect, useMemo, useState, type DragEvent } from 'react';
import { ASSET_DRAG_MIME } from '../../editor/AssetPlacementController.js';
import { collectStudioSceneProjection } from '../../scene/SceneObjectProjection.js';
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
  queries: { listObjects: () => Array<{ id:string; asset?:string; assetId?:string; type?:string; label?:string }> };
  events: EventBus;
};

type EditorLike = {
  selectedId?: string | null;
  select: (id: string | null) => unknown;
};

type AuthoringLike = {
  export: () => { root?: unknown } | null;
};

type SceneExplorerProps = {
  world: WorldLike;
  editor: EditorLike;
  authoring?: AuthoringLike | null;
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
  openInspect?: () => void;
};

const SCENE_REFRESH_EVENTS = [
  'object.spawned',
  'object.removed',
  'object.duplicated',
  'scene.restored',
  'scene.cleared',
  'environment.replaced',
  'authoring.changed'
] as const;

export function SceneExplorerView({
  world,
  editor,
  authoring = null,
  environmentDefinition,
  resources,
  placement,
  openLibrary = () => {},
  openCreate = () => {},
  openInspect = () => {}
}: SceneExplorerProps) {
  const selection = useStudioStore((state) => state.editor.selection);
  const editorRevision = useStudioStore((state) => state.editor.revision);
  const worldPresentation = useStudioStore((state) => state.view.worldPresentation);
  const setSelection = useStudioStore((state) => state.setSelection);
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

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [world]);

  useEffect(() => resources.onChange(() => setResourceRevision((value) => value + 1)), [resources]);

  const environment = world.environment;
  const title = worldPresentation?.title || environment?.title || environment?.label || environmentDefinition.title || environment?.id || 'World';
  const environmentId = worldPresentation?.id || environment?.id || environmentDefinition.id || 'environment';

  const projection = useMemo(() => collectStudioSceneProjection({
    runtimeObjects:world.queries.listObjects(),
    authoringDocument:authoring?.export?.() || null,
    environment:{
      id:environmentId,
      title
    },
    selection
  }), [authoring, editorRevision, environmentId, revision, selection, title, world.queries]);

  const filterRows = (rows:any[]) => {
    const needle=query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((record:any)=>(
      [record.label,record.id,record.assetId,record.type,record.source]
        .filter(Boolean)
        .some((value)=>String(value).toLowerCase().includes(needle))
    ));
  };

  const visibleRuntimeObjects = useMemo(
    () => filterRows(projection.runtimeRows),
    [projection.runtimeRows,query]
  );
  const visibleAuthoringObjects = useMemo(
    () => filterRows(projection.authoringRows),
    [projection.authoringRows,query]
  );

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

  const selectRuntimeObject = (id: string) => {
    editor.select(id);
    openInspect();
  };

  const selectAuthoringObject = (id: string) => {
    editor.select(null);
    setSelection({ source:'authoring', id });
    openInspect();
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

  const runtimeCount=projection.runtimeRows.length;
  const authoringCount=projection.authoringRows.length;
  const sceneCount=runtimeCount + authoringCount;

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
        <span id="scene-object-count" className="scene-count">{tab === 'objects' ? sceneCount : assets.length}</span>
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
            <div className="scene-world-card" data-source="environment">
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
              <span>Runtime Entities</span>
              <small>{visibleRuntimeObjects.length} / {runtimeCount}</small>
            </div>
            <div id="scene-object-list" className="scene-object-list" data-source="runtime">
              {visibleRuntimeObjects.length === 0 ? (
                <div className="scene-empty">{runtimeCount ? 'No matching runtime entities' : 'No runtime entities'}</div>
              ) : visibleRuntimeObjects.map((record: any) => (
                <button
                  key={record.key}
                  type="button"
                  className={'scene-object-row' + (record.selected ? ' active' : '')}
                  data-object-id={record.id}
                  data-scene-key={record.key}
                  data-source={record.source}
                  aria-pressed={record.selected}
                  onClick={() => selectRuntimeObject(record.id)}
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

            {authoringCount > 0 ? (
              <>
                <div className="scene-section-heading">
                  <span>Authoring</span>
                  <small>{visibleAuthoringObjects.length} / {authoringCount}</small>
                </div>
                <div className="scene-object-list" data-source="authoring">
                  {visibleAuthoringObjects.length === 0 ? (
                    <div className="scene-empty">No matching authoring nodes</div>
                  ) : visibleAuthoringObjects.map((record:any)=>(
                    <button
                      key={record.key}
                      type="button"
                      className={'scene-object-row' + (record.selected ? ' active' : '')}
                      data-object-id={record.id}
                      data-scene-key={record.key}
                      data-source={record.source}
                      aria-pressed={record.selected}
                      onClick={()=>selectAuthoringObject(record.id)}
                    >
                      <span className="scene-object-glyph">✦</span>
                      <span className="scene-object-copy">
                        <strong>{record.label}</strong>
                        <small>{record.id}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
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
