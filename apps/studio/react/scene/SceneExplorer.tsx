import { StudioIcon } from '../shared/StudioIcon';
import { assetDisplayName } from '../shared/ResourcePresentation';
import './SceneExplorer.css';
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
  environment?: { id?: string; title?: string; label?: string; interactions?: Array<{ id:string; contractId?:string; label?:string; object?:{name?:string} }> } | null;
  queries: { listObjects: () => Array<{ id:string; asset?:string; assetId?:string; type?:string; label?:string }> };
  events: EventBus;
};

type EditorLike = {
  selectedId?: string | null;
  selectSelection: (selection:{source:'authoring'|'runtime'|'environment';id:string}|null)=>unknown;
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
  setStyle?: (reference: string) => Promise<{ value?: { status?: string; warnings?: string[] } }>;
  getStyle?: () => string | null;
};

const SCENE_REFRESH_EVENTS = [
  'object.spawned',
  'object.removed',
  'object.duplicated',
  'scene.restored',
  'scene.cleared',
  'environment.replaced',
  'style.changed',
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
  openInspect = () => {},
  setStyle,
  getStyle
}: SceneExplorerProps) {
  const selection = useStudioStore((state) => state.editor.selection);
  const editorRevision = useStudioStore((state) => state.editor.revision);
  const worldPresentation = useStudioStore((state) => state.view.worldPresentation);
  const [revision, setRevision] = useState(0);
  const [resourceRevision, setResourceRevision] = useState(0);
  const [tab, setTab] = useState<'objects' | 'assets'>('objects');
  const [query, setQuery] = useState('');
  const [style, updateStyle] = useState('');
  const [styleBusy, updateStyleBusy] = useState(false);
  const [styleMessage, updateStyleMessage] = useState('');
  useEffect(() => {
    const current = getStyle?.();
    updateStyle(current?.startsWith('builtin/') ? `builtin://${current.slice(8)}` : current || '');
  }, [revision, getStyle]);

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
      title,
      interactions:environment?.interactions || []
    },
    selection
  }), [authoring, editorRevision, environmentId, revision, selection, title, world.queries]);

  const filterRows = (rows:any[]) => {
    const needle=query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((record:any)=>(
      [assetDisplayName(record.assetId || record.type,record.label),record.label,record.id,record.assetId,record.type,record.source]
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
  const environmentCount=projection.environmentRows.filter(row=>row.kind==='environment-interaction').length;
  const visibleEnvironmentInteractions=useMemo(
    () => filterRows(projection.environmentRows.filter(row=>row.kind==='environment-interaction')),
    [projection.environmentRows,query]
  );

  const assets = useMemo(() => resources.snapshot().assets || [], [resourceRevision, resources]);
  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter((asset) => (
      [assetDisplayName(asset.id,asset.label),asset.label, asset.id, asset.type, asset.source, ...(asset.actions || [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    ));
  }, [assets, query]);

  const selectRuntimeObject = (id: string) => {
    editor.select(id);

  };

  const selectAuthoringObject = (id: string) => {
    editor.selectSelection({ source:'authoring', id });

  };
  const selectEnvironmentInteraction = (id: string) => {
    editor.selectSelection({ source:'environment', id });
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
  const sceneCount=runtimeCount + authoringCount + environmentCount;

  return (
    <>
      <div className="scene-panel-heading">
        <div>
          <span className="scene-eyebrow">场景</span>
          <strong id="scene-world-title">{title}</strong>
          <div className="product-flow" aria-label="World workflow">
            <span>环境</span><i>→</i><span>对象</span><i>→</i><span>状态</span>
          </div>
        </div>
        <span id="scene-object-count" className="scene-count">{tab === 'objects' ? sceneCount : assets.length}</span>
      </div>

      <div className="scene-panel-tabs" role="group" aria-label="场景侧栏内容">
        <button type="button" className={tab === 'objects' ? 'active' : ''} aria-pressed={tab === 'objects'} onClick={() => { setTab('objects'); setQuery(''); }}>
          场景对象
        </button>
        <button type="button" className={tab === 'assets' ? 'active' : ''} aria-pressed={tab === 'assets'} onClick={() => { setTab('assets'); setQuery(''); }}>
          添加资源
        </button>
      </div>

      <div className="scene-panel-body">
        {tab === 'objects' ? (
          <>
            <div className="scene-world-card" data-source="environment">
              <span className="scene-world-dot" />
              <div>
                <strong id="scene-environment-id">{environmentId}</strong>
                <small>当前场景环境</small>
              </div>
            </div>
            {setStyle ? <label className="scene-style-control">视觉风格
              <select aria-label="视觉风格" value={style} disabled={styleBusy} onChange={async event => {
                const requested = event.target.value;
                if (!requested) return;
                updateStyleBusy(true); updateStyleMessage('正在准备风格…');
                try {
                  const result = await setStyle(requested);
                  updateStyle(requested);
                  updateStyleMessage(result.value?.status === 'deferred' ? '风格已保存，等待渲染' : result.value?.warnings?.length ? '风格已应用，部分材质保持原样' : '风格已应用');
                } catch { updateStyleMessage('风格切换失败，已保留原风格'); }
                finally { updateStyleBusy(false); }
              }}>
                <option value="" disabled>原始材质</option>
                {style && !style.startsWith('builtin://') ? <option value={style}>自定义风格</option> : null}
                <option value="builtin://realistic">Realistic</option>
                <option value="builtin://toon">Toon</option>
                <option value="builtin://low-poly">Low Poly</option>
              </select>
              {styleMessage ? <span role="status">{styleMessage}</span> : null}
            </label> : null}
            <label className="scene-search">
              <span className="sr-only">搜索场景对象</span>
              <input
                id="scene-object-search"
                name="sceneObjectSearch"
                type="search"
                value={query}
                placeholder="搜索场景对象…"
                aria-label="搜索场景对象"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="scene-section-heading">
              <span>Runtime 场景实体</span>
              <small>{visibleRuntimeObjects.length} / {runtimeCount}</small>
            </div>
            <div id="scene-object-list" className="scene-object-list" data-source="runtime">
              {visibleRuntimeObjects.length === 0 ? (
                <div className="scene-empty">{runtimeCount ? '没有匹配的对象' : '场景中还没有对象'}</div>
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
                    <StudioIcon name={record.assetId === 'agent' || record.type === 'agent' ? 'agent' : 'cube'} size={16} />
                  </span>
                  <span className="scene-object-copy">
                    <strong>{assetDisplayName(record.assetId || record.type,record.label)}</strong>
                    <small>{record.id}</small>
                  </span>
                </button>
              ))}
            </div>

            {environmentCount > 0 ? (
              <>
                <div className="scene-section-heading">
                  <span>场景交互点</span>
                  <small>{visibleEnvironmentInteractions.length} / {environmentCount}</small>
                </div>
                <div className="scene-object-list" data-source="environment">
                  {visibleEnvironmentInteractions.slice(0,100).map(record=>(
                    <button
                      key={record.key}
                      type="button"
                      className={'scene-object-row'+(record.selected?' active':'')}
                      data-object-id={record.id}
                      data-scene-key={record.key}
                      data-source="environment"
                      aria-pressed={record.selected}
                      onClick={()=>selectEnvironmentInteraction(record.id)}
                    >
                      <span className="scene-object-glyph">✦</span>
                      <span className="scene-object-copy">
                        <strong>{record.label}</strong>
                        <small>{record.id}</small>
                      </span>
                    </button>
                  ))}
                  {visibleEnvironmentInteractions.length > 100 ? <div className="scene-empty">仅展示前 100 项，请搜索定位其余交互点</div> : null}
                </div>
              </>
            ) : null}

            {authoringCount > 0 ? (
              <>
                <div className="scene-section-heading">
                  <span>创作中的对象</span>
                  <small>{visibleAuthoringObjects.length} / {authoringCount}</small>
                </div>
                <div className="scene-object-list" data-source="authoring">
                  {visibleAuthoringObjects.length === 0 ? (
                    <div className="scene-empty">没有匹配的创作对象</div>
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
                placeholder="搜索可用资源…"
                aria-label="搜索资源"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="scene-section-heading">
              <span>可用资源</span>
              <small>{visibleAssets.length} 个</small>
            </div>
            <div className="scene-asset-list">
              {visibleAssets.length === 0 ? (
                <div className="scene-empty">{assets.length ? '没有匹配的资源' : '暂无可用资源'}</div>
              ) : visibleAssets.map((asset) => (
                <article
                  key={asset.id}
                  className="scene-asset-row"
                  draggable
                  data-asset-id={asset.id}
                  onDragStart={(event) => startAssetDrag(event, asset.id)}
                  onDragEnd={() => placement.cancelDrag()}
                >
                  <span className="scene-asset-glyph"><StudioIcon name="cube" size={16} /></span>
                  <div className="scene-asset-copy">
                    <strong>{assetDisplayName(asset.id,asset.label)}</strong>
                    <small>{[asset.type, asset.source].filter(Boolean).join(' · ') || asset.id}</small>
                  </div>
                  <button type="button" title="放到视口中心" onClick={() => void placement.placeAtCenter(asset.id)}>＋</button>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="scene-panel-footer"><button type="button" disabled={!selection} onClick={openInspect}>查看属性</button>
        <button type="button" onClick={openLibrary}><StudioIcon name="folder" size={15} />资源库</button>
        <button type="button" onClick={openCreate}><StudioIcon name="plus" size={15} />生成物体</button>
      </footer>
    </>
  );
}
