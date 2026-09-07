import { createRoot, type Root } from 'react-dom/client';
import { useStudioStore } from '../state/studioStore';

type ObjectInfo = {
  id: string;
  asset: string;
  type: string;
  position: number[];
  rotation: number[];
  actions: string[];
};

type Relation = {
  predicate: string;
  object: string;
};

type WorldLike = {
  store: { has: (id: string) => boolean };
  getObjectInfo: (id: string) => ObjectInfo;
  spatial: {
    getBounds: (id: string) => { size: number[] };
    findNearby: (id: string, radius: number) => unknown[];
  };
  sceneGraph: {
    update: () => unknown;
    describe: (id: string) => { outgoing: Relation[] };
  };
};

type ToolsLike = {
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

type InspectorProps = {
  world: WorldLike;
  tools: ToolsLike;
  log: (text: string, kind?: string) => void;
};

const ACTION_LABELS: Record<string, string> = {
  open: '打开',
  close: '关闭',
  pickup: '拿起',
  drop: '放下'
};

const RELATION_LABELS: Record<string, string> = {
  ON: '位于其上',
  NEAR: '附近',
  INSIDE: '位于内部'
};

function ObjectInspectorView({ world, tools, log }: InspectorProps) {
  const selectedObjectId = useStudioStore((state) => state.selectedObjectId);
  useStudioStore((state) => state.contextRevision);

  const id = selectedObjectId && world.store.has(selectedObjectId) ? selectedObjectId : null;
  const info = id ? world.getObjectInfo(id) : null;

  let spatialText = '';
  let visibleRelations: Relation[] = [];
  if (id) {
    const bounds = world.spatial.getBounds(id);
    const nearby = world.spatial.findNearby(id, 2);
    spatialText = `尺寸 ${bounds.size.join(' × ')} · 附近 ${nearby.length} 个对象`;
    visibleRelations = world.sceneGraph
      .describe(id)
      .outgoing
      .filter((relation) => ['ON', 'NEAR', 'INSIDE'].includes(relation.predicate))
      .slice(0, 8);
  }

  const actions = info?.actions.filter((action) => Object.hasOwn(ACTION_LABELS, action)) ?? [];

  const runAction = async (action: string) => {
    if (!id) return;
    try {
      await tools.call(action === 'drop' ? 'drop' : action, { id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`错误：${message}`, 'error');
    }
  };

  return (
    <>
      <header className="screen-heading">
        <div className="eyebrow">检查</div>
        <h1 id="inspect-heading">{info?.id ?? '请选择对象'}</h1>
        <p id="inspect-subheading">
          {info ? `${info.type} 实例` : '点击世界中的对象，查看它的状态、关系和可用操作。'}
        </p>
      </header>

      {!info ? (
        <div id="empty-selection" className="empty-state">
          <strong>尚未选择对象</strong>
          <span>对象仍在视口中选择，这里只显示当前需要的上下文。</span>
        </div>
      ) : (
        <div id="selection" className="selection">
          <div className="object-title">
            <div>
              <h2 id="object-id">{info.id}</h2>
              <span id="object-type">{info.type}</span>
            </div>
          </div>

          <section className="inspect-section">
            <h3>变换</h3>
            <dl className="properties">
              <div><dt>位置</dt><dd id="position">{info.position.join(', ')}</dd></div>
              <div><dt>旋转</dt><dd id="rotation">{info.rotation.join(', ')}°</dd></div>
            </dl>
          </section>

          <section className="inspect-section">
            <h3>关系</h3>
            <div id="relation-info" className="relation-info">
              {visibleRelations.length ? visibleRelations.map((relation, index) => (
                <div key={`${relation.predicate}:${relation.object}:${index}`}>
                  <strong>{RELATION_LABELS[relation.predicate] ?? relation.predicate}</strong>
                  <span>{relation.object}</span>
                </div>
              )) : <span className="muted-copy">暂无语义关系。</span>}
            </div>
            <div id="spatial-info" className="spatial-info">{spatialText}</div>
          </section>

          <section className="inspect-section">
            <h3>操作</h3>
            <div id="actions" className="action-list">
              {actions.length ? actions.map((action) => (
                <button key={action} type="button" onClick={() => void runAction(action)}>
                  {ACTION_LABELS[action]}
                </button>
              )) : <span className="muted-copy">暂无可直接执行的操作。</span>}
            </div>
          </section>

          <details className="disclosure">
            <summary>资产详情</summary>
            <dl className="properties detail-properties">
              <div><dt>资产</dt><dd id="asset-id">{info.asset}</dd></div>
              <div><dt>实例</dt><dd id="instance-id">{info.id}</dd></div>
            </dl>
          </details>
        </div>
      )}
    </>
  );
}

export function mountObjectInspector({
  root,
  world,
  tools,
  log = () => {}
}: InspectorProps & { root: HTMLElement }) {
  const host = root.matches('.inspector') ? root : root.querySelector<HTMLElement>('.inspector');
  if (!host) throw new TypeError('ObjectInspector requires an .inspector host');

  const tab = root.closest('.panel')?.querySelector<HTMLElement>('[data-panel-view="inspect"]')
    ?? root.querySelector<HTMLElement>('[data-panel-view="inspect"]');
  const reactRoot: Root = createRoot(host);
  reactRoot.render(<ObjectInspectorView world={world} tools={tools} log={log} />);

  return {
    render(id: string | null) {
      tab?.classList.toggle('has-selection', Boolean(id));
      if (id && world.store.has(id)) world.sceneGraph.update();
      useStudioStore.getState().syncInspector(id);
    },
    destroy() {
      reactRoot.unmount();
    }
  };
}
